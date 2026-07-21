import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; 
import LatexText from '../components/LatexText'; // 👈 YEH IMPORT GAYAB THA BHAI, AB FIXED HAI!

// --- 🌐 LOCAL STORAGE STORAGE ENGINE MAPPINGS (matches Library.jsx / AnalysisPortal.jsx) ---
const dbName = "InfinityLocalDB";

const initBrainFeedDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("saved_questions")) {
        db.createObjectStore("saved_questions", { keyPath: "id" });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

const getAllFromLocalStore = async (storeName) => {
  const db = await initBrainFeedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (err) => reject(err);
  });
};

const saveToLocalStore = async (storeName, payload) => {
  const db = await initBrainFeedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.put(payload);
    tx.oncomplete = () => resolve();
    tx.onerror = (err) => reject(err);
  });
};

const BrainFeed = () => {
  // --- CONFIGURATION FORM STATES ---
  const [exam, setExam] = useState('');
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
    if (!subject.trim()) {
       setCustomAlert({ show: true, title: 'Required Field', message: 'Please enter a Subject or Topic to continue.' });
       return;
     }
    if (cooldown > 0) {
       setCustomAlert({ show: true, title: 'Security Cooldown', message: `Please wait ${cooldown} seconds before making another request.` });
       return;
     }
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/generate-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exam: exam || "General Competitive Exam",
          topic: subject,
          count: 15,
          type: 'Objective',
          difficulty: difficulty,
          language: language
        })
      });
      const data = await response.json();
      if (data.success && data.questions && data.questions.length > 0) {
        const mappedQuestions = data.questions.map(q => ({
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
        } else {
          setQuestions(mappedQuestions);
          setCurrentIdx(0);
          setSelectedAnswers({});
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
      saveSessionMetricsToProfile();
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
    setSelectedAnswers({
      ...selectedAnswers,
      [currentIdx]: optIdx
    });
  };

  // 🎯 REALIGNED DATABASE PIPELINE: profiles table ke exact columns (brainfeed_count, brainfeed_accuracy) use honge!
  const saveSessionMetricsToProfile = async () => {
    const attempted = Object.keys(selectedAnswers).length;
    if (attempted === 0) return;

    const correct = questions.filter((q, idx) => selectedAnswers[idx] === q.correct).length;
    const sessionAccuracy = Math.round((correct / attempted) * 100);

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
    try {
      const existingQuestions = await getAllFromLocalStore("saved_questions");
      const alreadySaved = existingQuestions.some(q => q.question === currentQ.question);

      if (alreadySaved) {
        return setCustomAlert({ show: true, title: 'Already Saved', message: 'This question framework is already saved in your library.' });
      }

      const localQuestionPayload = {
        id: "SAVED_Q_" + Date.now(),
        topic: subject || "BrainFeed Session",
        question: currentQ.question,
        answer: currentQ.options[currentQ.correct],
        explanation: currentQ.explanation,
        saved_at: new Date().toISOString()
      };

      await saveToLocalStore("saved_questions", localQuestionPayload);
      setSavedStatus({ ...savedStatus, [currentIdx]: true });
    } catch (err) {
      console.error("Local Storage Save Failed:", err);
      setCustomAlert({ show: true, title: 'Storage Error', message: 'Could not save the question to your local device library.' });
    }
  };

  const handleTriggerExit = () => {
    const totalAttempted = Object.keys(selectedAnswers).length;
    const remaining = questions.length - totalAttempted;
    if (remaining > 0) {
      setShowExitWarning(true);
    } else {
      saveSessionMetricsToProfile();
      handleForceClearFeed();
    }
  };

  const handleForceClearFeed = () => {
    setQuestions([]);
    setCurrentIdx(0);
    setSelectedAnswers({});
    setSavedStatus({});
    setShowWarning(false);
    setIsFeedActive(false);
    setShowExitWarning(false);
    setShowEndModal(false);
  };

  if (loading) {
    return (
      <div style={formWrapper}>
        <div style={{ ...formCard, maxWidth: '450px', textAlign: 'center', padding: '50px 30px' }}>
          <h3 style={{ color: '#1e293b', fontWeight: '900', fontSize: '1.4rem', margin: 0 }}>Compiling Intelligence Stream...</h3>
          <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '12px', lineHeight: '1.6', fontWeight: '500' }}>
            Optimizing targeted evaluation modules from the AI core network. Preparing single-card execution matrix...
          </p>
        </div>
      </div>
    );
  }

  if (isFeedActive && questions.length > 0) {
    return (
      <div style={feedWrapperStyle}>
        <div style={topBarFeedStyle}>
          <button style={exitBtnStyle} onClick={handleTriggerExit}>End Practice Session</button>
          <div style={counterBadgeStyle}>Card {currentIdx + 1} / {questions.length}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '84vh', marginTop: '65px', boxSizing: 'border-box', padding: isMobile ? '0 8px' : '0 40px', gap: '14px' }}>
          <div style={{ ...viewportContainerStyle, maxWidth: isMobile ? '100%' : '650px', flex: 1 }}>
            <div style={{ ...sliderTrackStyle, transform: `translateY(-${currentIdx * 100}%)` }}>
              {questions.map((q, idx) => {
                const itemChoice = selectedAnswers[idx];
                
                return (
                  <div key={idx} style={cardSlideInstanceStyle}>
                    <div style={{ ...fixedQuestionCardStyle, width: '100%', maxWidth: isMobile ? '100%' : '610px' }}>
                      <div style={qHeaderRow}>
                        <span style={qTypeLabel}>Concept Drill</span>
                        
                        <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                          {itemChoice !== undefined && (
                            <span style={{ ...statusIndicator, color: itemChoice === q.correct ? '#10b981' : '#f43f5e' }}>
                              {itemChoice === q.correct ? 'CORRECT' : 'INCORRECT'}
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
                            {savedStatus[idx] ? 'Saved' : 'Save to Library'}
                          </button>
                        </div>
                      </div>
                      
                      <div style={scrollableCardContentBody}>
                        <h2 style={questionTextStyle}><LatexText text={q.question} /></h2>

                        {showWarning && idx === currentIdx && (
                          <div style={inlineCardWarningStyle}>
                            Action Required: Question navigation locked. Please select an option from the matrix list below before proceeding.
                          </div>
                        )}

                        <div style={optionsContainerStyle}>
                          {q.options.map((opt, oIdx) => {
                            let dynamicBg = '#ffffff';
                            let dynamicBorder = '#e2e8f0';
                            let dynamicColor = '#334155';

                            if (itemChoice !== undefined) {
                              if (oIdx === q.correct) {
                                dynamicBg = '#f0fdf4';
                                dynamicBorder = '#10b981';
                                dynamicColor = '#166534';
                              } else if (itemChoice === oIdx && itemChoice !== q.correct) {
                                dynamicBg = '#fff1f2';
                                dynamicBorder = '#ef4444';
                                dynamicColor = '#991b1b';
                              } else {
                                dynamicBg = '#f8fafc';
                                dynamicBorder = '#e2e8f0';
                                dynamicColor = '#94a3b8';
                              }
                            }

                            const isCorrectOption = oIdx === q.correct;

                            return (
                              <React.Fragment key={oIdx}>
                                {/* 💡 Explanation pops up directly above the correct option, right after attempting */}
                                {itemChoice !== undefined && isCorrectOption && (
                                  <div style={explanationPopupStyle}>
                                    <div style={explanationPopupHeader}>CORE RESOLUTION STATEMENT</div>
                                    <p style={explanationPopupText}>
                                      <LatexText text={q.explanation} />
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
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'row', gap: '14px', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <button 
              type="button"
              onClick={handlePrevCard} 
              disabled={currentIdx === 0}
              style={{ ...sideNavBtnStyle, width: isMobile ? '40px' : '48px', height: isMobile ? '40px' : '48px', flexShrink: 0, opacity: currentIdx === 0 ? 0.3 : 1, cursor: currentIdx === 0 ? 'not-allowed' : 'pointer' }}
              title="Previous question"
            >
              ↑
            </button>
            <button 
              type="button" 
              onClick={handleNextCard}
              style={{ ...sideNavBtnStyle, width: isMobile ? '40px' : '48px', height: isMobile ? '40px' : '48px', flexShrink: 0 }}
              title="Next question"
            >
              ↓
            </button>
          </div>

        </div>

        {/* 📊 ACCURACY EVALUATION CARD POPUP OVERLAY */}
        {showEndModal && (
          <div style={modalOverlayStyle}>
            <div style={{ ...modalContentCardStyle, maxWidth: '420px', textAlign: 'left' }}>
              <h3 style={{ margin: '0 0 6px 0', color: '#1e293b', fontWeight: '900', fontSize: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                Session Performance Card
              </h3>
              <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 20px 0', fontWeight: '500', lineHeight: '1.4' }}>
                Your session answers have been evaluated and aggregated directly inside your profile metrics layer.
              </p>

              <div style={accuracyMetricsDashboardBox}>
                <div style={metricRowItem}>
                  <span style={metricLabelText}>Questions Attempted</span>
                  <span style={{ ...metricValueBadge, color: '#0f172a', background: '#f1f5f9' }}>{metricsSummary.attempted}</span>
                </div>
                <div style={metricRowItem}>
                  <span style={metricLabelText}>Current Session Accuracy</span>
                  <span style={{ ...metricValueBadge, color: '#10b981', background: '#f0fdf4' }}>{metricsSummary.sessionAccuracy}%</span>
                </div>
                <div style={metricRowItem}>
                  <span style={metricLabelText}>Accuracy Before This Session</span>
                  <span style={{ ...metricValueBadge, color: '#4f46e5', background: '#e0e7ff' }}>{metricsSummary.beforeAccuracy}%</span>
                </div>
                <div style={{ ...metricRowItem, border: 'none', padding: 0, marginTop: '4px' }}>
                  <span style={{ ...metricLabelText, fontWeight: '700', color: '#0f172a' }}>New Overall Cumulative Accuracy</span>
                  <span style={{ ...metricValueBadge, color: '#ffffff', background: '#000000', fontWeight: '800' }}>{metricsSummary.newAccuracy}%</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '24px' }}>
                <button onClick={() => fetchBrainFeedPacket(true)} style={{ ...modalActionBtn, background: '#000000', color: '#ffffff' }}>
                  Load Next Question Packet
                </button>
                <button onClick={handleForceClearFeed} style={{ ...modalActionBtn, background: '#f1f5f9', color: '#0f172a', border: '1px solid #e2e8f0' }}>
                  Close and Exit Session
                </button>
              </div>
            </div>
          </div>
        )}

        {showExitWarning && (
          <div style={modalOverlayStyle}>
            <div style={modalContentCardStyle}>
              <h3 style={{ margin: '0 0 10px 0', color: '#0f172a', fontWeight: '900' }}>Session Interruption Alert</h3>
              <p style={{ color: '#64748b', fontSize: '0.88rem', margin: '0 0 25px 0', fontWeight: '500' }}>
                Unattempted question frames are pending in the current pool. Exiting now will update stats only for answered items.
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
    <div style={formWrapper}>
      <div style={formCard}>
        <h2 style={{ color: '#0f172a', marginBottom: '5px', fontWeight: '900', letterSpacing: '-0.5px' }}>BrainFeed Engine Terminal</h2>
        <p style={{ color: '#64748b', marginBottom: '25px', fontSize: '0.9rem', fontWeight: '500' }}>
          Configure specific parameters to launch a custom practice sequence.
        </p>
        
        <div style={flexRow}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Target Core Exam</label>
            <input style={inputStyle} placeholder="e.g. UPSC, SSC, Banking" value={exam} onChange={e => setExam(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Focus Subject / Topic Module</label>
            <input style={inputStyle} placeholder="e.g. History, Physics" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
        </div>

        <div style={flexRow}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Difficulty Grading</label>
            <div style={horizontalDifficultyContainer}>
              {difficultyLevels.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => setDifficulty(level.value)}
                  style={{
                    ...difficultyTabOption,
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
            <label style={labelStyle}>Reel Output Language</label>
            <select style={{ ...inputStyle, padding: '11px' }} value={language} onChange={e => setLanguage(e.target.value)}>
              <option value="English">English Stream</option>
              <option value="Hindi">Hindi Stream</option>
            </select>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '20px', marginTop: '15px' }}>
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
            {cooldown > 0 ? `Cooldown Guard Active: Retry in ${cooldown}s` : "Initialize BrainFeed Stream"}
          </button>
        </div>
      </div>
    </div>
  );
};

// Styles Objects Matrix
const formWrapper = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', padding: '20px', background: '#ffffff', fontFamily: 'Inter, sans-serif' }; const formCard = { background: '#fff', padding: '35px', borderRadius: '20px', border: '1px solid #e2e8f0', width: '100%', maxWidth: '620px' }; const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }; const inputStyle = { width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.95rem', outline: 'none', marginBottom: '15px', background: '#f8fafc', color: '#0f172a', fontWeight: '500' }; const flexRow = { display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '5px' }; const actionBtn = { border: 'none', color: '#fff', width: '100%', fontWeight: '700', transition: '0.2s', fontSize: '0.92rem' }; const horizontalDifficultyContainer = { display: 'flex', gap: '8px', width: '100%', marginBottom: '15px' }; const difficultyTabOption = { flex: 1, padding: '11px 12px', borderRadius: '10px', border: '1px solid', fontSize: '0.88rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s ease', textAlign: 'center' }; const feedWrapperStyle = { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }; const topBarFeedStyle = { position: 'absolute', top: 0, left: 0, width: '100%', padding: '16px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxSizing: 'border-box', borderBottom: '1px solid #e2e8f0', background: '#ffffff', zIndex: 12 }; const exitBtnStyle = { background: '#fff', color: '#ef4444', border: '1px solid #fee2e2', padding: '10px 20px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.82rem' }; const counterBadgeStyle = { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', padding: '8px 18px', borderRadius: '30px', fontSize: '0.82rem', fontWeight: '700' }; const mainControlRowStyle = { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '24px', width: '100%', justifyContent: 'center', height: '84vh', marginTop: '65px', boxSizing: 'border-box', padding: '0 40px' }; const sideNavBtnStyle = { width: '48px', height: '48px', borderRadius: '50%', border: '1px solid #e2e8f0', background: '#ffffff', color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: '800', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', flexShrink: 0, outline: 'none' }; const viewportContainerStyle = { width: '100%', height: '100%', overflow: 'hidden', position: 'relative', maxWidth: '980px', flexShrink: 0 }; const sliderTrackStyle = { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }; const cardSlideInstanceStyle = { width: '100%', height: '100%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', padding: '10px 0' }; const splitFlexContainerLayout = { display: 'flex', flexDirection: 'row', gap: '20px', width: '100%', height: '100%', alignItems: 'stretch', justifyContent: 'center' }; const fixedQuestionCardStyle = { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '20px', padding: '30px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '16px', width: '610px', height: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.015)', flexShrink: 0 }; const scrollableCardContentBody = { flex: 1, overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '16px' }; const explanationPopupStyle = { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '14px 16px', marginBottom: '2px', boxShadow: '0 4px 12px rgba(16,185,129,0.08)' }; const explanationPopupHeader = { fontSize: '0.68rem', fontWeight: '900', letterSpacing: '0.5px', color: '#166534', marginBottom: '6px' }; const explanationPopupText = { margin: 0, fontSize: '0.85rem', color: '#166534', lineHeight: '1.5', fontWeight: '500' }; const qHeaderRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }; const qTypeLabel = { background: '#f1f5f9', color: '#475569', padding: '5px 12px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }; const statusIndicator = { fontSize: '0.75rem', fontWeight: '700' }; const saveBtnStyle = { border: '1px solid #e2e8f0', padding: '8px 16px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700' }; const questionTextStyle = { color: '#0f172a', margin: '5px 0', fontSize: '1.2rem', fontWeight: '800', lineHeight: '1.45', flexShrink: 0 }; const optionsContainerStyle = { display: 'flex', flexDirection: 'column', gap: '10px', margin: '5px 0', flexShrink: 0 }; const optionButtonStyle = { width: '100%', textAlign: 'left', padding: '12px 18px', borderRadius: '10px', border: '1px solid', fontSize: '0.92rem', fontWeight: '600', display: 'flex', alignItems: 'center', transition: 'all 0.15s ease' }; const optLabelMarker = { color: '#94a3b8', marginRight: '10px', fontWeight: '700' }; const inlineCardWarningStyle = { background: '#fef2f2', border: '1px solid #fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '600', flexShrink: 0 }; const modalOverlayStyle = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000 }; const modalContentCardStyle = { background: '#fff', padding: '30px', borderRadius: '20px', width: '90%', maxWidth: '380px', textAlign: 'center', border: '1px solid #e2e8f0', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }; const modalActionBtn = { width: '100%', padding: '12px', border: 'none', color: '#fff', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.88rem' }; const accuracyMetricsDashboardBox = { display: 'flex', flexDirection: 'column', gap: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', marginTop: '16px' }; const metricRowItem = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #edf2f7', paddingBottom: '10px' }; const metricLabelText = { fontSize: '0.82rem', fontWeight: '600', color: '#475569' }; const metricValueBadge = { fontSize: '0.78rem', fontWeight: '700', padding: '4px 10px', borderRadius: '6px' };

export default BrainFeed;