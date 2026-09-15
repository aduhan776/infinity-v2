import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient'; 
import { authFetch } from '../utils/apiClient';
import LatexText from '../components/LatexText'; // 👈 YEH IMPORT GAYAB THA BHAI, AB FIXED HAI!

// --- BRAND ACCENT (same indigo used across the app — single source of truth) ---
const ACCENT = '#7065BA';

// --- 📏 DYNAMIC QUESTION FONT SIZE: longer questions shrink so options never overflow the card frame ---
const getQuestionFontSize = (text, isMobile) => {
  const len = (text || '').length;
  const maxSize = isMobile ? 1.15 : 1.5;
  const minSize = isMobile ? 0.85 : 0.95;
  if (len <= 60) return `${maxSize}rem`;
  if (len >= 220) return `${minSize}rem`;
  const ratio = (len - 60) / (220 - 60);
  const size = maxSize - ratio * (maxSize - minSize);
  return `${size.toFixed(2)}rem`;
};

// --- 🏷️ FIELD LABEL: renders a small theme-colored line icon beside the label text ---
const FieldIcon = ({ name }) => {
  const common = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: ACCENT, strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case 'exam':
      return <svg {...common}><path d="M22 10L12 5 2 10l10 5 10-5z" /><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" /></svg>;
    case 'subject':
      return <svg {...common}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
    case 'topic':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill={ACCENT} /></svg>;
    case 'difficulty':
      return <svg {...common}><path d="M4 20V12" /><path d="M12 20V6" /><path d="M20 20V9" /></svg>;
    case 'language':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" /></svg>;
    default:
      return null;
  }
};
const FieldLabel = ({ icon, children }) => (
  <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '6px' }}>
    <FieldIcon name={icon} />
    {children}
  </label>
);

// --- 🆕 Checkmark bullet used by the BrainFeed choice-screen cards ---
const ChecklistItem = ({ color = '#10b981', children }) => (
  <li className="ai-bullet-item" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '0.92rem', color: '#475569', fontWeight: '500', lineHeight: '1.5' }}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" style={{ marginTop: '2px', flexShrink: 0 }}><polyline points="20 6 9 17 4 12" /></svg>
    <span>{children}</span>
  </li>
);

