import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient'; 
import LatexText from '../components/LatexText'; // 👈 YEH IMPORT GAYAB THA BHAI, AB FIXED HAI!

const BrainFeed = () => {
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

  // --- 🎯 SERVER-VERIFIED RESULTS: correctness/explanation now only arrive
  // AFTER submitting an attempt to the backend (pool answers are hidden
  // upfront by design) — keyed by question index, same as selectedAnswers.
  const [answerResults, setAnswerResults] = useState({});

  // --- IN-CARD INLINE VALIDATION WARNING STATE ---
  const [showWarning, setShowWarning] = useState(false);

  // --- MODAL POPUP WINDOW STATES ---
  const [showEndModal, setShowEndModal] = useState(false);
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

  // --- 🔁 SESSION MODE: 'live' (normal), 'reattempt' (redo, stats not saved), 'revise' (read-only scroll-through) ---
  const [sessionMode, setSessionMode] = useState('live');
  const viewportRef = useRef(null);
  const scrollDebounceTimer = useRef(null);
  const lastQuestionTimerRef = useRef(null);
  const awaitingCompletionRef = useRef(false);
  const pendingCompletionDataRef = useRef(null);
  const pendingLedgerWritesRef = useRef([]); // tracks in-flight submit-attempt promises, so Load More can wait for them to land before re-querying the ledger

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
  // (Forward-blocking itself happens earlier, at the touch level below — this only
  // ever runs for moves that were actually allowed, so there's nothing to fight here.)
  const handleFeedScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    clearTimeout(scrollDebounceTimer.current);
    scrollDebounceTimer.current = setTimeout(() => {
      const newIdx = Math.round(el.scrollTop / el.clientHeight);
      if (newIdx !== currentIdx && newIdx >= 0 && newIdx < questions.length) {
        setShowWarning(false);
        setCurrentIdx(newIdx);
      }
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

      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/pool/build-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: user.id,
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
        }
      } else {
        setCustomAlert({ show: true, title: 'Server Message', message: data.error || 'Failed to get questions from the server.' });
        setCooldown(60);
      }
    } catch (error) {
      console.error("BrainFeed Network Sync Crash:", error);
      setCustomAlert({ show: true, title: 'Network Error', message: 'Connection lost. Please try again after 60 seconds.' });
      setCooldown(60);
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

  const handleOptionSelect = (optIdx) => {
    if (selectedAnswers[currentIdx] !== undefined) return;
    setShowWarning(false);

    const lockedIdx = currentIdx;
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
    const ledgerWritePromise = supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      return fetch(`${import.meta.env.VITE_API_BASE_URL}/api/pool/submit-attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: user.id,
          questionId: q.id,
          selectedOptionIndex: optIdx
        })
      }).catch(err => console.warn("Ledger update skipped for this question (non-blocking):", err));
    }).catch(err => console.warn("Could not resolve user for ledger logging (non-blocking):", err));

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

  // 🎯 REALIGNED DATABASE PIPELINE: profiles table ke exact columns (brainfeed_count, brainfeed_accuracy) use honge!
  const saveSessionMetricsToProfile = async (answersOverride, resultsOverride) => {
    const answersData = answersOverride || selectedAnswers;
    const resultsData = resultsOverride || answerResults;
    const attempted = Object.keys(answersData).length;
    if (attempted === 0) return;

    const correct = Object.values(resultsData).filter(r => r.isCorrect).length;
    const sessionAccuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // 1. Read the real column names that exist in the profiles table
        const { data: profile } = await supabase
          .from('profiles')
          .select('brainfeed_count, brainfeed_accuracy')
          .eq('id', user.id)
          .single();

        const oldAttempted = profile?.brainfeed_count || 0;
        const oldAccuracy = profile?.brainfeed_accuracy || 0;
        const oldCorrect = Math.round((oldAccuracy / 100) * oldAttempted);

        // 2. Perform cumulative aggregations
        const newTotalQuestions = oldAttempted + attempted;
        const newTotalCorrect = oldCorrect + correct;
        const newOverallAccuracy = newTotalQuestions > 0 ? Math.round((newTotalCorrect / newTotalQuestions) * 100) : 0;

        // 3. Write to the real column names
        await supabase
          .from('profiles')
          .update({
            brainfeed_count: newTotalQuestions,
            brainfeed_accuracy: newOverallAccuracy
          })
          .eq('id', user.id);

          // Summary hooks update
          setMetricsSummary({
            sessionAccuracy,
            beforeAccuracy: oldAccuracy,
            newAccuracy: newOverallAccuracy,
            attempted,
            correct
          });
      }
    } catch (err) {
      console.error("Failed to update profile statistics:", err);
    }
  };

  const handleSaveToLibrary = async () => {
    const currentQ = questions[currentIdx];
    if (savedStatus[currentIdx]) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setCustomAlert({ show: true, title: 'Authentication Required', message: 'Your session expired. Please log in again to continue.' });
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/pool/toggle-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: user.id,
          questionId: currentQ.id,
          saved: true
        })
      });
      const data = await response.json();

      if (data.success) {
        setSavedStatus({ ...savedStatus, [currentIdx]: true });
      } else {
        setCustomAlert({ show: true, title: 'Save Failed', message: data.error || 'Could not save this question to your library.' });
      }
    } catch (err) {
      console.error("Save to library failed:", err);
      setCustomAlert({ show: true, title: 'Network Error', message: 'Could not save the question. Please check your connection.' });
    }
  };

  const handleTriggerExit = () => {
    const totalAttempted = Object.keys(selectedAnswers).length;
    const remaining = questions.length - totalAttempted;
    if (remaining > 0) {
      setShowExitWarning(true);
    } else {
      if (sessionMode === 'live') saveSessionMetricsToProfile();
      handleForceClearFeed();
    }
  };

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

  if (loading) {
    return (
      <div style={{ ...formWrapper, boxSizing: 'border-box', ...(isMobile ? { minHeight: 'auto', height: '100%', width: '100%', padding: '20px', overflow: 'hidden' } : {}) }}>
        <div style={{ ...formCard, boxSizing: 'border-box', maxWidth: '450px', width: '100%', textAlign: 'center', padding: '50px 30px' }}>
          <h3 style={{ color: '#1e293b', fontWeight: '900', fontSize: '1.4rem', margin: 0 }}>Loading your questions...</h3>
          <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '12px', lineHeight: '1.6', fontWeight: '500' }}>
            This'll just take a moment.
          </p>
        </div>
      </div>
    );
  }

  if (isFeedActive && questions.length > 0) {
    return (
      <div style={{ ...feedWrapperStyle, height: isMobile ? '100dvh' : '100vh' }}>
        <div style={{ ...topBarFeedStyle, padding: isMobile ? '12px 16px' : '16px 40px' }}>
          <button style={exitBtnStyle} onClick={handleTriggerExit}>End Session</button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
            <div style={counterBadgeStyle}>Card {currentIdx + 1} / {questions.length}</div>
            {sessionMode === 'revise' && <span style={modeHintTextStyle}>Revise mode — read only</span>}
            {sessionMode === 'reattempt' && <span style={modeHintTextStyle}>Reattempt — not counted in stats</span>}
          </div>
        </div>

        {isMobile && (
          <div style={scrollHintStyle}>Scroll up or down to move between questions</div>
        )}

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          height: isMobile ? 'calc(100dvh - 92px)' : '84vh',
          marginTop: isMobile ? '92px' : '65px',
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
                                background: savedStatus[idx] ? '#f8fafc' : '#000000',
                                color: savedStatus[idx] ? '#10b981' : '#ffffff',
                                borderColor: savedStatus[idx] ? '#10b981' : '#000000',
                                cursor: (itemChoice === undefined || savedStatus[idx]) ? 'not-allowed' : 'pointer'
                              }}
                            >
                              {savedStatus[idx] ? 'Saved' : 'Save'}
                            </button>
                          </div>
                        </div>
                        
                        <div style={{ ...scrollableCardContentBody, overflowY: isMobile ? 'visible' : 'auto', flex: isMobile ? 'none' : 1 }}>
                          <h2 style={questionTextStyle}><LatexText text={q.question} /></h2>

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
                                      <div style={explanationPopupHeader}>Explanation</div>
                                      <p style={explanationPopupText}>
                                        <LatexText text={resultData.explanation} />
                                      </p>
                                    </div>
                                  )}
                                  <button
                                    onClick={() => handleOptionSelect(oIdx)}
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
                  <span style={{ ...metricValueBadge, color: '#ffffff', background: '#000000', fontWeight: '800' }}>{metricsSummary.newAccuracy}%</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '24px' }}>
                <button onClick={() => fetchBrainFeedPacket(true)} style={{ ...modalActionBtn, background: '#000000', color: '#ffffff' }}>
                  Load More Questions
                </button>
                <button onClick={handleReviseSession} style={{ ...modalActionBtn, background: '#f1f5f9', color: '#0f172a', border: '1px solid #e2e8f0' }}>
                  Revise Questions
                </button>
                <button onClick={handleReattemptSession} style={{ ...modalActionBtn, background: '#f1f5f9', color: '#0f172a', border: '1px solid #e2e8f0' }}>
                  Reattempt Session
                </button>
                <button onClick={handleForceClearFeed} style={{ ...modalActionBtn, background: '#f1f5f9', color: '#0f172a', border: '1px solid #e2e8f0' }}>
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
                <button onClick={() => { saveSessionMetricsToProfile(); handleForceClearFeed(); }} style={{ ...modalActionBtn, flex: 1, background: '#ef4444' }}>
                  Save and Exit
                </button>
              </div>
            </div>
          </div>
        )}

        {customAlert.show && (
          <div style={modalOverlayStyle}>
            <div style={modalContentCardStyle}>
              <h3 style={{ margin: '0 0 10px 0', color: '#0f172a', fontWeight: '900' }}>{customAlert.title}</h3>
              <p style={{ color: '#64748b', fontSize: '0.88rem', margin: '0 0 20px 0', fontWeight: '500' }}>
                {customAlert.message}
              </p>
              <button 
                onClick={() => setCustomAlert({ show: false, title: '', message: '' })} 
                style={{ ...modalActionBtn, background: '#000000' }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ ...formWrapper, boxSizing: 'border-box', ...(isMobile ? { minHeight: 'auto', height: '100%', width: '100%', padding: 0, alignItems: 'stretch' } : {}) }}>
      {isMobile && (
        <style>{`
          .content-view {
            padding: 0 !important;
            overflow: hidden !important;
            height: calc(100dvh - 65px) !important;
          }
        `}</style>
      )}
      <div style={{
        ...formCard,
        padding: isMobile ? '18px' : '35px',
        ...(isMobile ? { width: '100%', maxWidth: '100%', height: '100%', border: 'none', borderRadius: 0, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden' } : {})
      }}>
        <h2 style={{ color: '#0f172a', marginBottom: '5px', fontWeight: '900', letterSpacing: '-0.5px', fontSize: isMobile ? '1.1rem' : '1.5rem' }}>Start a BrainFeed Session</h2>
        <p style={{ color: '#64748b', marginBottom: isMobile ? '12px' : '25px', fontSize: isMobile ? '0.76rem' : '0.9rem', fontWeight: '500' }}>
          Fill in the details to start practicing.
        </p>
        
        <div style={{ ...flexRow, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : flexRow.alignItems, gap: isMobile ? '0px' : '15px', marginBottom: isMobile ? '0' : flexRow.marginBottom }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Target Exam <span style={mandatoryStar}>*</span></label>
            <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: isMobile ? '10px' : '15px' }} placeholder="e.g. UPSC, SSC, Banking" value={exam} onChange={e => setExam(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Subject / Section <span style={mandatoryStar}>*</span></label>
            <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: isMobile ? '10px' : '15px' }} placeholder="e.g. Maths, English, GK" value={subjectSection} onChange={e => setSubjectSection(e.target.value)} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>Topic <span style={mandatoryStar}>*</span></label>
          <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: isMobile ? '10px' : '15px' }} placeholder="e.g. Trigonometry, Mughal Empire" value={subject} onChange={e => setSubject(e.target.value)} />
        </div>

        <div style={{ ...flexRow, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : flexRow.alignItems, gap: isMobile ? '0px' : '15px' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Difficulty</label>
            <div style={{ ...horizontalDifficultyContainer, width: '100%', boxSizing: 'border-box', marginBottom: isMobile ? '10px' : '15px' }}>
              {difficultyLevels.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => setDifficulty(level.value)}
                  style={{
                    ...difficultyTabOption,
                    flex: 1,
                    background: difficulty === level.value ? '#000000' : '#f8fafc',
                    color: difficulty === level.value ? '#ffffff' : '#334155',
                    borderColor: difficulty === level.value ? '#000000' : '#e2e8f0',
                  }}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', boxSizing: 'border-box', marginBottom: isMobile ? '10px' : '15px' }}>
              <label style={{ ...labelStyle, marginBottom: 0, whiteSpace: 'nowrap' }}>Language</label>
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
              background: cooldown > 0 ? '#94a3b8' : '#000000',
              cursor: cooldown > 0 ? 'not-allowed' : 'pointer'
            }}
          >
            {cooldown > 0 ? `Please wait ${cooldown}s to retry` : "Start Practice"}
          </button>
        </div>
      </div>
    </div>
  );
};

// Styles Objects Matrix
const formWrapper = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', padding: '20px', background: '#ffffff', fontFamily: 'Inter, sans-serif' }; const formCard = { background: '#fff', padding: '35px', borderRadius: '20px', border: '1px solid #e2e8f0', width: '100%', maxWidth: '620px' }; const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }; const mandatoryStar = { color: '#ef4444', fontWeight: '900' }; const inputStyle = { width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.95rem', outline: 'none', marginBottom: '15px', background: '#f8fafc', color: '#0f172a', fontWeight: '500' }; const flexRow = { display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '5px' }; const actionBtn = { border: 'none', color: '#fff', width: '100%', fontWeight: '700', transition: '0.2s', fontSize: '0.92rem' }; const horizontalDifficultyContainer = { display: 'flex', gap: '8px', width: '100%', marginBottom: '15px' }; const difficultyTabOption = { flex: 1, padding: '11px 12px', borderRadius: '10px', border: '1px solid', fontSize: '0.88rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s ease', textAlign: 'center' }; const feedWrapperStyle = { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }; const topBarFeedStyle = { position: 'absolute', top: 0, left: 0, width: '100%', padding: '16px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxSizing: 'border-box', borderBottom: '1px solid #e2e8f0', background: '#ffffff', zIndex: 12 }; const exitBtnStyle = { background: '#fff', color: '#ef4444', border: '1px solid #fee2e2', padding: '10px 20px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.82rem' }; const counterBadgeStyle = { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', padding: '8px 18px', borderRadius: '30px', fontSize: '0.82rem', fontWeight: '700' }; const mainControlRowStyle = { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '24px', width: '100%', justifyContent: 'center', height: '84vh', marginTop: '65px', boxSizing: 'border-box', padding: '0 40px' }; const sideNavBtnStyle = { width: '48px', height: '48px', borderRadius: '50%', border: '1px solid #e2e8f0', background: '#ffffff', color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: '800', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', flexShrink: 0, outline: 'none' }; const viewportContainerStyle = { width: '100%', height: '100%', overflow: 'hidden', position: 'relative', maxWidth: '980px', flexShrink: 0 }; const sliderTrackStyle = { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }; const cardSlideInstanceStyle = { width: '100%', height: '100%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', padding: '10px 0' }; const splitFlexContainerLayout = { display: 'flex', flexDirection: 'row', gap: '20px', width: '100%', height: '100%', alignItems: 'stretch', justifyContent: 'center' }; const fixedQuestionCardStyle = { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '20px', padding: '30px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '16px', width: '610px', maxHeight: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.015)', flexShrink: 0 }; const navBtnRect = { padding: '14px 26px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff', color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.92rem', fontWeight: '800', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', cursor: 'pointer', gap: '8px', outline: 'none' }; const scrollableCardContentBody = { flex: 1, overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '16px' }; const explanationPopupStyle = { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '14px 16px', marginBottom: '2px', boxShadow: '0 4px 12px rgba(16,185,129,0.08)' }; const explanationPopupHeader = { fontSize: '0.68rem', fontWeight: '900', letterSpacing: '0.5px', color: '#166534', marginBottom: '6px' }; const explanationPopupText = { margin: 0, fontSize: '0.85rem', color: '#166534', lineHeight: '1.5', fontWeight: '500' }; const qHeaderRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }; const qTypeLabel = { background: '#f1f5f9', color: '#475569', padding: '5px 12px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }; const statusIndicator = { fontSize: '0.75rem', fontWeight: '700' }; const saveBtnStyle = { border: '1px solid #e2e8f0', padding: '8px 16px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700' }; const questionTextStyle = { color: '#0f172a', margin: '5px 0', fontSize: '1.2rem', fontWeight: '800', lineHeight: '1.45', flexShrink: 0 }; const optionsContainerStyle = { display: 'flex', flexDirection: 'column', gap: '10px', margin: '5px 0', flexShrink: 0 }; const optionButtonStyle = { width: '100%', textAlign: 'left', padding: '12px 18px', borderRadius: '10px', border: '1px solid', fontSize: '0.92rem', fontWeight: '600', display: 'flex', alignItems: 'center', transition: 'all 0.15s ease' }; const optLabelMarker = { color: '#94a3b8', marginRight: '10px', fontWeight: '700' }; const inlineCardWarningStyle = { background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '600', flexShrink: 0 }; const modalOverlayStyle = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000 }; const modalContentCardStyle = { background: '#fff', padding: '30px', borderRadius: '20px', width: '90%', maxWidth: '380px', textAlign: 'center', border: '1px solid #e2e8f0', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }; const modalActionBtn = { width: '100%', padding: '12px', border: 'none', color: '#fff', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.88rem' }; const accuracyMetricsDashboardBox = { display: 'flex', flexDirection: 'column', gap: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', marginTop: '16px' }; const metricRowItem = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #edf2f7', paddingBottom: '10px' }; const metricLabelText = { fontSize: '0.82rem', fontWeight: '600', color: '#475569' }; const metricValueBadge = { fontSize: '0.78rem', fontWeight: '700', padding: '4px 10px', borderRadius: '6px' };
const modeHintTextStyle = { fontSize: '0.65rem', color: '#f59e0b', fontWeight: '700' };
const scrollHintStyle = { position: 'fixed', top: '78px', left: 0, right: 0, textAlign: 'center', fontSize: '0.72rem', color: '#94a3b8', fontWeight: '600', zIndex: 11, padding: '4px 0', pointerEvents: 'none' };

export default BrainFeed;