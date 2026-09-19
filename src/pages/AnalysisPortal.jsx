import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient'; 
import { authFetch } from '../utils/apiClient';
import LatexText from '../components/LatexText'; 
import { getFromLocalStore, saveToLocalStore } from '../utils/localDb';

// 🚨 SECTION FIELD KEY — change this in ONE place if your question objects
// use a different key name (e.g. 'sectionName', 'topic') instead of 'section'.
const SECTION_KEY = 'section';

const AnalysisPortal = ({ results, onBackToDashboard }) => {
  // 🧭 FETCH-BY-ID RESOLUTION
  // Normal in-app flow: results arrives as a prop (App.jsx's in-memory
  // testResults), nothing changes for that path.
  // Reload / direct URL hit: results prop is null (App.jsx lost its
  // in-memory state on remount), but the URL still has :attemptId — resolve
  // it ourselves. attemptId is the same identifier used both locally
  // (IndexedDB test_sessions, keyed by attemptId) and in the cloud
  // (Supabase test_sessions.id) — both are written with the exact same
  // value at submit time, so one id works for both lookups.
  const { attemptId: urlAttemptId } = useParams();
  const [resolvedResults, setResolvedResults] = useState(results || null);
  const [isResolving, setIsResolving] = useState(!results);
  const [resolveError, setResolveError] = useState(null);

  useEffect(() => {
    // Library can pass a results prop whose questions came back empty
    // because this device's IndexedDB doesn't have this attempt's local
    // snapshot (see Library.jsx's cloudOnlySessions handling) — in that
    // case we still need the question_ids -> question_pool reconstruction
    // below, so only short-circuit here when questions actually has data.
    const hasUsableQuestions = results && Array.isArray(results.questions) && results.questions.length > 0;
    if (hasUsableQuestions) {
      setResolvedResults(results);
      setIsResolving(false);
      setResolveError(null);
      return;
    }
    const effectiveAttemptId = urlAttemptId || (results && results.attemptId);
    if (!effectiveAttemptId) {
      if (results) {
        // Had a results prop but no questions and no id to resolve from —
        // just show whatever was given rather than blocking entirely.
        setResolvedResults(results);
        setIsResolving(false);
        setResolveError(null);
      } else {
        setIsResolving(false);
        setResolveError("No attempt specified.");
      }
      return;
    }

    let cancelled = false;
    setIsResolving(true);
    setResolveError(null);

    (async () => {
      try {
        // 1) Try local IndexedDB first — covers a fresh submission on this
        // device, or Library's local review of a past attempt.
        const localRow = await getFromLocalStore('test_sessions', effectiveAttemptId);
        if (cancelled) return;
        if (localRow && localRow.status === 'submitted') {
          // Local rows from Library are already in the exact shape
          // AnalysisPortal expects when they include question content —
          // but a raw submitted test_sessions row (from handleFinalSubmit)
          // doesn't carry full question objects, only answers/uploads/time.
          // Re-join with the matching mock_tests row for question content,
          // same way Library does, so reload always has everything needed.
          const testIdForJoin = localRow.test_id || localRow.id;
          let questionContent = localRow.questions || localRow.questions_list || null;
          if (!questionContent) {
            try {
              const { data: cloudMatch } = await supabase.from('mock_tests').select('*').eq('id', testIdForJoin).single();
              if (cloudMatch) {
                questionContent = Array.isArray(cloudMatch.sections) && cloudMatch.sections.length > 0
                  ? cloudMatch.sections.flatMap((sec, secIdx) => (sec.questions || []).map(q => ({ ...q, sectionIndex: secIdx, sectionName: sec.name, sectionTime: sec.time })))
                  : (cloudMatch.questions_list || []);
              }
            } catch (joinErr) {
              console.warn("Could not join question content for local review (non-blocking):", joinErr);
            }
          }
          setResolvedResults({
            id: testIdForJoin,
            attemptId: localRow.id,
            title: localRow.title,
            questions: questionContent || [],
            answers: localRow.answers || {},
            uploads: localRow.uploads || {},
            timeLeft: localRow.raw_seconds ?? localRow.time_left ?? 0,
            timeTracker: localRow.time_tracker || {}
          });
          setIsResolving(false);
          return;
        }

        // 2) Not found locally (different device, or cleared storage) — try
        // the cloud copy. Two reconstruction paths depending on test type:
        //   a) Test Series: mock_tests join, same as Detailed Review flow.
        //   b) AI Labs: mock_tests has no matching row (its ids look like
        //      "MOCK_MOVED_..." and are never inserted into mock_tests), so
        //      fall back to question_ids -> question_pool join instead.
        const { data: cloudRow, error: cloudErr } = await supabase.from('test_sessions').select('*').eq('id', effectiveAttemptId).single();
        if (cancelled) return;
        if (cloudErr || !cloudRow) {
          setResolveError("Could not find this test attempt. It may not exist on this device or account.");
          setIsResolving(false);
          return;
        }

        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/tests/load?testId=${encodeURIComponent(cloudRow.test_id)}&reveal=true`);
        const json = await res.json();
        if (cancelled) return;

        if (json.success && json.test) {
          // Path (a): Test Series
          const flatQuestions = Array.isArray(json.test.sections) && json.test.sections.length > 0
            ? json.test.sections.flatMap((sec, secIdx) => (sec.questions || []).map(q => ({ ...q, sectionIndex: secIdx, sectionName: sec.name, sectionTime: sec.time })))
            : (json.test.questions_list || []);

          setResolvedResults({
            id: cloudRow.test_id,
            attemptId: cloudRow.id,
            title: cloudRow.title,
            questions: flatQuestions,
            answers: cloudRow.answers || {},
            uploads: cloudRow.uploads || {},
            timeLeft: cloudRow.raw_seconds ?? cloudRow.time_left ?? 0,
            timeTracker: cloudRow.time_tracker || {}
          });
          setIsResolving(false);
          return;
        }

        // Path (b): AI Labs — mock_tests had no matching row. Reconstruct
        // from question_pool using the ordered question_ids saved at submit
        // time. Order matches evaluatedQuestions at submit time, which is
        // what answers/subjective_results are indexed against.
        const poolIds = (cloudRow.question_ids || []).filter(Boolean);
        if (poolIds.length === 0) {
          setResolveError("Could not load this attempt's questions — no question reference was saved for this test.");
          setIsResolving(false);
          return;
        }

        const poolRes = await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/pool/questions-by-ids`, {
          method: 'POST',
          body: JSON.stringify({ attemptId: cloudRow.id, questionIds: poolIds })
        });
        const poolJson = await poolRes.json();
        if (cancelled) return;
        if (!poolJson.success) {
          setResolveError(poolJson.error || "Could not load this attempt's questions from the question bank.");
          setIsResolving(false);
          return;
        }
        const poolRows = poolJson.questions;

        const poolById = {};
        (poolRows || []).forEach(p => { poolById[p.id] = p; });

        const subjectiveById = {};
        (cloudRow.subjective_results || []).forEach(r => { subjectiveById[r.question_id] = r; });

        // Rebuild in original order (poolIds order = evaluatedQuestions order
        // at submit time), skipping any id that vanished from the pool.
        const reconstructedQuestions = poolIds
          .map(pid => {
            const p = poolById[pid];
            if (!p) return null;
            const subj = subjectiveById[pid];
            return {
              id: p.id,
              question: p.question_text,
              type: p.type,
              options: p.options || null,
              correct: typeof p.correct_option_index === 'number' ? p.correct_option_index : null,
              explanation: p.explanation || null,
              ...(subj ? { score_given: subj.marks_awarded, ai_evaluation: subj.ai_remark } : {})
            };
          })
          .filter(Boolean);

        setResolvedResults({
          id: cloudRow.test_id,
          attemptId: cloudRow.id,
          title: cloudRow.title,
          questions: reconstructedQuestions,
          answers: cloudRow.answers || {},
          uploads: {}, // images are intentionally local-only, not synced to cloud
          timeLeft: cloudRow.raw_seconds ?? cloudRow.time_left ?? 0,
          timeTracker: cloudRow.time_tracker || {}
        });
        setIsResolving(false);
        return;
      } catch (err) {
        if (!cancelled) setResolveError("Network error — could not load this attempt. Please check your connection.");
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAttemptId, results]);


  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedQIdx, setSelectedQIdx] = useState(null);
  const [viewingImageFor, setViewingImageFor] = useState(null); // storage path currently being fetched

  // 🖼️ Fetch a short-lived signed URL for a private subjective-upload and
  // open it in a new tab. The bucket is private, so `file.path` alone can't
  // be rendered directly — the backend verifies ownership and hands back a
  // temporary link (10 min expiry) via /api/storage/signed-url.
  const handleViewUploadedImage = async (path) => {
    if (!path) {
      alert("This image could not be found — it may not have uploaded successfully at submit time.");
      return;
    }
    setViewingImageFor(path);
    try {
      const res = await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/storage/signed-url`, {
        method: 'POST',
        body: JSON.stringify({ path })
      });
      const data = await res.json();
      if (data.success && data.signedUrl) {
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      } else {
        alert(data.error || "Could not load this image right now.");
      }
    } catch (err) {
      console.error("Signed URL fetch failed:", err);
      alert("Network error — could not load this image.");
    } finally {
      setViewingImageFor(null);
    }
  };

  // 🔙 Make the device/browser back button close the Detailed Review popup
  // instead of leaving the page entirely. We push one extra history entry
  // when the popup opens; if the person hits back, popstate fires and we
  // just close the popup (no page navigation happens). If they close via
  // the on-screen Close button instead, we undo that extra history entry
  // ourselves so a *second* back press still behaves normally afterwards.
  useEffect(() => {
    if (selectedQIdx === null) return;
    window.history.pushState({ analysisPopup: true }, '');
    const handlePopState = () => {
      setSelectedQIdx(null);
      setShowExplanation(false);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [selectedQIdx]);

  const closeDetailedReview = () => {
    setSelectedQIdx(null);
    setShowExplanation(false);
    // Undo the extra history entry pushed when the popup opened, so back
    // navigation continues to behave normally instead of stacking up.
    // This POPS the entry rather than overwriting it in place: overwriting
    // left a second guard-flagged entry behind, which App.jsx's Analysis
    // Portal back-guard can't tell apart from the popup's own entry — the
    // next back press would then be swallowed instead of leaving the
    // portal. Popping restores the stack to exactly its pre-popup shape.
    if (window.history.state && window.history.state.analysisPopup) {
      window.history.back();
    }
  };
  const [showExplanation, setShowExplanation] = useState(false); 
  const [savedStatus, setSavedStatus] = useState({}); 
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [activeTab, setActiveTab] = useState('analysis'); // mobile only: 'analysis' | 'solutions'

  // Refs for swipe detection (mobile touch only) and section scroll targets
  const touchStartXRef = useRef(null);
  const touchStartYRef = useRef(null);
  const tabTouchStartXRef = useRef(null);
  const tabTouchStartYRef = useRef(null);
  const sectionRefs = useRef({});
  const detailScrollRef = useRef(null);

  // --- 📱 MOBILE DETECTION (JS-based, matches rest of codebase) ---
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- DATA EXTRACTION ---
  const { 
    questions = [], 
    answers = {}, 
    uploads = {}, 
    timeLeft = 0, 
    timeTracker = {}, 
    title = "Test Results", 
    id, 
    attemptId 
  } = resolvedResults || {};

  const totalQ = questions ? questions.length : 0;
  
  // ⚡ COMPUTE MARKS MAPPING ON GENUINE FIELDS
  const totalScore = questions.reduce((sum, q, idx) => {
    if (!q) return sum;
    if (q.type === 'Objective') {
      const correctAns = q.correct !== undefined ? q.correct : q.correctOptionIndex;
      if (answers[idx] !== undefined && answers[idx] !== null && parseInt(answers[idx]) === parseInt(correctAns)) {
        return sum + (parseFloat(String(q.marks || '2.0').replace('+', '')) || 2);
      } else if (answers[idx] !== undefined && answers[idx] !== null && answers[idx] !== "") {
        const parsedNeg = parseFloat(String(q?.neg || '-0.66').replace('+', ''));
        return sum + (parsedNeg < 0 ? parsedNeg : -parsedNeg); 
      }
    } else if (q.type === 'Subjective') {
      return sum + (parseFloat(q.score_given) || 0);
    }
    return sum;
  }, 0);

  const objectiveIndices = questions ? questions.map((q, i) => q.type === 'Objective' ? i : -1).filter(i => i !== -1) : [];
  
  const correctCount = objectiveIndices.filter(idx => {
    const q = questions[idx];
    if (!q) return false;
    const correctAns = q.correct !== undefined ? q.correct : q.correctOptionIndex;
    return answers[idx] !== undefined && parseInt(answers[idx]) === parseInt(correctAns);
  }).length;
  
  const incorrectCount = objectiveIndices.filter(idx => {
    const q = questions[idx];
    if (!q) return false;
    const correctAns = q.correct !== undefined ? q.correct : q.correctOptionIndex;
    return answers[idx] !== undefined && answers[idx] !== null && answers[idx] !== "" && parseInt(answers[idx]) !== parseInt(correctAns);
  }).length;

  const attemptedCount = questions ? questions.filter((_, i) => {
    const hasAns = answers[i] !== undefined && answers[i] !== null && answers[i] !== "";
    const hasUp = uploads[i] && uploads[i].length > 0;
    return hasAns || hasUp;
  }).length : 0;
  const unattemptedCount = totalQ - attemptedCount;

  const totalObjectiveAttempted = correctCount + incorrectCount;
  const accuracy = totalObjectiveAttempted > 0 ? Math.round((correctCount / totalObjectiveAttempted) * 100) : 0;

  // --- 🏆 RANKINGS (Test Series only) ---
  // AI Labs tests are single-student generated papers — no shared leaderboard
  // exists for them. Same signal used elsewhere in the app (TestPortal.jsx):
  // AI Labs test ids carry the "AI-" prefix ("AI-FULL-..." / "AI-TOPIC-...").
  const isTestSeriesTest = typeof id === 'string' && id.length > 0 && !id.startsWith('AI-');

  const [rankings, setRankings] = useState(null);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState(null);

  // Fetched once per test, regardless of which tab is showing — both the
  // Rankings tab and the Rank stat in the Test Summary read this same state,
  // so there is exactly one call per test view.
  useEffect(() => {
    // Nothing to reset on the way out: every render path below is gated on
    // isTestSeriesTest, so stale data from a previous test can never show.
    if (!isTestSeriesTest) return;
    let cancelled = false;
    setRankingsLoading(true);
    setRankingsError(null);
    (async () => {
      try {
        const res = await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/tests/rankings?testId=${encodeURIComponent(id)}`, {
          method: 'GET'
        });
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          setRankings({ top10: json.top10 || [], yourRank: json.yourRank || null });
        } else {
          setRankingsError(json.error || "Could not load rankings for this test.");
        }
      } catch (err) {
        console.error("Rankings fetch failed:", err);
        if (!cancelled) setRankingsError("Network error — could not load rankings. Please check your connection.");
      } finally {
        if (!cancelled) setRankingsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isTestSeriesTest]);

  // 🏆 The Rank stat card only exists once this student actually has a
  // placing on record: Test Series test, rankings resolved, and a yourRank
  // object present. AI Labs tests, an in-flight or failed fetch, and a
  // never-attempted test all fall through to the plain 5-card grid.
  const showRankCard = isTestSeriesTest && !!(rankings && rankings.yourRank);

  const totalNegativePenalty = objectiveIndices.reduce((sum, idx) => {
    const q = questions[idx];
    if (!q) return sum;
    const correctAns = q.correct !== undefined ? q.correct : q.correctOptionIndex;
    if (answers[idx] !== undefined && answers[idx] !== null && answers[idx] !== "" && parseInt(answers[idx]) !== parseInt(correctAns)) {
      const penalty = parseFloat(String(q.neg || '-0.66').replace('+', ''));
      return sum + (penalty < 0 ? Math.abs(penalty) : penalty);
    }
    return sum;
  }, 0);

  // --- BACKGROUND SCORE SYNC ---
  useEffect(() => {
    if (!id || !attemptId) return;
    const syncScoreWithLocalLibrary = async () => {
      const history = JSON.parse(localStorage.getItem('infinity_test_history')) || [];
      const updatedHistory = history.map(test => {
        if (test.attemptId === attemptId || (test.id === id && test.score === "Analyzing...")) {
          return { 
             ...test, 
             score: totalScore.toFixed(2), 
             accuracy: accuracy + "%" 
           };
        }
        return test;
      });
      localStorage.setItem('infinity_test_history', JSON.stringify(updatedHistory));

      try {
        const existingSession = await getFromLocalStore("test_sessions", attemptId);
        if (existingSession) {
          await saveToLocalStore("test_sessions", {
            ...existingSession,
            score: totalScore.toFixed(2),
            accuracy: accuracy 
          });
        }
      } catch (err) {
        console.error("Local sandbox score alignment loop failure:", err);
      }
    };
    
    // 🎯 FIXED SYNTAX ENGINE CALLING GATEWAY
    syncScoreWithLocalLibrary(); 
  }, [totalScore, accuracy, id, attemptId]);

  const handleSaveQuestion = async (e, q) => {
    if (e) e.stopPropagation(); 
    if (!q) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert("Your session expired. Please log in again to continue.");
        return;
      }

      const response = await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/pool/toggle-save`, {
        method: 'POST',
        body: JSON.stringify({
          questionId: q.id,
          saved: true
        })
      });
      const data = await response.json();

      if (data.success) {
        setSavedStatus(prev => ({ ...prev, [q.question]: true }));
        alert("Question saved to your library! 🔖");
      } else {
        // Most likely cause: this question isn't from the shared pool
        // (e.g. an admin-made test, or a test generated before the pool
        // system existed) — no ledger entry exists to attach a save to.
        alert("Bhai, ye question abhi cloud library mein save nahi ho sakta — sirf AI Lab se generate hue questions save hote hain filhaal.");
      }
    } catch (err) {
      console.error("Save to library failed:", err);
      alert("Network error — could not save the question. Please check your connection.");
    }
  };

  const formatTime = (sec) => {
    if (!sec || sec < 0) return "0s";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const getQStatus = (idx) => {
    if (!questions || !questions[idx]) return 'unattempted';
    const hasAns = answers[idx] !== undefined && answers[idx] !== null && answers[idx] !== "";
    const hasUp = uploads[idx] && uploads[idx].length > 0;
    if (!hasAns && !hasUp) return 'unattempted';
    if (questions[idx].type === 'Objective') {
      const correctAns = questions[idx].correct !== undefined ? questions[idx].correct : questions[idx].correctOptionIndex;
      return parseInt(answers[idx]) === parseInt(correctAns) ? 'correct' : 'incorrect';
    }
    return 'attempted';
  };

  const filteredIndices = questions ? questions.map((_, i) => i).filter(idx => {
    const status = getQStatus(idx);
    if (activeFilter === 'attempted') return status !== 'unattempted';
    if (activeFilter === 'unattempted') return status === 'unattempted';
    if (activeFilter === 'incorrect') return status === 'incorrect';
    return true;
  }) : [];

  // --- 🗂️ SECTION LIST (derived from questions[].section) ---
  // Preserves first-seen order of sections instead of alphabetical sort.
  const sectionList = [];
  questions.forEach(q => {
    const secName = q && q[SECTION_KEY] ? q[SECTION_KEY] : null;
    if (secName && !sectionList.includes(secName)) sectionList.push(secName);
  });
  const hasSections = sectionList.length > 1;

  const scrollToSection = (secName) => {
    const node = sectionRefs.current[secName];
    if (node && node.scrollIntoView) {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // --- 👉👈 SWIPE NAVIGATION (mobile touch only) ---
  // Navigates within filteredIndices so it respects whichever filter
  // (all / attempted / unattempted / incorrect) is currently active —
  // same navigable set used by the Previous/Next buttons.
  const goToAdjacentQuestion = (direction) => {
    if (selectedQIdx === null) return;
    const posInFiltered = filteredIndices.indexOf(selectedQIdx);
    if (posInFiltered === -1) return;
    const nextPos = posInFiltered + direction;
    if (nextPos < 0 || nextPos >= filteredIndices.length) return;
    setSelectedQIdx(filteredIndices[nextPos]);
    setShowExplanation(false);
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
  };

  const handleTouchStart = (e) => {
    if (!isMobile) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    if (!isMobile || touchStartXRef.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartXRef.current;
    const deltaY = touchEndY - touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;

    // Ignore mostly-vertical swipes (user is scrolling, not navigating)
    if (Math.abs(deltaY) > Math.abs(deltaX)) return;
    const SWIPE_THRESHOLD = 50;
    if (deltaX > SWIPE_THRESHOLD) {
      goToAdjacentQuestion(-1); // swipe right → previous
    } else if (deltaX < -SWIPE_THRESHOLD) {
      goToAdjacentQuestion(1); // swipe left → next
    }
  };

  const currentPosInFiltered = selectedQIdx !== null ? filteredIndices.indexOf(selectedQIdx) : -1;
  const isFirstInFiltered = currentPosInFiltered <= 0;
  const isLastInFiltered = currentPosInFiltered === filteredIndices.length - 1;

  // --- 👉👈 SWIPE BETWEEN TABS (mobile only, top-level Analysis/Solutions) ---
  const handleTabTouchStart = (e) => {
    if (!isMobile) return;
    tabTouchStartXRef.current = e.touches[0].clientX;
    tabTouchStartYRef.current = e.touches[0].clientY;
  };

  const handleTabTouchEnd = (e) => {
    if (!isMobile || tabTouchStartXRef.current === null) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - tabTouchStartXRef.current;
    const deltaY = endY - tabTouchStartYRef.current;
    tabTouchStartXRef.current = null;
    tabTouchStartYRef.current = null;

    if (Math.abs(deltaY) > Math.abs(deltaX)) return; // vertical scroll, ignore
    const SWIPE_THRESHOLD = 50;
    // Mirrors the tab bar's own order. Rankings joins the sequence only when
    // it is actually rendered (Test Series only) — on an AI Labs test this
    // stays the exact two-tab analysis <-> solutions swipe it has always been.
    const tabOrder = isTestSeriesTest ? ['analysis', 'solutions', 'rankings'] : ['analysis', 'solutions'];
    const currentIdx = tabOrder.indexOf(activeTab);
    if (currentIdx === -1) return;
    if (deltaX < -SWIPE_THRESHOLD && currentIdx < tabOrder.length - 1) {
      setActiveTab(tabOrder[currentIdx + 1]); // swipe left → next tab
    } else if (deltaX > SWIPE_THRESHOLD && currentIdx > 0) {
      setActiveTab(tabOrder[currentIdx - 1]); // swipe right → previous tab
    }
  };

  // 🏆 Rankings body — rendered identically by the mobile Rankings tab and
  // the desktop side panel, so the two can never drift apart and neither
  // needs its own loading/error treatment. Each host supplies its own
  // container and heading; this is only the contents.
  const renderRankingsBody = () => (
    <>
      {rankingsLoading && (
        <p style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: '600', margin: 0 }}>Loading rankings...</p>
      )}

      {!rankingsLoading && rankingsError && (
        <p style={{ fontSize: '0.85rem', color: '#dc2626', fontWeight: '700', margin: 0 }}>{rankingsError}</p>
      )}

      {!rankingsLoading && !rankingsError && rankings && (
        <>
          <div style={{ ...styles.topicSection, ...(isMobile ? styles.topicSectionMobile : {}) }}>
            {rankings.yourRank ? (
              <div style={{ ...styles.topicBadge, ...(isMobile ? styles.topicBadgeMobile : {}) }}>Your Rank: {rankings.yourRank.rank}/{rankings.yourRank.total_students}</div>
            ) : (
              <div style={{ ...styles.topicBadge, ...(isMobile ? styles.topicBadgeMobile : {}) }}>You haven't attempted this test yet.</div>
            )}
          </div>

          <div style={{ ...styles.listGrid, ...(isMobile ? styles.listGridMobile : { gridTemplateColumns: '1fr', gap: '10px' }), marginTop: '12px' }}>
            {rankings.top10.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic', margin: 0 }}>No one has attempted this test yet.</p>
            ) : rankings.top10.map((entry, rIdx) => (
              <div key={rIdx} style={{ ...styles.qCardSmall, ...(isMobile ? styles.qCardSmallMobile : {}), background: '#fff', borderColor: '#e2e8f0' }}>
                <div style={styles.cardHeader}>
                  <span style={styles.qNum}>#{rIdx + 1} {entry.full_name || 'Student'}</span>
                  <span style={{ fontWeight: '800', color: '#6366f1' }}>{entry.best_score}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );

  // 🧭 while resolving via URL (reload/direct hit), or if it failed, show a
  // minimal state instead of falling through to render against empty data.
  if (isResolving) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '14px', background: '#f8fafc' }}>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        <div style={{ width: '40px', height: '40px', border: '4px solid #e2e8f0', borderTopColor: '#1e293b', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: '600' }}>Loading your results...</p>
      </div>
    );
  }

  if (resolveError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '14px', background: '#f8fafc', padding: '24px', textAlign: 'center' }}>
        <p style={{ fontSize: '1rem', color: '#dc2626', fontWeight: '700' }}>Couldn't load this attempt</p>
        <p style={{ fontSize: '0.85rem', color: '#64748b', maxWidth: '360px' }}>{resolveError}</p>
        <button
          onClick={onBackToDashboard}
          style={{ marginTop: '8px', padding: '10px 20px', borderRadius: '10px', border: 'none', background: '#1e293b', color: '#fff', fontWeight: '700', fontSize: '0.85rem', cursor: 'pointer' }}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...styles.container, ...(isMobile ? styles.containerMobile : {}) }}>

      {/* ================= TOP HEADER (title, subtitle, back button) — always visible on mobile, above tabs ================= */}
      {isMobile && (
        <div style={styles.topHeaderMobile}>
          <h1 style={{margin:0, color:'#1e293b', fontSize:'1.15rem', wordBreak:'break-word'}}>Test Results: {title}</h1>
          <p style={{color:'#64748b', margin:'5px 0 0 0', fontSize:'0.8rem'}}>Here's your final analysis report:</p>
          <button onClick={onBackToDashboard} style={{ ...styles.homeBtn, ...styles.homeBtnMobile, marginTop: '10px' }}>Back to Dashboard</button>
        </div>
      )}

      {/* ================= MOBILE-ONLY TAB BAR ================= */}
      {isMobile && (
        <div style={styles.tabBarMobile}>
          <button
            onClick={() => setActiveTab('analysis')}
            style={{ ...styles.tabBtnMobile, ...(activeTab === 'analysis' ? styles.tabBtnActiveMobile : {}) }}
          >
            Test Analysis
          </button>
          <button
            onClick={() => setActiveTab('solutions')}
            style={{ ...styles.tabBtnMobile, ...(activeTab === 'solutions' ? styles.tabBtnActiveMobile : {}) }}
          >
            Solutions
          </button>
          {/* 🏆 Rankings — Test Series only; AI Labs papers have no leaderboard. */}
          {isTestSeriesTest && (
            <button
              onClick={() => setActiveTab('rankings')}
              style={{ ...styles.tabBtnMobile, ...(activeTab === 'rankings' ? styles.tabBtnActiveMobile : {}) }}
            >
              Rankings
            </button>
          )}
        </div>
      )}

      <div
        style={isMobile ? { width: '100%' } : { display: 'contents' }}
        onTouchStart={isMobile ? handleTabTouchStart : undefined}
        onTouchEnd={isMobile ? handleTabTouchEnd : undefined}
      >

      {/* ================= SECTION 1: TEST SUMMARY ================= */}
      {(!isMobile || activeTab === 'analysis') && (
      <div style={{ ...styles.summaryHeader, ...(isMobile ? styles.summaryHeaderMobile : {}) }}>
        {/* On desktop, title/subtitle/back-button live here (unchanged layout).
            On mobile, this same block is rendered once above the tabs instead —
            see topHeaderMobile above — so it doesn't disappear when switching tabs. */}
        {!isMobile && (
        <div style={styles.summaryHeaderMain}>
           <div>
             <h1 style={{margin:0, color:'#1e293b', fontSize:'1.5rem'}}>Test Results: {title}</h1>
             <p style={{color:'#64748b', margin:'5px 0 0 0', fontSize:'1rem'}}>Here's your final analysis report:</p>
           </div>
           <button onClick={onBackToDashboard} style={styles.homeBtn}>Back to Dashboard</button>
        </div>
        )}

        {/* Stat cards — compact 2-per-row grid on mobile, 5-across row on desktop */}
        {/* Desktop columns track the card count so the row stays evenly filled:
            6 across with the Rank card, the original 5 across without it. */}
        <div style={{ ...styles.mainStatsGrid, ...(isMobile ? styles.mainStatsGridMobile : {}), ...(!isMobile && showRankCard ? { gridTemplateColumns: 'repeat(6, 1fr)' } : {}) }}>
          <div style={{ ...styles.mainStatCard, ...(isMobile ? styles.mainStatCardMobile : {}) }}>
             <span style={{...styles.mainStatLabel, ...(isMobile ? styles.mainStatLabelMobile : {})}}>FINAL SCORE</span>
             <span style={{...styles.mainStatValue, color:'#6366f1', fontSize: isMobile ? '1.1rem' : '1.5rem'}}>{totalScore.toFixed(2)}</span>
          </div>
          {showRankCard && (
          <div style={{ ...styles.mainStatCard, ...(isMobile ? styles.mainStatCardMobile : {}) }}>
             <span style={{...styles.mainStatLabel, ...(isMobile ? styles.mainStatLabelMobile : {})}}>RANK</span>
             <span style={{...styles.mainStatValue, color:'#f59e0b', fontSize: isMobile ? '1.1rem' : '1.5rem'}}>{rankings.yourRank.rank}/{rankings.yourRank.total_students}</span>
          </div>
          )}
          <div style={{ ...styles.mainStatCard, ...(isMobile ? styles.mainStatCardMobile : {}) }}>
             <span style={{...styles.mainStatLabel, ...(isMobile ? styles.mainStatLabelMobile : {})}}>ACCURACY</span>
             <span style={{...styles.mainStatValue, color:'#22c55e', fontSize: isMobile ? '1.1rem' : '1.5rem'}}>{accuracy}%</span>
          </div>
          <div style={{ ...styles.mainStatCard, ...(isMobile ? styles.mainStatCardMobile : {}) }}>
             <span style={{...styles.mainStatLabel, ...(isMobile ? styles.mainStatLabelMobile : {})}}>CORRECT (MCQ)</span>
             <span style={{...styles.mainStatValue, color:'#22c55e', fontSize: isMobile ? '1.1rem' : '1.5rem'}}>{correctCount}</span>
          </div>
          <div style={{ ...styles.mainStatCard, ...(isMobile ? styles.mainStatCardMobile : {}) }}>
             <span style={{...styles.mainStatLabel, ...(isMobile ? styles.mainStatLabelMobile : {})}}>INCORRECT (MCQ)</span>
             <span style={{...styles.mainStatValue, color:'#ef4444', fontSize: isMobile ? '1.1rem' : '1.5rem'}}>{incorrectCount}</span>
          </div>
          {/* With the Rank card present the mobile grid holds 6 cards — three
              clean rows of two — so this one no longer needs to span the row
              to avoid being orphaned. Without it, the original 5-card layout
              (and this full-width last row) is preserved exactly. */}
          <div style={{ ...styles.mainStatCard, ...(isMobile ? (showRankCard ? styles.mainStatCardMobile : styles.mainStatCardFullRowMobile) : {}) }}>
             <span style={{...styles.mainStatLabel, ...(isMobile ? styles.mainStatLabelMobile : {})}}>UNATTEMPTED</span>
             <span style={{...styles.mainStatValue, color:'#94a3b8', fontSize: isMobile ? '1.1rem' : '1.5rem'}}>{unattemptedCount}</span>
          </div>
        </div>

        <div style={{ ...styles.topicSection, ...(isMobile ? styles.topicSectionMobile : {}) }}>
          <div style={{...styles.topicBadge, ...(isMobile ? styles.topicBadgeMobile : {})}}>Total Questions: {totalQ}</div>
          <div style={{...styles.topicBadge, ...(isMobile ? styles.topicBadgeMobile : {})}}>Negative Marks Penalty: {totalNegativePenalty.toFixed(2)}</div>
          <div style={{...styles.topicBadge, ...(isMobile ? styles.topicBadgeMobile : {})}}>Time Remaining: {formatTime(timeLeft)}</div>
        </div>
      </div>
      )}

      {/* 🖥️ On desktop, Solutions and Rankings sit side by side in a flex row.
          Everywhere else (mobile, or an AI Labs test with no leaderboard) this
          wrapper is display:contents, so the layout is exactly what it was
          before — Solutions simply stays a direct child of the container. */}
      <div style={!isMobile && isTestSeriesTest ? styles.splitRowDesktop : { display: 'contents' }}>

      {/* ================= SECTION 2: SOLUTIONS / QUESTIONS LIST ================= */}
      {(!isMobile || activeTab === 'solutions') && (
      <div style={{ ...styles.solutionsSection, ...(isMobile ? styles.solutionsSectionMobile : {}), ...(!isMobile && isTestSeriesTest ? { flex: 1, minWidth: 0 } : {}) }}>
        <h2 style={{ ...styles.solutionsSectionTitle, ...(isMobile ? styles.solutionsSectionTitleMobile : {}) }}>Solutions</h2>

        {/* Section nav — only shown for multi-section papers */}
        {hasSections && (
          <div style={{ ...styles.sectionNavBar, ...(isMobile ? styles.horizontalScrollMobile : {}) }}>
            {sectionList.map(secName => (
              <button
                key={secName}
                onClick={() => scrollToSection(secName)}
                style={{ ...styles.sectionNavBtn, ...(isMobile ? styles.noWrapMobile : {}) }}
              >
                {secName}
              </button>
            ))}
          </div>
        )}

        <div style={{ ...styles.filterBar, ...(isMobile ? styles.horizontalScrollMobile : {}) }}>
          {['all', 'attempted', 'unattempted', 'incorrect'].map(f => (
            <button key={f} 
               style={{
                 ...(activeFilter === f ? styles.activeFilter : styles.filterBtn),
                 ...(isMobile ? styles.noWrapMobile : {})
               }}
               onClick={() => setActiveFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ ...styles.listGrid, ...(isMobile ? styles.listGridMobile : {}) }}>
          {filteredIndices.map(idx => {
            if (!questions[idx]) return null;
            const status = getQStatus(idx);
            const isIncorrect = status === 'incorrect';
            const bgColor = status === 'correct' ? '#f0fdf4' : isIncorrect ? '#fef2f2' : '#fff';
            const borderColor = status === 'correct' ? '#22c55e' : isIncorrect ? '#ef4444' : '#e2e8f0';
            const isQuestionSaved = !!savedStatus[questions[idx].question];
            const secName = questions[idx][SECTION_KEY];

            // Attach a ref to the first card of each new section, so the
            // section nav bar can scroll to it.
            const isFirstOfSection = hasSections && secName && questions[idx - 1]?.[SECTION_KEY] !== secName;

            return (
              <div
                key={idx}
                ref={isFirstOfSection ? (node) => { sectionRefs.current[secName] = node; } : null}
                style={{ ...styles.qCardSmall, background: bgColor, borderColor: borderColor, ...(isMobile ? styles.qCardSmallMobile : {}) }}
                onClick={() => { setSelectedQIdx(idx); setShowExplanation(false); }}
              >
                <div style={styles.cardHeader}>
                  <span style={styles.qNum}>Question {idx + 1} ({questions[idx].type})</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      onClick={(e) => handleSaveQuestion(e, questions[idx])}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.05rem', padding: '2px', opacity: isQuestionSaved ? 1 : 0.35, transition: '0.15s ease' }}
                      title="Bookmark Question"
                    >
                      🔖
                    </button>
                    <span style={{ fontWeight: '800', color: isIncorrect ? '#ef4444' : '#22c55e' }}>
                       {/* 🚨 FIXED TARGET MAPPING KEY FROM selectedQIdx TO NATIVE LOOP INDEX */}
                       {questions[idx]?.type === 'Subjective' 
                         ? `${(questions[idx].score_given || 0).toFixed(1)} / ${parseFloat(String(questions[idx].marks || '10')).toFixed(1)}`
                         : (isIncorrect ? questions[idx].neg : (status === 'unattempted' ? '0.0' : questions[idx].marks))}
                    </span>
                  </div>
                </div>
                <p style={styles.qTruncated}><LatexText text={questions[idx].question} compactSpacing /></p>
                <div style={styles.smallTime}>⏱️ Time Taken: {formatTime(timeTracker[idx])}</div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* ================= SECTION 3a: RANKINGS — DESKTOP SIDE PANEL ================= */}
      {/* Its own scroll container (sticky + capped height + overflowY), so
          paging through Solutions never moves this list, and vice versa. */}
      {!isMobile && isTestSeriesTest && (
        <aside style={styles.rankingsPanelDesktop}>
          <h2 style={styles.solutionsSectionTitle}>Rankings</h2>
          {renderRankingsBody()}
        </aside>
      )}

      </div>

      {/* ================= SECTION 3b: RANKINGS — MOBILE TAB (Test Series only) ================= */}
      {isMobile && activeTab === 'rankings' && isTestSeriesTest && (
      <div style={{ ...styles.solutionsSection, ...styles.solutionsSectionMobile }}>
        <h2 style={{ ...styles.solutionsSectionTitle, ...styles.solutionsSectionTitleMobile }}>Rankings</h2>
        {renderRankingsBody()}
      </div>
      )}

      </div>

      {selectedQIdx !== null && questions[selectedQIdx] && (
        <div style={{ ...styles.overlay, ...(isMobile ? styles.overlayMobile : {}) }}>
          <div
            style={{ ...styles.detailContainer, ...(isMobile ? styles.detailContainerMobile : {}) }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div style={{ ...styles.detailHeader, ...(isMobile ? styles.detailHeaderMobile : {}) }}>
              <div style={{display:'flex', gap:'15px', alignItems:'center'}}>
                <h3 style={{margin:0, fontSize: isMobile ? '1rem' : '1.17rem'}}>Q. {selectedQIdx + 1} Detailed Review</h3>
                {!isMobile && <span style={styles.topicTag}>#EXAM_ANALYSIS</span>}
              </div>
              <button onClick={closeDetailedReview} style={styles.closeBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Close
              </button>
            </div>

            {isMobile && (
              <div style={styles.swipeHint}>← Swipe to navigate questions →</div>
            )}

            <div style={{ ...styles.detailBody, ...(isMobile ? styles.detailBodyMobile : {}) }}>
               
              <div style={{ ...styles.detailLeft, ...(isMobile ? styles.detailLeftMobile : {}) }}>
                <div ref={detailScrollRef} style={{ ...styles.detailLeftScrollArea, ...(isMobile ? styles.detailLeftScrollAreaMobile : {}) }}>
                  <div style={styles.metaRow}>
                    <span style={styles.metaItem}>⏱️ <strong>Your Time:</strong> {formatTime(timeTracker[selectedQIdx])}</span>
                    <span style={styles.metaItem}>📈 <strong>Score Given:</strong> {questions[selectedQIdx].type === 'Subjective' ? `${questions[selectedQIdx].score_given || 0} Marks` : ''}</span>
                  </div>
                  <p style={{...styles.detailText, fontSize: isMobile ? '0.95rem' : '1.05rem'}}><LatexText text={questions[selectedQIdx].question} compactSpacing /> </p>
                   
                  {questions[selectedQIdx].type === 'Objective' ? (
                    <div style={styles.detailOptions}>
                      {(questions[selectedQIdx].options || []).map((opt, oIdx) => {
                        const correctAns = questions[selectedQIdx].correct !== undefined ? questions[selectedQIdx].correct : questions[selectedQIdx].correctOptionIndex;
                        const isCorrect = oIdx === parseInt(correctAns);
                        const isUserChoice = answers[selectedQIdx] !== undefined && oIdx === parseInt(answers[selectedQIdx]);
                        
                        let borderStyle = '1px solid #e2e8f0';
                        let bgStyle = '#fff';
                        if (isCorrect) {
                          borderStyle = '2px solid #22c55e';
                          bgStyle = '#f0fdf4';
                        } else if (isUserChoice) {
                          borderStyle = '2px solid #ef4444';
                          bgStyle = '#fef2f2';
                        }
                        return (
                          <div key={oIdx} style={{
                            ...styles.detailOpt,
                            ...(isMobile ? styles.detailOptMobile : {}),
                            border: borderStyle,
                            background: bgStyle
                          }}>
                            <span>{String.fromCharCode(64 + oIdx + 1)}. <LatexText text={opt} compactSpacing /> </span>
                            {isCorrect && isUserChoice && <span style={{ color: '#22c55e', fontWeight: 'bold' }}>✨ Correct Answer & Your Choice</span>}
                            {isCorrect && !isUserChoice && <span style={{ color: '#16a34a', fontWeight: 'bold' }}>🎯 Correct Answer</span>}
                            {isUserChoice && !isCorrect && <span style={{ color: '#ef4444', fontWeight: 'bold' }}>❌ Your Wrong Choice</span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div style={styles.subAnalysis}>
                        <div style={styles.subPreview}>
                          <strong>Your Uploaded Answer Copy:</strong>
                          {uploads[selectedQIdx] && uploads[selectedQIdx].length > 0 ? (
                            <div style={styles.thumbGrid}>
                              {uploads[selectedQIdx].map((file, fi) => (
                                <div key={fi} style={{textAlign:'center', background:'#f8fafc', padding:'5px', borderRadius:'6px', border:'1px solid #e2e8f0'}}>
                                  <span style={{fontSize:'0.7rem', fontWeight:'bold', display:'block', color:'#64748b', marginBottom:'4px'}}>{file.name || "Handwritten Sheet"}</span>
                                  {file.path ? (
                                    <button
                                      onClick={() => handleViewUploadedImage(file.path)}
                                      disabled={viewingImageFor === file.path}
                                      style={{fontSize:'0.72rem', background:'#e0e7ff', color:'#4338ca', padding:'4px 8px', borderRadius:'4px', fontWeight:'bold', border:'none', cursor: viewingImageFor === file.path ? 'wait' : 'pointer'}}
                                    >
                                      {viewingImageFor === file.path ? "Loading..." : "🖼️ View Image"}
                                    </button>
                                  ) : (
                                    <span style={{fontSize:'0.72rem', background:'#fee2e2', color:'#991b1b', padding:'4px 8px', borderRadius:'4px', fontWeight:'bold'}}>Upload unavailable</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : <p style={{color:'#64748b', fontSize:'0.9rem', fontStyle:'italic'}}>{answers[selectedQIdx] || "No digital handwritten sheet snapshot uploaded."}</p>}
                        </div>
                      </div>

                      <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                        <strong style={{ color: '#4f46e5', fontSize: '0.9rem', display: 'block', marginBottom: '12px' }}>
                          📝 What You Covered (AI Point Summary):
                        </strong>
                        <ul style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '8px', listStyleType: 'square' }}>
                          {questions[selectedQIdx].ai_evaluation?.student_points ? (
                            questions[selectedQIdx].ai_evaluation.student_points.map((point, pIdx) => (
                              <li key={pIdx} style={{ fontSize: '0.92rem', color: '#334155', fontWeight: '600', lineHeight: '1.4' }}>
                                {point}
                              </li>
                            ))
                          ) : (
                            <li style={{ fontSize: '0.92rem', color: '#64748b', fontStyle: 'italic' }}>
                              Bhai, is subjective question ko attempt nahi kiya gaya tha.
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* On mobile, AI explanation is stacked inline below the question
                      instead of living in a separate side panel (see detailRight). */}
                  {(showExplanation || isMobile) && (
                    <div style={styles.inlineExplanationCard}>
                      <strong style={{ color: '#6366f1', display: 'block', marginBottom: '6px', fontSize: '0.95rem' }}>
                         {questions[selectedQIdx].type === 'Subjective' ? '🎯 Scope of Improvement Summary:' : '💡 AI Quick Resolution:'}
                      </strong>
                      <p style={{ margin: 0, fontSize: '0.92rem', color: '#334155', lineHeight: '1.5' }}>
                        {questions[selectedQIdx].type === 'Subjective'
                          ? <LatexText text={questions[selectedQIdx].ai_evaluation?.scope_of_improvement || "No recommendations generated."} />
                          : <LatexText text={questions[selectedQIdx].explanation || "No explanation available."} />
                        }
                      </p>
                    </div>
                  )}
                </div>

                <div style={{ ...styles.detailFixedNavRow, ...(isMobile ? styles.detailFixedNavRowMobile : {}) }}>
                  <button onClick={() => goToAdjacentQuestion(-1)} disabled={isFirstInFiltered} style={styles.navBtn}>
                    {isMobile ? '◀' : 'Previous'}
                  </button>
                  {!isMobile && (
                    <button onClick={() => setShowExplanation(!showExplanation)} style={{ ...styles.doubtBtn, background: showExplanation ? '#ef4444' : '#1e293b' }}>
                      {showExplanation ? "📖 Hide Explanation" : "💡 Show Explanation"}
                    </button>
                  )}
                  <button 
                    onClick={(e) => handleSaveQuestion(e, questions[selectedQIdx])}
                    disabled={!!savedStatus[questions[selectedQIdx].question]}
                    style={{ ...styles.doubtBtn, background: savedStatus[questions[selectedQIdx].question] ? '#10b981' : '#6366f1', color: '#fff', border: 'none' }}
                  >
                    {savedStatus[questions[selectedQIdx].question] ? (isMobile ? "📁 Saved" : "📁 Question Saved") : (isMobile ? "🔖 Save" : "🔖 Save to Library")}
                  </button>
                  <button onClick={() => goToAdjacentQuestion(1)} disabled={isLastInFiltered} style={styles.navBtn}>
                    {isMobile ? '▶' : 'Next'}
                  </button>
                </div>
              </div>

              {!isMobile && (
                <div style={styles.detailRight}>
                  <h4 style={styles.explanationTitle}>
                    {questions[selectedQIdx].type === 'Subjective' ? '🎯 AI Feedback Matrix:' : '🧠 AI Explanation & Analytical Working:'}
                  </h4>
                  <div style={styles.explanationText}>
                   {questions[selectedQIdx].type === 'Subjective'
                      ? <LatexText text={questions[selectedQIdx].ai_evaluation?.scope_of_improvement || "Bhai, is question ko evaluate nahi kiya gaya."} />
                      : <LatexText text={questions[selectedQIdx].explanation || "Bhai, is question ke liye koi detailed explanation store nahi hai."} />
                    }
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: { padding: '30px', background: '#f8fafc', minHeight: '100vh', width: '100%', boxSizing: 'border-box' },
  containerMobile: { padding: '8px', overflowX: 'hidden' },

  // ---------- MOBILE TOP HEADER (title/subtitle/back button, shown once above tabs) ----------
  topHeaderMobile: {
    background: '#fff',
    padding: '14px',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
    marginBottom: '10px',
    width: '100%',
    boxSizing: 'border-box',
  },

  // ---------- MOBILE TAB BAR (Analysis / Solutions) ----------
  tabBarMobile: {
    display: 'flex',
    width: '100%',
    boxSizing: 'border-box',
    background: '#eef0f4',
    borderRadius: '10px',
    padding: '3px',
    gap: '3px',
    marginBottom: '10px',
  },
  tabBtnMobile: {
    flex: 1,
    padding: '9px 4px',
    borderRadius: '8px',
    border: 'none',
    background: 'transparent',
    color: '#64748b',
    fontWeight: '700',
    fontSize: '0.78rem',
    cursor: 'pointer',
    textAlign: 'center',
  },
  tabBtnActiveMobile: {
    background: '#fff',
    color: '#1e293b',
    boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
  },

  // ---------- SECTION 1: SUMMARY ----------
  summaryHeader: { background: '#fff', padding: '30px', borderRadius: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', marginBottom: '30px', width: '100%', boxSizing: 'border-box' },
  summaryHeaderMobile: { padding: '12px', borderRadius: '12px', marginBottom: '0' },

  summaryHeaderMain: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' },
  summaryHeaderMainMobile: { flexDirection: 'column', alignItems: 'stretch', gap: '8px', marginBottom: '10px' },

  homeBtn: { background: '#1e293b', color: '#fff', border: 'none', padding: '12px 25px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' },
  homeBtnMobile: { padding: '9px', fontSize: '0.78rem', width: '100%', boxSizing: 'border-box' },

  // Desktop: 5-across grid. Mobile: compact 2-per-row grid (last card spans full row).
  mainStatsGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px', width: '100%', boxSizing: 'border-box' },
  mainStatsGridMobile: { gridTemplateColumns: '1fr 1fr', gap: '8px' },

  mainStatCard: { padding: '15px', background: '#f8fafc', borderRadius: '15px', textAlign: 'center', border: '1px solid #e2e8f0', width: '100%', boxSizing: 'border-box' },
  mainStatCardMobile: { padding: '10px 6px', borderRadius: '10px' },
  mainStatCardFullRowMobile: { padding: '10px 6px', borderRadius: '10px', gridColumn: '1 / -1' },

  mainStatLabel: { display: 'block', fontSize: '0.7rem', fontWeight: '900', color: '#94a3b8', marginBottom: '8px', letterSpacing: '0.5px' },
  mainStatLabelMobile: { fontSize: '0.6rem', marginBottom: '4px' },
  mainStatValue: { fontSize: '1.5rem', fontWeight: '900', color: '#1e293b' },

  topicSection: { display: 'flex', gap: '10px', marginTop: '20px' },
  topicSectionMobile: { flexDirection: 'column', gap: '6px', marginTop: '10px' },

  topicBadge: { background: '#f1f5f9', padding: '6px 15px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700', color: '#475569', boxSizing: 'border-box' },
  topicBadgeMobile: { width: '100%', textAlign: 'center', fontSize: '0.72rem', padding: '7px 10px' },

  // ---------- SECTION 2: SOLUTIONS ----------
  solutionsSection: { background: '#fff', padding: '30px', borderRadius: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', width: '100%', boxSizing: 'border-box' },
  splitRowDesktop: { display: 'flex', gap: '30px', alignItems: 'flex-start', width: '100%', boxSizing: 'border-box' },
  rankingsPanelDesktop: { background: '#fff', padding: '24px', borderRadius: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', width: '340px', flexShrink: 0, boxSizing: 'border-box', position: 'sticky', top: '30px', maxHeight: 'calc(100vh - 60px)', overflowY: 'auto' },
  solutionsSectionMobile: { padding: '12px', borderRadius: '12px' },

  solutionsSectionTitle: { margin: '0 0 20px 0', fontSize: '1.3rem', fontWeight: '900', color: '#1e293b' },
  solutionsSectionTitleMobile: { fontSize: '0.95rem', marginBottom: '10px' },

  sectionNavBar: { display: 'flex', gap: '8px', marginBottom: '18px', width: '100%', boxSizing: 'border-box' },
  sectionNavBtn: { background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', padding: '8px 16px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '800', cursor: 'pointer' },

  filterBar: { display: 'flex', gap: '10px', marginBottom: '25px', width: '100%', boxSizing: 'border-box' },
  filterBtn: { padding: '8px 18px', borderRadius: '20px', border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' },
  activeFilter: { padding: '8px 18px', borderRadius: '20px', border: 'none', background: '#6366f1', color: '#fff', fontWeight: 'bold', fontSize: '0.85rem' },

  // Shared pattern for horizontally-scrolling rows on mobile (section nav, filter bar)
  horizontalScrollMobile: { overflowX: 'auto', flexWrap: 'nowrap', WebkitOverflowScrolling: 'touch', paddingBottom: '4px', marginBottom: '12px' },
  noWrapMobile: { flexShrink: 0, whiteSpace: 'nowrap', padding: '6px 12px', fontSize: '0.72rem' },

  listGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px', width: '100%', boxSizing: 'border-box' },
  listGridMobile: { gridTemplateColumns: '1fr', gap: '8px' },

  qCardSmall: { padding: '15px', borderRadius: '12px', border: '2px solid', cursor: 'pointer', transition: '0.3s', width: '100%', maxWidth: '520px', margin: '0 auto', boxSizing: 'border-box' },
  qCardSmallMobile: { padding: '12px', borderRadius: '10px', maxWidth: '100%' },

  cardHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' },
  qNum: { fontWeight: '800', color: '#64748b', fontSize: '0.75rem' },
  qTruncated: { fontSize: '0.8rem', fontWeight: '600', margin: '0 0 10px 0', height: '2.3em', lineHeight: '1.15em', overflow: 'hidden' },
  smallTime: { fontSize: '0.7rem', color: '#94a3b8', fontWeight: '700' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.9)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', boxSizing: 'border-box' },
  overlayMobile: { padding: 0 },

  detailContainer: { background: '#fff', width: '100%', maxWidth: '1100px', height: '85vh', borderRadius: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' },
  detailContainerMobile: { height: '100vh', maxHeight: '100vh', width: '100vw', maxWidth: '100vw', borderRadius: 0 },

  detailHeader: { padding: '20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fcfdfe' },
  detailHeaderMobile: { padding: '14px 16px' },

  swipeHint: { textAlign: 'center', fontSize: '0.7rem', color: '#94a3b8', padding: '4px 0', background: '#fcfdfe', borderBottom: '1px solid #f1f5f9' },

  topicTag: { fontSize: '0.7rem', background: '#e0e7ff', color: '#4338ca', padding: '4px 12px', borderRadius: '15px', fontWeight: 'bold' },
  closeBtn: { background: '#F1EFFA', border: 'none', color: '#7065BA', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px' },

  detailBody: { display: 'flex', flex: 1, overflow: 'hidden' },
  detailBodyMobile: { flexDirection: 'column' },

  detailLeft: { flex: 1.2, display: 'flex', flexDirection: 'column', background: '#fff', borderRight: '1px solid #e2e8f0', overflow: 'hidden' },
  detailLeftMobile: { flex: 1, borderRight: 'none', width: '100%' },

  detailLeftScrollArea: { flex: 1, overflowY: 'auto', padding: '30px', boxSizing: 'border-box' },
  detailLeftScrollAreaMobile: { padding: '16px' },

  detailFixedNavRow: { padding: '20px 30px', background: '#fff', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '10px', flexShrink: 0, boxSizing: 'border-box' },
  detailFixedNavRowMobile: { padding: '12px 14px', gap: '8px' },

  detailRight: { flex: 0.8, padding: '30px', background: '#f8fafc', overflowY: 'auto' },
  explanationTitle: { margin: '0 0 15px 0', color: '#1e293b', fontSize: '1.05rem', fontWeight: '800' },
  explanationText: { color: '#475569', fontSize: '0.95rem', lineHeight: '1.6', fontWeight: '500' },

  metaRow: { display: 'flex', gap: '20px', marginBottom: '20px', borderBottom: '1px solid #f1f5f9', paddingBottom: '15px', flexWrap: 'wrap' },
  metaItem: { fontSize: '0.8rem', color: '#475569' },
  detailText: { fontSize: '1.05rem', fontWeight: '600', marginBottom: '20px', lineHeight: '1.35' },

  detailOptions: { display: 'grid', gap: '10px', boxSizing: 'border-box' },
  detailOpt: { padding: '12px 14px', borderRadius: '10px', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxSizing: 'border-box', maxWidth: '560px', margin: '0 auto', width: '100%' },
  detailOptMobile: { padding: '10px 12px', flexDirection: 'column', alignItems: 'flex-start', gap: '5px', fontSize: '0.8rem', maxWidth: '100%' },

  navBtn: { flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', fontWeight: 'bold', cursor: 'pointer' },
  doubtBtn: { flex: 1.5, background: '#1e293b', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s ease' },

  subAnalysis: { background: '#fff', border: '1px solid #e2e8f0', padding: '20px', borderRadius: '12px', boxSizing: 'border-box' },
  subPreview: { display: 'flex', flexDirection: 'column', gap: '10px' },
  thumbGrid: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' },
  prevImg: { width: '80px', height: '100px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #cbd5e1' },
  inlineExplanationCard: {
    marginTop: '25px',
    padding: '16px 20px',
    background: '#f0f9ff',
    borderRadius: '14px',
    borderLeft: '5px solid #0284c7',
    boxShadow: '0 4px 12px rgba(0,0,0,0.02)',
    textAlign: 'left',
    animation: 'fadeIn 0.2s ease',
    boxSizing: 'border-box'
  }
};

export default AnalysisPortal;