const BrainFeed = () => {
  const navigate = useNavigate();
  // --- CONFIGURATION FORM STATES ---
  const [exam, setExam] = useState('');
  const [subjectSection, setSubjectSection] = useState('');
  const [subject, setSubject] = useState('');
  const [difficulty, setDifficulty] = useState('Medium');
  const [language, setLanguage] = useState('English');

  // --- CORE ENGINE STATES ---
  const [questions, setQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isFeedActive, setIsFeedActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0); 

  // --- TRACKING STATE FOR OPTIONS SELECTED & VAULT SAVES ---
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [savedStatus, setSavedStatus] = useState({}); 
  const [saveErrorFlash, setSaveErrorFlash] = useState('');
  const saveErrorFlashTimerRef = useRef(null);

  // --- 🎯 SERVER-VERIFIED RESULTS: correctness/explanation now only arrive
  // AFTER submitting an attempt to the backend (pool answers are hidden
  // upfront by design) — keyed by question index, same as selectedAnswers.
  const [answerResults, setAnswerResults] = useState({});

  // --- IN-CARD INLINE VALIDATION WARNING STATE ---
  const [showWarning, setShowWarning] = useState(false);

  // --- MODAL POPUP WINDOW STATES ---
  const [showEndModal, setShowEndModal] = useState(false);
  const [hasLoadedMore, setHasLoadedMore] = useState(false); // caps Load More to once per session (15 -> 30, no chaining beyond that)
  const [showExitWarning, setShowExitWarning] = useState(false);
  
  // --- IN-APP WINDOW NOTIFICATION STATE ---
  const [customAlert, setCustomAlert] = useState({ show: false, title: '', message: '' });

  // --- SESSION METRICS SUMMARY FOR END CARD ---
  const [metricsSummary, setMetricsSummary] = useState({
    sessionAccuracy: 0,
    beforeAccuracy: 0,
    newAccuracy: 0,
    attempted: 0,
    correct: 0
  });

  // --- 📱 MOBILE SCREEN DETECTION (so the card layout can adapt) ---
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- 🆕 LANDING VIEW: 'choice' (2 cards) -> 'form' (existing config form) or 'history' (past sessions list) ---
  const [landingView, setLandingView] = useState('choice');
  const [brainfeedCredits, setBrainfeedCredits] = useState(null); // null = not loaded yet
  const [historySessions, setHistorySessions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [pastSessionLoadingId, setPastSessionLoadingId] = useState(null); // which history row's "Revise" button is loading

  // --- 🆕 SESSION UUID: client-generated, used as both the credit_transactions
  // "reference" (for both the fresh-load and Load More deductions) and as the
  // brainfeed_sessions row's own id when the session is eventually saved. ---
  const [sessionUUID, setSessionUUID] = useState(null);
  const sessionUUIDRef = useRef(null); // avoids stale-closure issues inside async handlers

  // --- 🆕 Fetch current BrainFeed credit balance for the top-right quota badge on the choice screen ---
  const fetchBrainfeedCredits = async () => {
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/brainfeed/history`, {
        method: 'GET'
      });
      const data = await response.json();
      if (data.success) {
        setBrainfeedCredits(typeof data.brainfeedCredits === 'number' ? data.brainfeedCredits : 0);
      }
    } catch (err) {
      console.warn("Could not fetch BrainFeed credits (non-blocking):", err);
    }
  };

  useEffect(() => {
    fetchBrainfeedCredits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 🆕 Fetch the list of past BrainFeed sessions for the "Revise Previous Sessions" screen ---
  const fetchBrainfeedHistory = async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/brainfeed/history`, {
        method: 'GET'
      });
      const data = await response.json();
      if (data.success) {
        setHistorySessions(data.sessions || []);
        setBrainfeedCredits(typeof data.brainfeedCredits === 'number' ? data.brainfeedCredits : 0);
      } else {
        setHistoryError(data.error || 'Could not load your past sessions.');
      }
    } catch (err) {
      console.error("Failed to fetch BrainFeed history:", err);
      setHistoryError('Network error — could not load your past sessions.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleOpenHistory = () => {
    setLandingView('history');
    fetchBrainfeedHistory();
  };

  const handleOpenNewSessionForm = () => {
    setLandingView('form');
  };

  const handleBackToChoice = () => {
    setLandingView('choice');
    fetchBrainfeedCredits(); // keep the badge fresh in case a session just completed
  };

  // --- 🆕 REVISE A PAST SESSION (from history list): fetch full question content by id
  // (answers hidden nowhere here — this is explicitly a review, so we ask the backend for
  // the same question rows AnalysisPortal uses) and reconstruct answerResults locally,
  // same pattern as AI Labs' AnalysisPortal. Read-only: no attempts_ledger writes, no
  // credit consumption, no profile stat changes — this is purely viewing history. ---
  const handleRevisePastSession = async (session) => {
    setPastSessionLoadingId(session.id);
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/brainfeed/questions-by-ids`, {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.id, questionIds: session.questionIdsRaw })
      });
      const data = await response.json();
      if (!data.success || !Array.isArray(data.questions)) {
        setCustomAlert({ show: true, title: 'Could Not Load Session', message: data.error || 'This session\'s questions could not be loaded.' });
        return;
      }

      // Reconstruct in the same order as the stored question_ids / answers arrays.
      const questionMap = {};
      data.questions.forEach(q => { questionMap[q.id] = q; });

      const orderedQuestions = session.questionIdsRaw.map(qid => {
        const q = questionMap[qid];
        if (!q) return null;
        return {
          id: q.id,
          question: q.question_text || q.question,
          options: q.options || ["A", "B", "C", "D"],
          correct: q.correct_option_index,
          explanation: q.explanation || "Verified conceptual reference."
        };
      }).filter(Boolean);

      const restoredAnswers = {};
      const restoredResults = {};
      session.answersRaw.forEach((optIdx, idx) => {
        if (optIdx === null || optIdx === undefined) return;
        const q = orderedQuestions[idx];
        if (!q) return;
        restoredAnswers[idx] = optIdx;
        restoredResults[idx] = {
          isCorrect: optIdx === q.correct,
          correctOptionIndex: q.correct,
          explanation: q.explanation
        };
      });

      setQuestions(orderedQuestions);
      setSelectedAnswers(restoredAnswers);
      setAnswerResults(restoredResults);
      setCurrentIdx(0);
      setSessionMode('revise');
      setIsFeedActive(true);
    } catch (err) {
      console.error("Failed to load past session for revise:", err);
      setCustomAlert({ show: true, title: 'Network Error', message: 'Could not load this session. Please try again.' });
    } finally {
      setPastSessionLoadingId(null);
    }
  };

  // --- 🔁 SESSION MODE: 'live' (normal), 'reattempt' (redo, stats not saved), 'revise' (read-only scroll-through) ---
  const [sessionMode, setSessionMode] = useState('live');
  const viewportRef = useRef(null);
  const scrollDebounceTimer = useRef(null);
  const lastQuestionTimerRef = useRef(null);
  const awaitingCompletionRef = useRef(false);
  const pendingCompletionDataRef = useRef(null);
  const pendingLedgerWritesRef = useRef([]); // tracks in-flight submit-attempt promises, so Load More can wait for them to land before re-querying the ledger

  // --- 🆕 BEST-EFFORT SAVE ON TAB CLOSE / BACKGROUNDING ---
  // Placed here, below every piece of state it reads: a hook's dependency
  // array is evaluated during render, so listing `sessionMode` (etc.) in it
  // from above their useState lines threw "Cannot access ... before
  // initialization" and blanked the page.
  // visibilitychange fires reliably when a tab is closed, the browser is
  // closed, or the app goes to background (including most "swipe away from
  // Recent Apps" cases on mobile, since the OS backgrounds the webview
  // before it actually kills the process). sendBeacon is used instead of
  // fetch because it's specifically designed to survive page teardown —
  // fetch calls can get silently cancelled mid-flight when a tab closes.
  // This only fires while a live session is actually in progress; it saves
  // as incomplete (is_completed: false), never touching cumulative stats
  // (that only happens via the normal complete-session call), so it can't
  // double-count anything if the student later resumes and finishes.
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'hidden') return;
      if (!isFeedActive || sessionMode !== 'live' || !sessionUUIDRef.current) return;
      if (questions.length === 0) return;

      const attempted = Object.keys(selectedAnswers).length;
      if (attempted === 0) return; // nothing answered yet — nothing worth saving

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const correct = Object.values(answerResults).filter(r => r.isCorrect).length;
        const questionIds = questions.map(q => q.id);
        const answersArray = questions.map((_, idx) => (selectedAnswers[idx] !== undefined ? selectedAnswers[idx] : null));

        const payload = JSON.stringify({
          accessToken: session.access_token,
          sessionUUID: sessionUUIDRef.current,
          questionIds,
          answers: answersArray,
          attempted,
          correct,
          exam, subjectSection, subject
        });

        navigator.sendBeacon(
          `${import.meta.env.VITE_API_BASE_URL}/api/brainfeed/beacon-save`,
          new Blob([payload], { type: 'application/json' })
        );
      } catch (err) {
        // Best-effort only — nothing else we can do if this fails at teardown time.
        console.warn("Beacon save skipped:", err);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isFeedActive, sessionMode, questions, selectedAnswers, answerResults, exam, subjectSection, subject]);

  // --- 🧭 PHASE 4: BRAINFEED SESSION RESUME (local-only) ---
  // Two different situations, two different behaviors:
  //   • RELOAD mid-session (same browser tab/session) → resume silently,
  //     exactly like TestPortal's autosave — no modal, no interruption.
  //   • FRESH VISIT to BrainFeed (a different/new tab session, or coming
  //     back later) with a saved-but-not-finished session sitting around
  //     → ask first, with details (exam/subject/topic/progress), never
  //     silently drop them into an old session or silently discard it.
  //
  // The distinguishing signal: sessionStorage is unique per browser tab and
  // is cleared when that tab closes, but survives a same-tab reload —
  // unlike localStorage (survives everything) or React state (survives
  // nothing). So: a sessionStorage marker present = "this is the same tab
  // that was running the session, just reloaded" = silent resume.
  // Marker absent but a localStorage session exists = "new tab/visit,
  // stumbled on an old unfinished session" = ask first.
  const BRAINFEED_SESSION_KEY = 'infinity_brainfeed_session';
  const BRAINFEED_TAB_MARKER_KEY = 'infinity_brainfeed_active_tab';
  const [resumePrompt, setResumePrompt] = useState(null); // null = not checked yet / none found
  const [isRestoringSilently, setIsRestoringSilently] = useState(true); // true until the initial check completes

  // 🐛 TDZ FIX: these two are defined here — ABOVE every function that calls
  // them — because `const` arrow functions are in the temporal dead zone
  // until their definition line runs. handleDiscardSession (below) calls
  // clearSavedBrainFeedSession, and handleSaveToLibrary calls
  // showSaveErrorFlash; with both defined further down the file, those calls
  // threw "Cannot access '...' before initialization" and blanked the page.

  // Clearing the saved session belongs only at points where the session is
  // genuinely, finally done — not inside the shared reset function used by
  // every exit path (that broke "Save and Exit").
  const clearSavedBrainFeedSession = () => {
    try {
      localStorage.removeItem(BRAINFEED_SESSION_KEY);
      sessionStorage.removeItem(BRAINFEED_TAB_MARKER_KEY);
    } catch (e) { /* ignore */ }
  };

  // Small, non-blocking inline error line — auto-dismisses after ~3.5s.
  const showSaveErrorFlash = () => {
    setSaveErrorFlash("Could not save this question — please try again.");
    clearTimeout(saveErrorFlashTimerRef.current);
    saveErrorFlashTimerRef.current = setTimeout(() => setSaveErrorFlash(''), 3500);
  };

  const restoreSession = (saved) => {
    const restoredIdx = saved.currentIdx || 0;
    setQuestions(saved.questions);
    setSelectedAnswers(saved.selectedAnswers || {});
    setAnswerResults(saved.answerResults || {});
    setCurrentIdx(restoredIdx);
    setExam(saved.exam || '');
    setSubjectSection(saved.subjectSection || '');
    setSubject(saved.subject || '');
    setDifficulty(saved.difficulty || 'Medium');
    setLanguage(saved.language || 'English');
    // 🆕 Restore the same sessionUUID this saved session was using, so that
    // completing it now updates the same brainfeed_sessions row (and any
    // future deduct-credit calls, e.g. Load More, reference the same session)
    // instead of creating a duplicate.
    const restoredUUID = saved.sessionUUID || crypto.randomUUID();
    sessionUUIDRef.current = restoredUUID;
    setSessionUUID(restoredUUID);
    setIsFeedActive(true);
    setSessionMode('live');
    // 📱 MOBILE: position is driven by native scroll (scroll-snap), not the
    // currentIdx transform — same fix as Load More, wait a tick for the
    // restored cards to render before jumping scroll to the right one.
    if (isMobile) {
      requestAnimationFrame(() => {
        const el = viewportRef.current;
        if (el) el.scrollTo({ top: restoredIdx * el.clientHeight, behavior: 'auto' });
      });
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BRAINFEED_SESSION_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      const hasSavedSession = saved && Array.isArray(saved.questions) && saved.questions.length > 0;
      const isSameTabReload = sessionStorage.getItem(BRAINFEED_TAB_MARKER_KEY) === '1';

      if (hasSavedSession && isSameTabReload) {
        // Reload mid-session — restore silently, no modal.
        restoreSession(saved);
        setResumePrompt(false);
        setIsRestoringSilently(false);
        return;
      }
      if (hasSavedSession) {
        // Fresh visit, an unfinished session is sitting there — ask first.
        setResumePrompt(saved);
        setIsRestoringSilently(false);
        return;
      }
    } catch (e) {
      console.error("Failed to read saved BrainFeed session:", e);
    }
    setResumePrompt(false);
    setIsRestoringSilently(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark this tab as "actively running BrainFeed" for as long as a live
  // session is in progress — this is what lets a same-tab reload be told
  // apart from a genuinely fresh visit.
  useEffect(() => {
    if (isFeedActive && sessionMode === 'live') {
      sessionStorage.setItem(BRAINFEED_TAB_MARKER_KEY, '1');
    }
  }, [isFeedActive, sessionMode]);

  const handleResumeSession = () => {
    if (!resumePrompt) return;
    restoreSession(resumePrompt);
    setResumePrompt(false);
  };

  const handleDiscardSession = async () => {
    // 🆕 Before discarding, make sure whatever was answered actually made it
    // to brainfeed_sessions — this specifically covers the case where the
    // student never got a chance to trigger a normal save (e.g. an actual
    // app crash, not a graceful "Save and Exit"), so no row exists yet at
    // all. If a row already exists (from a prior Save and Exit or beacon
    // save), this just re-saves the same data — harmless, same sessionUUID.
    if (resumePrompt && resumePrompt.sessionUUID) {
      const answersData = resumePrompt.selectedAnswers || {};
      const resultsData = resumePrompt.answerResults || {};
      const attempted = Object.keys(answersData).length;

      if (attempted > 0) {
        const correct = Object.values(resultsData).filter(r => r.isCorrect).length;
        const questionIds = (resumePrompt.questions || []).map(q => q.id);
        const answersArray = (resumePrompt.questions || []).map((_, idx) => (answersData[idx] !== undefined ? answersData[idx] : null));

        try {
          await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/brainfeed/complete-session`, {
            method: 'POST',
            body: JSON.stringify({
              sessionUUID: resumePrompt.sessionUUID,
              questionIds,
              answers: answersArray,
              attempted,
              correct,
              isCompleted: false,
              exam: resumePrompt.exam,
              subjectSection: resumePrompt.subjectSection,
              subject: resumePrompt.subject
            })
          });
        } catch (err) {
          // Best-effort — if this fails, the credit ledger row still exists
          // as a record that a credit was spent, even if the content isn't saved.
          console.warn("Could not save partial session before discarding:", err);
        }
      }
    }

    clearSavedBrainFeedSession();
    // The old sessionUUID is left as-is now that its data (if any) is saved —
    // we just stop referencing it going forward.
    sessionUUIDRef.current = null;
    setSessionUUID(null);
    setResumePrompt(false);
  };

  // Keep the saved session in sync while a live session is actually in progress.
  useEffect(() => {
    if (!isFeedActive || sessionMode !== 'live' || questions.length === 0) return;
    try {
      localStorage.setItem(BRAINFEED_SESSION_KEY, JSON.stringify({
        questions, selectedAnswers, answerResults, currentIdx,
        exam, subjectSection, subject, difficulty, language,
        sessionUUID: sessionUUIDRef.current
      }));
    } catch (e) {
      console.error("Failed to save BrainFeed session locally:", e);
    }
  }, [questions, selectedAnswers, answerResults, currentIdx, isFeedActive, sessionMode]);

  // --- 🏁 Fires the end-of-session summary — called either after the 7s grace period
  // on the last question, or the moment the person tries to interact with it again.
  const finishMobileSession = () => {
    if (!awaitingCompletionRef.current) return;
    awaitingCompletionRef.current = false;
    clearTimeout(lastQuestionTimerRef.current);
    const data = pendingCompletionDataRef.current;
    if (sessionMode === 'live') saveSessionMetricsToProfile(data?.answers, data?.results);
    setShowEndModal(true);
  };

  // --- 📱 MOBILE: once the scroll has settled on a new card, sync currentIdx to it.
  // 🐛 FIX: the touchmove guard below only catches forward swipes it sees live —
  // a fast/hard flick can trigger native momentum scrolling that continues
  // *after* touchmove stops firing, carrying the viewport past an unanswered
  // question with nothing left to intercept it. So this settle-handler now
  // also hard-checks: if the scroll landed past the first unanswered question,
  // snap back to that unanswered question instead of accepting the skip.
  // Backward (to any already-answered card) is always left completely free.
  const handleFeedScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    clearTimeout(scrollDebounceTimer.current);
    scrollDebounceTimer.current = setTimeout(() => {
      const newIdx = Math.round(el.scrollTop / el.clientHeight);
      if (newIdx === currentIdx || newIdx < 0 || newIdx >= questions.length) return;

      const movingForward = newIdx > currentIdx;
      if (movingForward && selectedAnswers[currentIdx] === undefined) {
        // Snap back to the unanswered question the scroll tried to skip past.
        el.scrollTo({ top: currentIdx * el.clientHeight, behavior: 'auto' });
        setShowWarning(true);
        return;
      }

      setShowWarning(false);
      setCurrentIdx(newIdx);
    }, 120);
  };

  // --- 📱 MOBILE: block a forward swipe BEFORE it ever starts scrolling (via preventDefault),
  // so there's no fight with the browser's own snap animation — no jitter, just a hard stop.
  // Backward (to a previous, already-answered card) is always left completely free.
  useEffect(() => {
    if (!isMobile || !isFeedActive) return;
    const el = viewportRef.current;
    if (!el) return;

    let touchStartY = 0;
    const onTouchStart = (e) => { touchStartY = e.touches[0].clientY; };
    const onTouchMoveNative = (e) => {
      if (awaitingCompletionRef.current) {
        finishMobileSession();
        return;
      }
      const movingForward = e.touches[0].clientY < touchStartY;
      if (movingForward && selectedAnswers[currentIdx] === undefined) {
        e.preventDefault();
        setShowWarning(true);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMoveNative, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMoveNative);
    };
  }, [isMobile, isFeedActive, currentIdx, selectedAnswers, sessionMode]);

  // --- 📱 MOBILE: whenever we jump into revise/reattempt mode, snap the scroll view back to question 1 ---
  useEffect(() => {
    if (isMobile && isFeedActive && viewportRef.current && (sessionMode === 'reattempt' || sessionMode === 'revise')) {
      viewportRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [sessionMode]);

  const difficultyLevels = [
    { label: 'Easy', value: 'Easy' },
    { label: 'Medium', value: 'Medium' },
    { label: 'Hard', value: 'Tough' }
  ];

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (isFeedActive) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => { document.body.style.overflow = 'auto'; };
  }, [isFeedActive]);

  useEffect(() => {
    if (!isFeedActive || showEndModal || showExitWarning || loading) return;
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleNextCard();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrevCard();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFeedActive, currentIdx, selectedAnswers, questions, showEndModal, showExitWarning, loading]);

  const fetchBrainFeedPacket = async (isLoadMore = false) => {
    if (!exam.trim()) {
       setCustomAlert({ show: true, title: 'Required Field', message: 'Please enter a Target Exam to continue.' });
       return;
     }
    if (!subjectSection.trim()) {
       setCustomAlert({ show: true, title: 'Required Field', message: 'Please enter a Subject / Section to continue.' });
       return;
     }
    if (!subject.trim()) {
       setCustomAlert({ show: true, title: 'Required Field', message: 'Please enter a Topic to continue.' });
       return;
     }
    if (cooldown > 0) {
       setCustomAlert({ show: true, title: 'Security Cooldown', message: `Please wait ${cooldown} seconds before making another request.` });
       return;
     }
    setLoading(true);
    try {
      // ⏳ On Load More, the last few submit-attempt calls from the batch that
      // just ended may still be in flight (they're fire-and-forget so the UI
      // never waited on them). If we query the ledger before those land, those
      // questions look "unseen" instead of "incorrect" and can slip back into
      // the very next batch. Wait for them here, but with a hard cap — if a
      // write is genuinely stuck (bad network etc.), we'd rather risk one
      // resurfaced question than freeze the whole session on Load More.
      if (isLoadMore && pendingLedgerWritesRef.current.length > 0) {
        const safetyTimeout = new Promise(resolve => setTimeout(resolve, 2500));
        await Promise.race([Promise.allSettled(pendingLedgerWritesRef.current), safetyTimeout]);
        pendingLedgerWritesRef.current = [];
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setCustomAlert({ show: true, title: 'Authentication Required', message: 'Your session expired. Please log in again to continue.' });
        setLoading(false);
        return;
      }

      // 🆕 The sessionUUID is generated up front (a fresh load gets a brand-new
      // one; Load More reuses the same one so both deductions reference the
      // same logical session), but the credit is NOT deducted yet — see below.
      const activeSessionUUID = isLoadMore ? sessionUUIDRef.current : crypto.randomUUID();

      const response = await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/pool/build-test`, {
        method: 'POST',
        body: JSON.stringify({
          exam: exam,
          subject: subjectSection,
          topic: subject,
          count: 15,
          type: 'Objective',
          difficulty: difficulty,
          language: language,
          origin: 'brainfeed',
          revealAnswers: true,
          skipResurfacing: isLoadMore
        })
      });
      const data = await response.json();
      if (data.success && data.questions && data.questions.length > 0) {
        // 🆕 CREDIT DEDUCTION — only now, once the questions have actually been
        // served. Deducting before this call meant an upstream failure (e.g.
        // Gemini returning 503 under load) still cost the student a credit for
        // questions they never received. Deducting here keeps the anti-abuse
        // property that matters — the credit is spent the moment questions are
        // handed over, not when the session is finished — without charging for
        // failures.
        if (!isLoadMore) {
          sessionUUIDRef.current = activeSessionUUID;
          setSessionUUID(activeSessionUUID);
        }

        try {
          const creditResponse = await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/brainfeed/deduct-credit`, {
            method: 'POST',
            body: JSON.stringify({ sessionUUID: activeSessionUUID, exam, subjectSection, subject })
          });
          const creditData = await creditResponse.json();
          if (creditData.success && typeof creditData.updatedBrainfeedCredits === 'number') {
            setBrainfeedCredits(creditData.updatedBrainfeedCredits);
          }
        } catch (creditErr) {
          // Non-blocking: don't stop the student from practicing over a credit-tracking hiccup.
          console.warn("Could not deduct BrainFeed credit (non-blocking):", creditErr);
        }

        // 🎯 Answer comes bundled upfront now (same trade-off as AI Labs) —
        // instant feedback on select, no "checking..." round-trip. Ledger
        // logging still happens, just silently in the background.
        const mappedQuestions = data.questions.map(q => ({
          id: q.id,
          question: q.question,
          options: q.options || ["A", "B", "C", "D"],
          correct: q.correctOptionIndex !== undefined ? q.correctOptionIndex : 0,
          explanation: q.explanation || "Verified conceptual reference."
        }));
        if (isLoadMore) {
          const oldLen = questions.length;
          setQuestions([...questions, ...mappedQuestions]);
          setCurrentIdx(oldLen); 
          setShowWarning(false);
          setShowEndModal(false);
          setHasLoadedMore(true);
          // 📱 MOBILE FIX: card position on mobile is driven purely by native
          // scroll (scroll-snap), not by the currentIdx transform. Without this,
          // closing the summary modal leaves the viewport scrolled to the last
          // (already-answered) card of the previous batch instead of the new one,
          // making the session look "stuck". Wait a tick for the new cards to
          // actually render before jumping the scroll position.
          if (isMobile) {
            requestAnimationFrame(() => {
              const el = viewportRef.current;
              if (el) el.scrollTo({ top: oldLen * el.clientHeight, behavior: 'auto' });
            });
          }
        } else {
          setQuestions(mappedQuestions);
          setCurrentIdx(0);
          setSelectedAnswers({});
          setAnswerResults({});
          setSavedStatus({});
          setShowWarning(false);
          setIsFeedActive(true);
          setHasLoadedMore(false);
        }
      } else if (data.upstreamBusy || response.status === 503) {
        // Generator is overloaded upstream. Deliberately generic — the student
        // doesn't need (or want) the underlying provider error, just what it
        // means for them and what to do. No credit was spent either, since
        // deduction only happens on success above.
        setCustomAlert({
          show: true,
          title: 'Server Is Busy',
          message: 'A lot of people are using the app right now, so we could not prepare your questions. Please try again in a little while — you have not been charged for this attempt.'
        });
        setCooldown(30);
      } else {
        setCustomAlert({
          show: true,
          title: 'Server Is Busy',
          message: 'We could not prepare your questions right now. Please try again in a little while — you have not been charged for this attempt.'
        });
        setCooldown(30);
      }
    } catch (error) {
      console.error("BrainFeed Network Sync Crash:", error);
      // Covers network failures and cold starts (the server sleeps after a
      // period of inactivity and takes a few seconds to wake up). Same
      // generic wording — from the student's side it's the same situation.
      setCustomAlert({
        show: true,
        title: 'Server Is Busy',
        message: 'A lot of people are using the app right now, so we could not prepare your questions. Please try again in a little while — you have not been charged for this attempt.'
      });
      setCooldown(30);
    } finally {
      setLoading(false);
    }
  };

  const handleNextCard = () => {
    if (selectedAnswers[currentIdx] === undefined) {
      setShowWarning(true);
      return;
    }
    setShowWarning(false); 
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(prev => prev + 1);
    } else {
      if (sessionMode === 'live') saveSessionMetricsToProfile();
      setShowEndModal(true);
    }
  };

  const handlePrevCard = () => {
    setShowWarning(false); 
    if (currentIdx > 0) {
      setCurrentIdx(prev => prev - 1);
    }
  };

  const handleOptionSelect = (targetIdx, optIdx) => {
    if (selectedAnswers[targetIdx] !== undefined) return;
    setShowWarning(false);

    const lockedIdx = targetIdx;
    const q = questions[lockedIdx];

    const updatedAnswers = { ...selectedAnswers, [lockedIdx]: optIdx };
    const updatedResults = {
      ...answerResults,
      [lockedIdx]: {
        isCorrect: optIdx === q.correct,
        correctOptionIndex: q.correct,
        explanation: q.explanation
      }
    };
    setSelectedAnswers(updatedAnswers);
    setAnswerResults(updatedResults);

    // 🎯 Silent background ledger log — never blocks or delays the UI.
    // If this fails (network hiccup), the student never even sees it;
    // it just means this one attempt won't count toward pool resurfacing.
    // We DO keep a handle on this promise (pendingLedgerWritesRef) purely so
    // "Load More" can await in-flight writes before re-querying the ledger —
    // see fetchBrainFeedPacket. This doesn't delay anything the student sees.
    const ledgerWritePromise = authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/pool/submit-attempt`, {
      method: 'POST',
      body: JSON.stringify({
        questionId: q.id,
        selectedOptionIndex: optIdx
      })
    }).catch(err => console.warn("Ledger update skipped for this question (non-blocking):", err));

    pendingLedgerWritesRef.current.push(ledgerWritePromise);

    // 🏁 On the LAST card, don't jump to the summary immediately — give the person
    // 7 seconds to sit with their answer, or end early the moment they try to
    // scroll again (whichever happens first).
    if (isMobile && lockedIdx === questions.length - 1) {
      pendingCompletionDataRef.current = { answers: updatedAnswers, results: updatedResults };
      awaitingCompletionRef.current = true;
      clearTimeout(lastQuestionTimerRef.current);
      lastQuestionTimerRef.current = setTimeout(() => {
        finishMobileSession();
      }, 7000);
    }
  };

  // 🎯 SECURED: this used to write directly to profiles from the client.
  // Now it calls the backend, which does the exact same aggregation math
  // (same output — sessionAccuracy/beforeAccuracy/newAccuracy/attempted/correct
  // populate metricsSummary exactly as before) but also atomically saves the
  // brainfeed_sessions record and logs the credit_transactions ledger row —
  // neither of which a client-side write could safely do.
  const saveSessionMetricsToProfile = async (answersOverride, resultsOverride, isCompleted = true) => {
    const answersData = answersOverride || selectedAnswers;
    const resultsData = resultsOverride || answerResults;
    const attempted = Object.keys(answersData).length;
    if (attempted === 0) return;

    const correct = Object.values(resultsData).filter(r => r.isCorrect).length;

    // question_ids / answers arrays, index-aligned (index = question position in this session).
    const questionIds = questions.map(q => q.id);
    const answersArray = questions.map((_, idx) => (answersData[idx] !== undefined ? answersData[idx] : null));

    // Fall back to a fresh UUID only if somehow no credit-deduction call ever ran
    // for this session (shouldn't normally happen — defensive only).
    const activeSessionUUID = sessionUUIDRef.current || crypto.randomUUID();

    try {
      const response = await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/brainfeed/complete-session`, {
        method: 'POST',
        body: JSON.stringify({
          sessionUUID: activeSessionUUID,
          questionIds,
          answers: answersArray,
          attempted,
          correct,
          isCompleted,
          exam, subjectSection, subject
        })
      });
      const data = await response.json();

      if (data.success) {
        setMetricsSummary(data.metricsSummary);
      } else {
        console.error("Failed to save session:", data.error);
      }
    } catch (err) {
      console.error("Failed to update profile statistics:", err);
    }
  };

  const handleSaveToLibrary = async () => {
    const currentQ = questions[currentIdx];
    if (savedStatus[currentIdx]) return;

    // 🆕 OPTIMISTIC UPDATE: flip the button to "Saved" immediately so the
    // student isn't sitting there waiting on a network round-trip. The
    // actual save happens in the background; if it turns out to have
    // failed, we quietly revert the button and show a small inline error
    // (not a blocking popup) so nothing interrupts their flow.
    const targetIdx = currentIdx;
    setSavedStatus(prev => ({ ...prev, [targetIdx]: true }));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSavedStatus(prev => ({ ...prev, [targetIdx]: false }));
        showSaveErrorFlash();
        return;
      }

      const response = await authFetch(`${import.meta.env.VITE_API_BASE_URL}/api/pool/toggle-save`, {
        method: 'POST',
        body: JSON.stringify({
          questionId: currentQ.id,
          saved: true
        })
      });
      const data = await response.json();

      if (!data.success) {
        setSavedStatus(prev => ({ ...prev, [targetIdx]: false }));
        showSaveErrorFlash();
      }
      // On success, the optimistic state was already correct — nothing more to do.
    } catch (err) {
      console.error("Save to library failed:", err);
      setSavedStatus(prev => ({ ...prev, [targetIdx]: false }));
      showSaveErrorFlash();
    }
  };

  const handleTriggerExit = () => {
    const totalAttempted = Object.keys(selectedAnswers).length;
    const remaining = questions.length - totalAttempted;
    if (remaining > 0) {
      setShowExitWarning(true);
    } else {
      if (sessionMode === 'live') saveSessionMetricsToProfile();
      clearSavedBrainFeedSession(); // every question answered — nothing left to resume
      handleForceClearFeed();
    }
  };

  // 🧭 PHASE 5: BROWSER BACK-BUTTON INTERCEPTION
  // While a live feed session is active, browser back should trigger the
  // same exit-confirm flow as the in-app "End Session" button — never
  // silently lose the student's place. Same dummy-history-entry technique
  // as TestPortal: push one extra entry while the feed is active, catch the
  // resulting popstate, and re-arm the guard so Cancel doesn't disarm it.
  useEffect(() => {
    if (!isFeedActive) return;
    window.history.pushState({ infinityBrainFeedGuard: true }, '');
    const handlePopState = () => {
      handleTriggerExit();
      window.history.pushState({ infinityBrainFeedGuard: true }, '');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFeedActive]);

  const handleForceClearFeed = () => {
    clearTimeout(lastQuestionTimerRef.current);
    awaitingCompletionRef.current = false;
    setQuestions([]);
    setCurrentIdx(0);
    setSelectedAnswers({});
    setAnswerResults({});
    setSavedStatus({});
    setShowWarning(false);
    setIsFeedActive(false);
    setShowExitWarning(false);
    setShowEndModal(false);
    setSessionMode('live');
    setHasLoadedMore(false);
    // 🐛 FIX: this used to also clear the saved BrainFeed session here, but
    // handleForceClearFeed runs on *every* exit path — including "Save and
    // Exit", which is meant to preserve progress for later, not discard it.
    // The saved session should only ever be cleared when the student
    // explicitly chooses "Start Fresh" on the resume modal (see
    // handleDiscardSession) — never as a side effect of leaving the screen.
    // Note: sessionUUID is intentionally NOT cleared here for the same reason
    // — "Save and Exit" needs it preserved so a later "Continue Session" can
    // finish updating the same brainfeed_sessions row. It's only reset in
    // handleDiscardSession (Start Fresh) and freshly regenerated the next
    // time fetchBrainFeedPacket(false) runs for a genuinely new session.

    // 🆕 Back to the 2-card choice screen (not straight into the form) —
    // and refresh the quota badge in case a session/credit just got consumed.
    setLandingView('choice');
    fetchBrainfeedCredits();
  };

  // --- 📖 REVISE: re-open the same finished session, read-only, so the person can scroll back through it ---
  const handleReviseSession = () => {
    setShowEndModal(false);
    setSessionMode('revise');
    setCurrentIdx(0);
  };

  // --- 🔁 REATTEMPT: redo the same question set fresh, but this pass never touches profile stats ---
  const handleReattemptSession = () => {
    setShowEndModal(false);
    setSessionMode('reattempt');
    setCurrentIdx(0);
    setSelectedAnswers({});
    setAnswerResults({});
    setSavedStatus({});
    setShowWarning(false);
  };

  // 🧭 PHASE 4: while we haven't checked localStorage yet (or we're silently
  // restoring a same-tab reload), render nothing — avoids a flash of the
  // config form before either the resume modal or the restored feed shows.
  if (isRestoringSilently) {
    return null;
  }

  // 🆕 The alert modal is rendered by every early-return branch below, not just
  // the main one — otherwise an error raised while `loading` was still true
  // would set customAlert, but the loading screen's early return meant the
  // modal never actually appeared on screen.
  const alertModal = customAlert.show ? (
    <div style={modalOverlayStyle}>
      <div style={modalContentCardStyle}>
        <h3 style={{ color: '#0f172a', fontWeight: '900', fontSize: '1.15rem', margin: '0 0 10px 0' }}>{customAlert.title}</h3>
        <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: '1.6', fontWeight: '500', margin: '0 0 22px 0' }}>{customAlert.message}</p>
        <button onClick={() => setCustomAlert({ show: false, title: '', message: '' })} style={{ ...modalActionBtn, background: ACCENT }}>
          Got It
        </button>
      </div>
    </div>
  ) : null;

  if (loading) {
    return (
      <div style={{ ...formWrapper, boxSizing: 'border-box', ...(isMobile ? { minHeight: 'auto', height: '100%', width: '100%', padding: '20px', overflow: 'hidden' } : {}) }}>
        <div style={{ ...formCard, boxSizing: 'border-box', maxWidth: '450px', width: '100%', textAlign: 'center', padding: '50px 30px' }}>
          <h3 style={{ color: '#1e293b', fontWeight: '900', fontSize: '1.4rem', margin: 0 }}>Loading your questions...</h3>
          <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '12px', lineHeight: '1.6', fontWeight: '500' }}>
            This'll just take a moment.
          </p>
        </div>
        {alertModal}
      </div>
    );
  }

  if (isFeedActive && questions.length > 0) {
    return (
      <div style={{ ...feedWrapperStyle, height: isMobile ? '100dvh' : '100vh' }}>
        <div style={{ ...topBarFeedStyle, padding: isMobile ? '12px 16px' : '16px 40px' }}>
          <button style={exitBtnStyle} onClick={handleTriggerExit}>End Session</button>
          {isMobile && (
            <div style={scrollHintStyle}>Scroll up/down</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
            <div style={counterBadgeStyle}>Card {currentIdx + 1} / {questions.length}</div>
            {sessionMode === 'revise' && <span style={modeHintTextStyle}>Revise mode — read only</span>}
            {sessionMode === 'reattempt' && <span style={modeHintTextStyle}>Reattempt — not counted in stats</span>}
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          height: isMobile ? 'calc(100dvh - 68px)' : '84vh',
          marginTop: isMobile ? '68px' : '65px',
          boxSizing: 'border-box',
          padding: isMobile ? '0' : '0 40px',
          gap: isMobile ? '0' : '14px'
        }}>
          <div
            ref={viewportRef}
            onScroll={isMobile ? handleFeedScroll : undefined}
            style={{
              ...viewportContainerStyle,
              maxWidth: isMobile ? '100%' : '650px',
              flex: 1,
              overflowY: isMobile ? 'auto' : 'hidden',
              scrollSnapType: isMobile ? 'y mandatory' : 'none',
              WebkitOverflowScrolling: 'touch'
            }}
          >
            <div style={{ ...sliderTrackStyle, transform: isMobile ? 'none' : `translateY(-${currentIdx * 100}%)` }}>
              {questions.map((q, idx) => {
                const itemChoice = selectedAnswers[idx];
                const resultData = answerResults[idx];
                
                return (
                  <div key={idx} style={{
                    ...cardSlideInstanceStyle,
                    ...(isMobile ? { minHeight: '100%', height: 'auto', scrollSnapAlign: 'start', scrollSnapStop: 'always', padding: 0 } : {})
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: isMobile ? '100%' : 'auto', gap: isMobile ? '0' : '14px' }}>
                      <div style={{
                        ...fixedQuestionCardStyle,
                        width: '100%',
                        maxWidth: isMobile ? '100%' : '610px',
                        height: isMobile ? '100%' : 'auto',
                        maxHeight: isMobile ? 'none' : '100%',
                        borderRadius: isMobile ? 0 : fixedQuestionCardStyle.borderRadius,
                        border: isMobile ? 'none' : fixedQuestionCardStyle.border,
                        boxShadow: isMobile ? 'none' : fixedQuestionCardStyle.boxShadow,
                        padding: isMobile ? '18px 16px' : '30px'
                      }}>
                        <div style={qHeaderRow}>
                          <span style={qTypeLabel}>Practice</span>
                          
                          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                            {itemChoice !== undefined && (
                              <span style={{ ...statusIndicator, color: !resultData ? '#94a3b8' : (resultData.isCorrect ? '#10b981' : '#f43f5e') }}>
                                {!resultData ? 'Checking...' : (resultData.isCorrect ? 'Correct' : 'Incorrect')}
                              </span>
                            )}
                            
                            <button
                              onClick={handleSaveToLibrary}
                              disabled={itemChoice === undefined || savedStatus[idx]}
                              style={{
                                ...saveBtnStyle,
                                opacity: itemChoice === undefined ? 0.5 : 1,
                                background: savedStatus[idx] ? '#f8fafc' : ACCENT,
                                color: savedStatus[idx] ? '#10b981' : '#ffffff',
                                borderColor: savedStatus[idx] ? '#10b981' : ACCENT,
                                cursor: (itemChoice === undefined || savedStatus[idx]) ? 'not-allowed' : 'pointer'
                              }}
                            >
                              {savedStatus[idx] ? 'Saved' : 'Save'}
                            </button>
                          </div>
                        </div>

                        {saveErrorFlash && idx === currentIdx && (
                          <div style={{ color: '#ef4444', fontSize: '0.78rem', fontWeight: '600', marginTop: '-4px' }}>
                            {saveErrorFlash}
                          </div>
                        )}
                        
                        <div style={{ ...scrollableCardContentBody, overflowY: isMobile ? 'visible' : 'auto', flex: isMobile ? 'none' : 1 }}>
                          <h2 style={{ ...questionTextStyle, fontSize: getQuestionFontSize(q.question, isMobile) }}><LatexText text={q.question} /></h2>

                          {showWarning && idx === currentIdx && (
                            <div style={inlineCardWarningStyle}>
                              Please select an answer to continue.
                            </div>
                          )}

                          <div style={optionsContainerStyle}>
                            {q.options.map((opt, oIdx) => {
                              let dynamicBg = '#ffffff';
                              let dynamicBorder = '#e2e8f0';
                              let dynamicColor = '#334155';

                              if (itemChoice !== undefined && resultData) {
                                if (oIdx === resultData.correctOptionIndex) {
                                  dynamicBg = '#f0fdf4';
                                  dynamicBorder = '#10b981';
                                  dynamicColor = '#166534';
                                } else if (itemChoice === oIdx && itemChoice !== resultData.correctOptionIndex) {
                                  dynamicBg = '#fff1f2';
                                  dynamicBorder = '#ef4444';
                                  dynamicColor = '#991b1b';
                                } else {
                                  dynamicBg = '#f8fafc';
                                  dynamicBorder = '#e2e8f0';
                                  dynamicColor = '#94a3b8';
                                }
                              } else if (itemChoice !== undefined && itemChoice === oIdx) {
                                // Locked but still waiting on the server's verdict — neutral "selected" look
                                dynamicBg = '#f8fafc';
                                dynamicBorder = '#94a3b8';
                                dynamicColor = '#475569';
                              }

                              const isCorrectOption = resultData ? oIdx === resultData.correctOptionIndex : false;

                              return (
                                <React.Fragment key={oIdx}>
                                  {/* 💡 Explanation pops up directly above the correct option, once the server confirms it */}
                                  {resultData && isCorrectOption && (
                                    <div style={explanationPopupStyle}>
                                      <p style={explanationPopupText}>
                                        <LatexText text={resultData.explanation} />
                                      </p>
                                    </div>
                                  )}
                                  <button
                                    onClick={() => handleOptionSelect(idx, oIdx)}
                                    disabled={itemChoice !== undefined}
                                    style={{
                                      ...optionButtonStyle,
                                      background: dynamicBg,
                                      borderColor: dynamicBorder,
                                      color: dynamicColor,
                                      cursor: itemChoice !== undefined ? 'default' : 'pointer'
                                    }}
                                  >
                                    <span style={optLabelMarker}>{String.fromCharCode(64 + oIdx + 1)}.</span> <LatexText text={opt} />
                                  </button>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* ⬅️➡️ Nav buttons stay for desktop; mobile navigates purely by scroll */}
                      {!isMobile && (
                      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', width: '100%', maxWidth: '610px', flexShrink: 0 }}>
                        <button 
                          type="button"
                          onClick={handlePrevCard} 
                          disabled={currentIdx === 0}
                          style={{ ...navBtnRect, opacity: currentIdx === 0 ? 0.35 : 1, cursor: currentIdx === 0 ? 'not-allowed' : 'pointer' }}
                          title="Previous question"
                        >
                          ← Previous
                        </button>
                        <button 
                          type="button" 
                          onClick={handleNextCard}
                          style={navBtnRect}
                          title="Next question"
                        >
                          Next →
                        </button>
                      </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* 📊 ACCURACY EVALUATION CARD POPUP OVERLAY */}
        {showEndModal && (
          <div style={modalOverlayStyle}>
            <div style={{ ...modalContentCardStyle, maxWidth: '420px', textAlign: 'left' }}>
              <h3 style={{ margin: '0 0 6px 0', color: '#1e293b', fontWeight: '900', fontSize: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                Session Summary
              </h3>
              <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 20px 0', fontWeight: '500', lineHeight: '1.4' }}>
                {sessionMode === 'live' ? "Here's how you did in this session." : "This attempt wasn't counted in your stats."}
              </p>

              <div style={accuracyMetricsDashboardBox}>
                <div style={metricRowItem}>
                  <span style={metricLabelText}>Questions Attempted</span>
                  <span style={{ ...metricValueBadge, color: '#0f172a', background: '#f1f5f9' }}>{metricsSummary.attempted}</span>
                </div>
                <div style={metricRowItem}>
                  <span style={metricLabelText}>This Session's Accuracy</span>
                  <span style={{ ...metricValueBadge, color: '#10b981', background: '#f0fdf4' }}>{metricsSummary.sessionAccuracy}%</span>
                </div>
                <div style={metricRowItem}>
                  <span style={metricLabelText}>Accuracy Before This Session</span>
                  <span style={{ ...metricValueBadge, color: '#4f46e5', background: '#e0e7ff' }}>{metricsSummary.beforeAccuracy}%</span>
                </div>
                <div style={{ ...metricRowItem, border: 'none', padding: 0, marginTop: '4px' }}>
                  <span style={{ ...metricLabelText, fontWeight: '700', color: '#0f172a' }}>Your New Overall Accuracy</span>
                  <span style={{ ...metricValueBadge, color: '#ffffff', background: ACCENT, fontWeight: '800' }}>{metricsSummary.newAccuracy}%</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '24px' }}>
                {!hasLoadedMore ? (
                  <button onClick={() => fetchBrainFeedPacket(true)} style={{ ...modalActionBtn, background: ACCENT, color: '#ffffff' }}>
                    Load More Questions
                  </button>
                ) : (
                  <p style={{ margin: '0 0 4px 0', color: '#94a3b8', fontSize: '0.78rem', fontWeight: '600', textAlign: 'center' }}>
                    You've already loaded more once this session — start a fresh session for more.
                  </p>
                )}
                <button onClick={handleReviseSession} style={{ ...modalActionBtn, background: '#f1f5f9', color: '#0f172a', border: '1px solid #e2e8f0' }}>
                  Revise Questions
                </button>
                <button onClick={handleReattemptSession} style={{ ...modalActionBtn, background: '#f1f5f9', color: '#0f172a', border: '1px solid #e2e8f0' }}>
                  Reattempt Session
                </button>
                <button onClick={() => { clearSavedBrainFeedSession(); handleForceClearFeed(); }} style={{ ...modalActionBtn, background: '#f1f5f9', color: '#0f172a', border: '1px solid #e2e8f0' }}>
                  Exit Session
                </button>
              </div>
            </div>
          </div>
        )}

        {showExitWarning && (
          <div style={modalOverlayStyle}>
            <div style={modalContentCardStyle}>
              <h3 style={{ margin: '0 0 10px 0', color: '#0f172a', fontWeight: '900' }}>Wait, you're not done yet</h3>
              <p style={{ color: '#64748b', fontSize: '0.88rem', margin: '0 0 25px 0', fontWeight: '500' }}>
                You still have unanswered questions. Exiting now will only save the ones you've attempted.
              </p>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={() => setShowExitWarning(false)} style={{ ...modalActionBtn, flex: 1, background: '#f1f5f9', color: '#0f172a', border: '1px solid #e2e8f0' }}>
                  Resume Session
                </button>
                <button onClick={() => {
                  saveSessionMetricsToProfile(undefined, undefined, false);
                  handleForceClearFeed();
                  // 🐛 FIX: deliberately leaving — clear the "same tab, just
                  // reloaded" marker (so the *next* time BrainFeed opens in
                  // this tab, it correctly asks via the modal instead of
                  // silently resuming) while keeping the actual saved
                  // session data intact for that modal to show.
                  try { sessionStorage.removeItem(BRAINFEED_TAB_MARKER_KEY); } catch (e) { /* ignore */ }
                  navigate('/dashboard');
                }} style={{ ...modalActionBtn, flex: 1, background: '#ef4444' }}>
                  Save and Exit
                </button>
              </div>
            </div>
          </div>
        )}

        {alertModal}
      </div>
    );
  }

  return (
    <div style={{ ...formWrapper, boxSizing: 'border-box', ...(isMobile ? { minHeight: 'auto', height: '100%', width: '100%', padding: 0, alignItems: 'stretch' } : {}) }}>
      {/* 🧭 PHASE 4: resume-session modal — shown once, only when a saved
          live session actually exists. "Continue" restores it exactly
          (same questions, same answers, same position, no new API call).
          "Start Fresh" discards it permanently and shows the normal form. */}
      {alertModal}
      {resumePrompt && (
        <div style={modalOverlayStyle}>
          <div style={modalContentCardStyle}>
            <h3 style={{ color: '#0f172a', fontWeight: '900', fontSize: '1.15rem', margin: '0 0 10px 0' }}>Resume your session?</h3>
            <p style={{ color: '#64748b', fontSize: '0.88rem', lineHeight: '1.6', fontWeight: '500', margin: '0 0 14px 0' }}>
              You have an unfinished session — <strong>{resumePrompt.exam}</strong> · {resumePrompt.subjectSection} · {resumePrompt.subject}.
            </p>
            <p style={{ color: '#64748b', fontSize: '0.88rem', lineHeight: '1.6', fontWeight: '500', margin: '0 0 20px 0' }}>
              You were on question <strong>{(resumePrompt.currentIdx || 0) + 1}</strong> of <strong>{resumePrompt.questions.length}</strong> — {Object.keys(resumePrompt.selectedAnswers || {}).length} answered so far.
            </p>
            <button onClick={handleResumeSession} style={{ ...modalActionBtn, background: ACCENT, marginBottom: '10px' }}>
              Continue Session
            </button>
            <button onClick={handleDiscardSession} style={{ ...modalActionBtn, background: '#fff', color: '#ef4444', border: '1px solid #fee2e2' }}>
              Start Fresh
            </button>
          </div>
        </div>
      )}
      {isMobile && (
        <style>{`
          @media (max-width: 768px) {
            .content-view { padding-left: 0 !important; padding-right: 0 !important; }
            .bf-container { padding: 16px 0px !important; }
            .ai-selection-grid { grid-template-columns: 1fr !important; gap: 10px !important; }

            /* Selection screen: shrink everything so both cards fit without scrolling issues */
            .ai-select-header { margin-bottom: 10px !important; }
            .ai-select-title { font-size: 1.3rem !important; letter-spacing: -0.3px !important; }
            .ai-select-subtitle { font-size: 0.72rem !important; margin-top: 2px !important; }
            .ai-mock-card { padding: 12px !important; border-radius: 16px !important; }
            .ai-card-header-row { margin-bottom: 6px !important; }
            .ai-icon-frame { width: 26px !important; height: 26px !important; border-radius: 8px !important; }
            .ai-icon-frame svg { width: 14px !important; height: 14px !important; }
            .ai-badge { font-size: 0.6rem !important; padding: 2px 6px !important; border-radius: 6px !important; }
            .ai-card-title { font-size: 0.98rem !important; margin: 0 0 4px 0 !important; }
            .ai-bullet-list { gap: 3px !important; margin: 0 0 8px 0 !important; }
            .ai-bullet-item { font-size: 0.68rem !important; gap: 5px !important; line-height: 1.25 !important; }
            .ai-bullet-item svg { width: 11px !important; height: 11px !important; }
            .ai-card-btn { padding: 7px !important; font-size: 0.75rem !important; border-radius: 8px !important; }
          }
          ${isFeedActive ? `
          @media (max-width: 768px) {
            .content-view {
              padding: 0 !important;
              overflow: hidden !important;
              height: calc(100dvh - 65px) !important;
            }
          }
          ` : ''}
        `}</style>
      )}

      {/* 🆕 CHOICE SCREEN — mirrors AI Test Lab's exact container/grid/card styles for consistency */}
      {landingView === 'choice' && (
        <div style={brainfeedContainerStyle} className="bf-container">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
            <div style={quotaBadgeStyle}>
              {brainfeedCredits === null ? 'Loading...' : `${brainfeedCredits} session${brainfeedCredits === 1 ? '' : 's'} left`}
            </div>
          </div>

          <header className="ai-select-header" style={{ textAlign: 'center', marginBottom: '30px' }}>
            <h1 className="ai-select-title" style={{ fontSize: '2.4rem', fontWeight: '900', color: '#0f172a', margin: 0, letterSpacing: '-0.8px' }}>BrainFeed</h1>
            <p className="ai-select-subtitle" style={{ color: '#64748b', marginTop: '6px', fontSize: '0.95rem', fontWeight: '500' }}>Choose how you want to practice today</p>
          </header>

          <div style={selectionGridStyle} className="ai-selection-grid">
            <div className="ai-mock-card" style={topicMockCardStyle} onClick={handleOpenNewSessionForm}>
              <div className="ai-card-header-row" style={cardHeaderRowStyle}>
                <div className="ai-icon-frame" style={emeraldIconFrameStyle}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
                </div>
                <span className="ai-badge" style={emeraldBadgeStyle}>Daily Practice</span>
              </div>
              <h3 className="ai-card-title" style={leftCardTitleStyle}>Start New Session</h3>
              <ul className="ai-bullet-list" style={cleanBulletListStyle}>
                <ChecklistItem>15 adaptive questions per session</ChecklistItem>
                <ChecklistItem>Focuses on your weak areas</ChecklistItem>
                <ChecklistItem>Instant feedback after each answer</ChecklistItem>
              </ul>
              <button className="ai-card-btn" style={emeraldActionBtnStyle}>Start Practice</button>
            </div>

            <div className="ai-mock-card" style={fullMockCardStyleBF} onClick={handleOpenHistory}>
              <div className="ai-card-header-row" style={cardHeaderRowStyle}>
                <div className="ai-icon-frame" style={indigoIconFrameStyle}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 3" /></svg>
                </div>
                <span className="ai-badge" style={indigoBadgeStyle}>Session History</span>
              </div>
              <h3 className="ai-card-title" style={leftCardTitleStyle}>Revise Previous Sessions</h3>
              <ul className="ai-bullet-list" style={cleanBulletListStyle}>
                <ChecklistItem color={ACCENT}>Review your past sessions</ChecklistItem>
                <ChecklistItem color={ACCENT}>See correct answers &amp; explanations</ChecklistItem>
                <ChecklistItem color={ACCENT}>Track your progress over time</ChecklistItem>
              </ul>
              <button className="ai-card-btn" style={indigoActionBtnStyle}>View Past Sessions</button>
            </div>
          </div>
        </div>
      )}

      {/* 🆕 HISTORY LIST SCREEN */}
      {landingView === 'history' && (
        <div style={brainfeedContainerStyle} className="bf-container">
          <button onClick={handleBackToChoice} style={backLinkStyle}>← Back</button>
          <h2 style={{ color: '#0f172a', fontWeight: '900', fontSize: isMobile ? '1.2rem' : '1.5rem', margin: '14px 0 18px 0' }}>Your Past Sessions</h2>

          <div style={{ maxWidth: '620px' }}>
          {historyLoading && (
            <p style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: '500', textAlign: 'center', padding: '30px 0' }}>Loading your sessions...</p>
          )}

          {!historyLoading && historyError && (
            <p style={{ color: '#b91c1c', fontSize: '0.88rem', fontWeight: '600', textAlign: 'center', padding: '20px 0' }}>{historyError}</p>
          )}

          {!historyLoading && !historyError && historySessions.length === 0 && (
            <p style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: '500', textAlign: 'center', padding: '30px 0' }}>
              No sessions yet — finish a BrainFeed session and it'll show up here.
            </p>
          )}

          {!historyLoading && !historyError && historySessions.map(session => (
            <div key={session.id} style={historyRowStyle}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ color: '#0f172a', fontWeight: '700', fontSize: '0.92rem' }}>
                    {session.sessionLabel}
                  </span>
                  {!session.isCompleted && (
                    <span style={incompleteBadgeStyle}>Incomplete</span>
                  )}
                </div>
                <div style={{ color: '#64748b', fontSize: '0.78rem', fontWeight: '500' }}>
                  {session.questionCount} Questions · {session.score}/{session.questionCount} correct · {session.accuracy}% accuracy
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.74rem', fontWeight: '500', marginTop: '2px' }}>
                  {new Date(session.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <button
                onClick={() => handleRevisePastSession(session)}
                disabled={pastSessionLoadingId === session.id}
                style={{ ...historyReviseBtnStyle, opacity: pastSessionLoadingId === session.id ? 0.6 : 1 }}
              >
                {pastSessionLoadingId === session.id ? '...' : 'Revise'}
              </button>
            </div>
          ))}
          </div>
        </div>
      )}

      {/* EXISTING FORM — untouched, just gated behind landingView === 'form' now */}
      {landingView === 'form' && (
        <div style={{ width: '100%', maxWidth: '600px', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
            <div style={quotaBadgeStyle}>
              {brainfeedCredits === null ? 'Loading...' : `${brainfeedCredits} session${brainfeedCredits === 1 ? '' : 's'} left`}
            </div>
          </div>
          <div style={{
            ...formCard,
            padding: isMobile ? '18px' : '35px',
            ...(isMobile ? { width: '100%', maxWidth: '100%', height: '100%', border: 'none', borderRadius: 0, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden' } : {})
          }}>
          <button onClick={handleBackToChoice} style={{ ...backLinkStyle, marginBottom: '12px' }}>← Back</button>
          <h2 style={{ color: '#0f172a', marginBottom: '5px', fontWeight: '800', letterSpacing: '-0.5px', fontSize: isMobile ? '1.1rem' : '1.5rem', borderLeft: `3px solid ${ACCENT}`, paddingLeft: '12px' }}>Start a BrainFeed Session</h2>
          <p style={{ color: '#64748b', marginBottom: isMobile ? '12px' : '25px', fontSize: isMobile ? '0.76rem' : '0.9rem', fontWeight: '500', paddingLeft: '15px' }}>
            Fill in the details to start practicing.
          </p>
          
          <div style={{ ...flexRow, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : flexRow.alignItems, gap: isMobile ? '0px' : '15px', marginBottom: isMobile ? '0' : flexRow.marginBottom }}>
            <div style={{ flex: 1 }}>
              <FieldLabel icon="exam">Target Exam <span style={mandatoryStar}>*</span></FieldLabel>
              <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: isMobile ? '10px' : '15px' }} placeholder="e.g. UPSC, SSC, Banking" value={exam} onChange={e => setExam(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <FieldLabel icon="subject">Subject / Section <span style={mandatoryStar}>*</span></FieldLabel>
              <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: isMobile ? '10px' : '15px' }} placeholder="e.g. Maths, English, GK" value={subjectSection} onChange={e => setSubjectSection(e.target.value)} />
            </div>
          </div>

          <div>
            <FieldLabel icon="topic">Topic <span style={mandatoryStar}>*</span></FieldLabel>
            <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: isMobile ? '10px' : '15px' }} placeholder="e.g. Trigonometry, Mughal Empire" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>

          <div style={{ ...flexRow, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : flexRow.alignItems, gap: isMobile ? '0px' : '15px' }}>
            <div style={{ flex: 1 }}>
              <FieldLabel icon="difficulty">Difficulty</FieldLabel>
              <div style={{ ...horizontalDifficultyContainer, width: '100%', boxSizing: 'border-box', marginBottom: isMobile ? '10px' : '15px' }}>
                {difficultyLevels.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => setDifficulty(level.value)}
                    style={{
                      ...difficultyTabOption,
                      flex: 1,
                      background: difficulty === level.value ? ACCENT : '#f8fafc',
                      color: difficulty === level.value ? '#ffffff' : '#334155',
                      borderColor: difficulty === level.value ? ACCENT : '#e2e8f0',
                    }}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', boxSizing: 'border-box', marginBottom: isMobile ? '10px' : '15px' }}>
                <div style={{ marginBottom: 0 }}><FieldLabel icon="language"><span style={{ whiteSpace: 'nowrap' }}>Language</span></FieldLabel></div>
                <select style={{ ...inputStyle, flex: 1, width: 'auto', padding: '11px', marginBottom: 0 }} value={language} onChange={e => setLanguage(e.target.value)}>
                  <option value="English">English</option>
                  <option value="Hindi">Hindi</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: isMobile ? '12px' : '20px', marginTop: isMobile ? '4px' : '15px' }}>
            <button
              onClick={() => fetchBrainFeedPacket(false)}
              disabled={cooldown > 0}
              style={{
                ...actionBtn,
                padding: '14px',
                borderRadius: '10px',
                background: cooldown > 0 ? '#94a3b8' : ACCENT,
                cursor: cooldown > 0 ? 'not-allowed' : 'pointer'
              }}
            >
              {cooldown > 0 ? `Please wait ${cooldown}s to retry` : "Start Practice"}
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Styles Objects Matrix
const formWrapper = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', padding: '20px', background: '#ffffff', fontFamily: 'Inter, sans-serif' }; const formCard = { background: '#fff', padding: '35px', borderRadius: '20px', border: '1px solid #e2e8f0', width: '100%', maxWidth: '620px' }; const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }; const mandatoryStar = { color: '#ef4444', fontWeight: '900' }; const inputStyle = { width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #E4E1F5', fontSize: '0.95rem', outline: 'none', marginBottom: '15px', background: '#F8F7FC', color: '#0f172a', fontWeight: '500' }; const flexRow = { display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '5px' }; const actionBtn = { border: 'none', color: '#fff', width: '100%', fontWeight: '700', transition: '0.2s', fontSize: '0.92rem' }; const horizontalDifficultyContainer = { display: 'flex', gap: '8px', width: '100%', marginBottom: '15px' }; const difficultyTabOption = { flex: 1, padding: '11px 12px', borderRadius: '10px', border: '1px solid', fontSize: '0.88rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s ease', textAlign: 'center' }; const feedWrapperStyle = { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }; const topBarFeedStyle = { position: 'absolute', top: 0, left: 0, width: '100%', padding: '16px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxSizing: 'border-box', borderBottom: '1px solid #e2e8f0', background: '#ffffff', zIndex: 12 }; const exitBtnStyle = { background: '#fff', color: '#ef4444', border: '1px solid #fee2e2', padding: '10px 20px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.82rem' }; const counterBadgeStyle = { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', padding: '8px 18px', borderRadius: '30px', fontSize: '0.82rem', fontWeight: '700' }; const mainControlRowStyle = { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '24px', width: '100%', justifyContent: 'center', height: '84vh', marginTop: '65px', boxSizing: 'border-box', padding: '0 40px' }; const sideNavBtnStyle = { width: '48px', height: '48px', borderRadius: '50%', border: '1px solid #e2e8f0', background: '#ffffff', color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: '800', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', flexShrink: 0, outline: 'none' }; const viewportContainerStyle = { width: '100%', height: '100%', overflow: 'hidden', position: 'relative', maxWidth: '980px', flexShrink: 0 }; const sliderTrackStyle = { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }; const cardSlideInstanceStyle = { width: '100%', height: '100%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', padding: '10px 0' }; const splitFlexContainerLayout = { display: 'flex', flexDirection: 'row', gap: '20px', width: '100%', height: '100%', alignItems: 'stretch', justifyContent: 'center' }; const fixedQuestionCardStyle = { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '20px', padding: '30px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '16px', width: '610px', maxHeight: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.015)', flexShrink: 0 }; const navBtnRect = { padding: '14px 26px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff', color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.92rem', fontWeight: '800', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', cursor: 'pointer', gap: '8px', outline: 'none' }; const scrollableCardContentBody = { flex: 1, overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '16px' }; const explanationPopupStyle = { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '14px 16px', marginBottom: '2px', boxShadow: '0 4px 12px rgba(16,185,129,0.08)' }; const explanationPopupHeader = { fontSize: '0.68rem', fontWeight: '900', letterSpacing: '0.5px', color: '#166534', marginBottom: '6px' }; const explanationPopupText = { margin: 0, fontSize: '0.85rem', color: '#166534', lineHeight: '1.5', fontWeight: '500' }; const qHeaderRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }; const qTypeLabel = { background: '#f1f5f9', color: '#475569', padding: '5px 12px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }; const statusIndicator = { fontSize: '0.75rem', fontWeight: '700' }; const saveBtnStyle = { border: '1px solid #e2e8f0', padding: '8px 16px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700' }; const questionTextStyle = { color: '#0f172a', margin: '5px 0', fontSize: '1.2rem', fontWeight: '800', lineHeight: '1.45', flexShrink: 0 }; const optionsContainerStyle = { display: 'flex', flexDirection: 'column', gap: '10px', margin: '5px 0', flexShrink: 0 }; const optionButtonStyle = { width: '100%', textAlign: 'left', padding: '12px 18px', borderRadius: '10px', border: '1px solid', fontSize: '0.92rem', fontWeight: '600', display: 'flex', alignItems: 'center', transition: 'all 0.15s ease' }; const optLabelMarker = { color: '#94a3b8', marginRight: '10px', fontWeight: '700' }; const inlineCardWarningStyle = { background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '600', flexShrink: 0 }; const modalOverlayStyle = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000 }; const modalContentCardStyle = { background: '#fff', padding: '30px', borderRadius: '20px', width: '90%', maxWidth: '380px', textAlign: 'center', border: '1px solid #e2e8f0', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }; const modalActionBtn = { width: '100%', padding: '12px', border: 'none', color: '#fff', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.88rem' }; const accuracyMetricsDashboardBox = { display: 'flex', flexDirection: 'column', gap: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', marginTop: '16px' }; const metricRowItem = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #edf2f7', paddingBottom: '10px' }; const metricLabelText = { fontSize: '0.82rem', fontWeight: '600', color: '#475569' }; const metricValueBadge = { fontSize: '0.78rem', fontWeight: '700', padding: '4px 10px', borderRadius: '6px' };
const modeHintTextStyle = { fontSize: '0.65rem', color: '#f59e0b', fontWeight: '700' };
const scrollHintStyle = { textAlign: 'center', fontSize: '0.68rem', color: '#94a3b8', fontWeight: '600', pointerEvents: 'none', flex: 1 };

// --- 🆕 CHOICE SCREEN + HISTORY STYLES — exact copies of AI Test Lab's constants for 1:1 visual consistency ---
const brainfeedContainerStyle = { padding: '40px 20px', maxWidth: '1050px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif', width: '100%', boxSizing: 'border-box' };
const selectionGridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginTop: '10px' };
const cardHeaderRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '14px' };
const leftCardTitleStyle = { margin: '0 0 8px 0', fontSize: '1.4rem', color: '#0f172a', fontWeight: '800', letterSpacing: '-0.5px' };
const cleanBulletListStyle = { listStyleType: 'none', padding: 0, margin: '0 0 20px 0', display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', flex: 1 };
const topicMockCardStyle = { background: '#ffffff', padding: '26px', borderRadius: '24px', border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', boxShadow: '0 6px 24px rgba(16, 185, 129, 0.14)' };
const emeraldIconFrameStyle = { width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#d1fae5', border: '1px solid #a7f3d0' };
const emeraldBadgeStyle = { background: '#d1fae5', color: '#065f46', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.2px' };
const emeraldActionBtnStyle = { border: 'none', color: '#fff', padding: '12px 24px', borderRadius: '12px', fontWeight: '700', fontSize: '0.92rem', cursor: 'pointer', transition: '0.2s', width: '100%', background: '#10b981', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)' };
const fullMockCardStyleBF = { background: '#ffffff', padding: '26px', borderRadius: '24px', border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', boxShadow: '0 6px 24px rgba(79, 70, 229, 0.14)' };
const indigoIconFrameStyle = { width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e0e7ff', border: '1px solid #c7d2fe' };
const indigoBadgeStyle = { background: '#e0e7ff', color: '#4f46e5', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.2px' };
const indigoActionBtnStyle = { border: 'none', color: '#fff', padding: '12px 24px', borderRadius: '12px', fontWeight: '700', fontSize: '0.92rem', cursor: 'pointer', transition: '0.2s', width: '100%', background: '#4f46e5', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.15)' };
// Rectangular-with-rounded-corners quota badge (distinct from the fully pill-shaped AI Labs badges, per request)
const quotaBadgeStyle = { background: '#e0e7ff', color: ACCENT, padding: '8px 18px', borderRadius: '10px', fontSize: '0.82rem', fontWeight: '700', whiteSpace: 'nowrap', border: '1px solid #c7d2fe' };
const backLinkStyle = { background: 'none', border: 'none', color: ACCENT, fontWeight: '700', fontSize: '0.85rem', cursor: 'pointer', padding: 0 };
const historyRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px 18px', marginBottom: '12px' };
const historyReviseBtnStyle = { background: ACCENT, color: '#fff', border: 'none', padding: '9px 18px', borderRadius: '8px', fontWeight: '700', fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' };
const incompleteBadgeStyle = { background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '6px', fontSize: '0.68rem', fontWeight: '700' };

export default BrainFeed;