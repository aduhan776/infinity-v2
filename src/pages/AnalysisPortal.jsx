import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient'; 
import LatexText from '../components/LatexText'; 

// --- 🌐 LOCAL STORAGE STORAGE ENGINE MAPPINGS ---
const dbName = "InfinityLocalDB";

const initAnalysisDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 3); // 🚨 ENGINE VERSION 3 — matches AiTests.jsx, fixes VersionError
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("test_sessions")) {
        db.createObjectStore("test_sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("saved_questions")) {
        db.createObjectStore("saved_questions", { keyPath: "id" });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

const getFromLocalStore = async (storeName, id) => {
  const db = await initAnalysisDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (err) => reject(err);
  });
};

const saveToLocalStore = async (storeName, payload) => {
  const db = await initAnalysisDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.put(payload);
    tx.oncomplete = () => resolve();
    tx.onerror = (err) => reject(err);
  });
};

// 🚨 SECTION FIELD KEY — change this in ONE place if your question objects
// use a different key name (e.g. 'sectionName', 'topic') instead of 'section'.
const SECTION_KEY = 'section';

const AnalysisPortal = ({ results, onBackToDashboard }) => {
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedQIdx, setSelectedQIdx] = useState(null);
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
  } = results || {};

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

      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/pool/toggle-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: user.id,
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
    if (deltaX < -SWIPE_THRESHOLD && activeTab === 'analysis') {
      setActiveTab('solutions'); // swipe left → next tab
    } else if (deltaX > SWIPE_THRESHOLD && activeTab === 'solutions') {
      setActiveTab('analysis'); // swipe right → previous tab
    }
  };

  return (
    <div style={{ ...styles.container, ...(isMobile ? styles.containerMobile : {}) }}>

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
        <div style={{ ...styles.summaryHeaderMain, ...(isMobile ? styles.summaryHeaderMainMobile : {}) }}>
           <div style={isMobile ? { width: '100%' } : {}}>
             <h1 style={{margin:0, color:'#1e293b', fontSize: isMobile ? '1.15rem' : '1.5rem', wordBreak: 'break-word'}}>Test Results: {title}</h1>
             <p style={{color:'#64748b', margin:'5px 0 0 0', fontSize: isMobile ? '0.8rem' : '1rem'}}>Bhai, ye raha tera final analysis report:</p>
           </div>
           <button onClick={onBackToDashboard} style={{ ...styles.homeBtn, ...(isMobile ? styles.homeBtnMobile : {}) }}>Back to Dashboard</button>
        </div>

        {/* Stat cards — compact 2-per-row grid on mobile, 5-across row on desktop */}
        <div style={{ ...styles.mainStatsGrid, ...(isMobile ? styles.mainStatsGridMobile : {}) }}>
          <div style={{ ...styles.mainStatCard, ...(isMobile ? styles.mainStatCardMobile : {}) }}>
             <span style={{...styles.mainStatLabel, ...(isMobile ? styles.mainStatLabelMobile : {})}}>FINAL SCORE</span>
             <span style={{...styles.mainStatValue, color:'#6366f1', fontSize: isMobile ? '1.1rem' : '1.5rem'}}>{totalScore.toFixed(2)}</span>
          </div>
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
          <div style={{ ...styles.mainStatCard, ...(isMobile ? styles.mainStatCardFullRowMobile : {}) }}>
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

      {/* ================= SECTION 2: SOLUTIONS / QUESTIONS LIST ================= */}
      {(!isMobile || activeTab === 'solutions') && (
      <div style={{ ...styles.solutionsSection, ...(isMobile ? styles.solutionsSectionMobile : {}) }}>
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
                <p style={styles.qTruncated}>{questions[idx].question}</p>
                <div style={styles.smallTime}>⏱️ Time Taken: {formatTime(timeTracker[idx])}</div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      </div>

      {selectedQIdx !== null && questions[selectedQIdx] && (
        <div style={styles.overlay}>
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
              <button onClick={() => { setSelectedQIdx(null); setShowExplanation(false); }} style={styles.closeBtn}>❌ Close</button>
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
                  <p style={{...styles.detailText, fontSize: isMobile ? '1rem' : '1.2rem'}}><LatexText text={questions[selectedQIdx].question} /> </p>
                   
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
                            <span>{String.fromCharCode(64 + oIdx + 1)}. <LatexText text={opt} /> </span>
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
                                  <span style={{fontSize:'0.72rem', background:'#e0e7ff', color:'#4338ca', padding:'4px 8px', borderRadius:'4px', fontWeight:'bold'}}>Local Vault Synced ✓</span>
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

  qCardSmall: { padding: '15px', borderRadius: '12px', border: '2px solid', cursor: 'pointer', transition: '0.3s', width: '100%', boxSizing: 'border-box' },
  qCardSmallMobile: { padding: '10px', borderRadius: '10px' },

  cardHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' },
  qNum: { fontWeight: '800', color: '#64748b', fontSize: '0.75rem' },
  qTruncated: { fontSize: '0.9rem', fontWeight: '600', margin: '0 0 10px 0', height: '2.4em', overflow: 'hidden' },
  smallTime: { fontSize: '0.7rem', color: '#94a3b8', fontWeight: '700' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.9)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', boxSizing: 'border-box' },

  detailContainer: { background: '#fff', width: '100%', maxWidth: '1100px', height: '85vh', borderRadius: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' },
  detailContainerMobile: { height: '100vh', maxHeight: '100vh', width: '100vw', maxWidth: '100vw', borderRadius: 0 },

  detailHeader: { padding: '20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fcfdfe' },
  detailHeaderMobile: { padding: '14px 16px' },

  swipeHint: { textAlign: 'center', fontSize: '0.7rem', color: '#94a3b8', padding: '4px 0', background: '#fcfdfe', borderBottom: '1px solid #f1f5f9' },

  topicTag: { fontSize: '0.7rem', background: '#e0e7ff', color: '#4338ca', padding: '4px 12px', borderRadius: '15px', fontWeight: 'bold' },
  closeBtn: { background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' },

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
  detailText: { fontSize: '1.2rem', fontWeight: '600', marginBottom: '25px', lineHeight: '1.5' },

  detailOptions: { display: 'grid', gap: '10px', boxSizing: 'border-box' },
  detailOpt: { padding: '15px', borderRadius: '10px', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxSizing: 'border-box' },
  detailOptMobile: { padding: '12px', flexDirection: 'column', alignItems: 'flex-start', gap: '6px', fontSize: '0.85rem' },

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
