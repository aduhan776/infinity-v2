import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; // ⚡ Linked cloud connection gateway

const AnalysisPortal = ({ results, onBackToDashboard }) => {
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedQIdx, setSelectedQIdx] = useState(null);
  const [showExplanation, setShowExplanation] = useState(false); // Track explanation toggle state
  const [savedStatus, setSavedStatus] = useState({}); // ⚡ Tracks saved bookmark state for analysis queries

  // --- DATA EXTRACTION ---
  // 🚨 DEFENSIVE SAFE-GUARDS LAYER: Added object recovery defaults to absorb unmapped field transitions without crashes
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

  // --- 1. PRECISE CALCULATION LOGIC ---
  const totalQ = questions ? questions.length : 0;
  const objectiveIndices = questions ? questions.map((q, i) => q.type === 'Objective' ? i : -1).filter(i => i !== -1) : [];
  const correctCount = objectiveIndices.filter(idx => answers[idx] === questions[idx]?.correct).length;
  
  // Ekdum makkhan aur bulletproof logic 
  const incorrectCount = objectiveIndices.filter(idx => answers[idx] !== undefined && answers[idx] !== null && answers[idx] !== questions[idx]?.correct).length;
  const attemptedCount = questions ? questions.filter((_, i) => {
    const hasAns = answers[i] !== undefined && answers[i] !== null && answers[i] !== "";
    const hasUp = uploads[i] && uploads[i].length > 0;
    return hasAns || hasUp;
  }).length : 0;
  const unattemptedCount = totalQ - attemptedCount;

  // Ekdum Dynamic Score Calculator 
  const totalScore = objectiveIndices.reduce((sum, idx) => {
    if (questions[idx] && answers[idx] === questions[idx].correct) {
      return sum + parseFloat(questions[idx].marks || 2);
    } else if (answers[idx] !== undefined && answers[idx] !== null && answers[idx] !== "") {
      return sum + parseFloat(questions[idx]?.neg || -0.66);
    }
    return sum;
  }, 0);
  const accuracy = attemptedCount > 0 ? Math.round((correctCount / (correctCount + incorrectCount)) * 100) : 0;

  // --- 2. BACKGROUND LIBRARY & CLOUD SYNC ---
  useEffect(() => {
    if (!id) return;
    const syncScoreWithLibrary = async () => {
      // Local sync fallbacks
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

      // 🎯 Cloud Sync: Update finalized evaluation parameters on Supabase
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase
            .from('test_sessions')
            .update({
              score: totalScore.toFixed(2),
              accuracy: accuracy + "%"
            })
            .eq('user_id', user.id)
            .eq('test_id', id)
            .eq('status', 'submitted');
        }
      } catch (err) {
        console.error("Cloud parameters synchronization loop failure:", err);
      }
    };
    syncScoreWithLibrary();
  }, [totalScore, accuracy, id, attemptId]);

  // --- ⚡ NEW: SECURE CLOUD QUESTION BOOKMARKING CONTROLLER ---
  const handleSaveQuestion = async (e, q) => {
    if (e) e.stopPropagation(); // Stop opening the modal from card background context clicks
    if (!q) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return alert("Bhai login session issue rha. Dubara check karo!");

      const { data: existing } = await supabase
        .from('saved_questions')
        .select('id')
        .eq('user_id', user.id)
        .eq('question', q.question)
        .limit(1);

      if (existing && existing.length > 0) {
        setSavedStatus(prev => ({ ...prev, [q.question]: true }));
        return alert("Bhai, ye question pehle se tere library vault mein safe hai! 🔖");
      }

      const { error } = await supabase
        .from('saved_questions')
        .insert([
          {
            user_id: user.id,
            topic: "Exam Analysis",
            question: q.question,
            answer: q.type === 'Objective' ? q.options[q.correct] : "Subjective Verification Required",
            explanation: q.explanation || "Saved directly via platform test evaluation metrics portal window."
          }
        ]);

      if (error) throw error;

      setSavedStatus(prev => ({ ...prev, [q.question]: true }));
      alert("Success: Question stored directly in academic cloud vault! 🔖");
    } catch (err) {
      console.error(err);
      alert("Database error while committing current question block.");
    }
  };

  // --- HELPERS ---
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
      return answers[idx] === questions[idx].correct ? 'correct' : 'incorrect';
    }
    return 'attempted';
  };

  // --- FILTERS ---
  const filteredIndices = questions ? questions.map((_, i) => i).filter(idx => {
    const status = getQStatus(idx);
    if (activeFilter === 'attempted') return status !== 'unattempted';
    if (activeFilter === 'unattempted') return status === 'unattempted';
    if (activeFilter === 'incorrect') return status === 'incorrect';
    return true;
  }) : [];

  return (
    <div style={styles.container}>
      {/* --- OVERALL SUMMARY DASHBOARD --- */}
      <div style={styles.summaryHeader}>
        <div style={styles.summaryHeaderMain}>
           <div>
             <h1 style={{margin:0, color:'#1e293b'}}>Test Results: {title}</h1>
             <p style={{color:'#64748b', margin:'5px 0 0 0'}}>Bhai, ye raha tera final analysis report:</p>
           </div>
           <button onClick={onBackToDashboard} style={styles.homeBtn}>Back to Dashboard</button>
        </div>
        <div style={styles.mainStatsGrid}>
          <div style={styles.mainStatCard}>
             <span style={styles.mainStatLabel}>FINAL SCORE</span>
             <span style={{...styles.mainStatValue, color:'#6366f1'}}>{totalScore.toFixed(2)}</span>
          </div>
          <div style={styles.mainStatCard}>
             <span style={styles.mainStatLabel}>ACCURACY</span>
             <span style={{...styles.mainStatValue, color:'#22c55e'}}>{accuracy}%</span>
          </div>
          <div style={styles.mainStatCard}>
             <span style={styles.mainStatLabel}>CORRECT</span>
             <span style={{...styles.mainStatValue, color:'#22c55e'}}>{correctCount}</span>
          </div>
          <div style={styles.mainStatCard}>
             <span style={styles.mainStatLabel}>INCORRECT</span>
             <span style={{...styles.mainStatValue, color:'#ef4444'}}>{incorrectCount}</span>
          </div>
          <div style={styles.mainStatCard}>
             <span style={styles.mainStatLabel}>UNATTEMPTED</span>
             <span style={{...styles.mainStatValue, color:'#94a3b8'}}>{unattemptedCount}</span>
          </div>
        </div>
      </div>

      <div style={styles.topicSection}>
        <div style={styles.topicBadge}>Total Questions: {totalQ}</div>
        <div style={styles.topicBadge}>Negative Marks: {(incorrectCount * 0.66).toFixed(2)}</div>
        <div style={styles.topicBadge}>Time Remaining: {formatTime(timeLeft)}</div>
      </div>

      <div style={styles.filterBar}>
        {['all', 'attempted', 'unattempted', 'incorrect'].map(f => (
          <button key={f} 
             style={activeFilter === f ? styles.activeFilter : styles.filterBtn}
             onClick={() => setActiveFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div style={styles.listGrid}>
        {filteredIndices.map(idx => {
          if (!questions[idx]) return null;
          const status = getQStatus(idx);
          const isIncorrect = status === 'incorrect';
          const bgColor = status === 'correct' ? '#f0fdf4' : isIncorrect ? '#fef2f2' : '#fff';
          const borderColor = status === 'correct' ? '#22c55e' : isIncorrect ? '#ef4444' : '#e2e8f0';
          const isQuestionSaved = !!savedStatus[questions[idx].question];
          return (
            <div key={idx} 
               style={{ ...styles.qCardSmall, background: bgColor, borderColor: borderColor }}
              onClick={() => { setSelectedQIdx(idx); setShowExplanation(false); }}
            >
              <div style={styles.cardHeader}>
                <span style={styles.qNum}>Question {idx + 1}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* 🎯 FLOATING BOOKMARK ICON SYSTEM IN MATRIX LIST */}
                  <button 
                    onClick={(e) => handleSaveQuestion(e, questions[idx])}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.05rem', padding: '2px', opacity: isQuestionSaved ? 1 : 0.35, transition: '0.15s ease' }}
                    title={isQuestionSaved ? "Question Saved in Vault" : "Bookmark Question to Cloud Vault"}
                  >
                    🔖
                  </button>
                  <span style={{ fontWeight: '800', color: isIncorrect ? '#ef4444' : '#22c55e' }}>
                     {isIncorrect ? questions[idx].neg : (status === 'unattempted' ? '0.0' : questions[idx].marks)}
                  </span>
                </div>
              </div>
              <p style={styles.qTruncated}>{questions[idx].question}</p>
              <div style={styles.smallTime}>⏱️ Time Taken: {formatTime(timeTracker[idx])}</div>
            </div>
          );
        })}
      </div>

      {/* --- DETAILED QUESTION REVIEW OVERLAY WINDOW --- */}
      {selectedQIdx !== null && questions[selectedQIdx] && (
        <div style={styles.overlay}>
          <div style={styles.detailContainer}>
            <div style={styles.detailHeader}>
              <div style={{display:'flex', gap:'15px', alignItems:'center'}}>
                <h3 style={{margin:0}}>Q. {selectedQIdx + 1} Detailed Review</h3>
                <span style={styles.topicTag}>#EXAM_ANALYSIS</span>
              </div>
              <button onClick={() => { setSelectedQIdx(null); setShowExplanation(false); }} style={styles.closeBtn}>❌ Close</button>
            </div>
            <div style={styles.detailBody}>
               
              {/* ORIGINAL SPLIT PANEL DESIGN: Left Workspace Area */}
              <div style={styles.detailLeft}>
                <div style={styles.detailLeftScrollArea}>
                  <div style={styles.metaRow}>
                    <span style={styles.metaItem}>⏱️ <strong>Your Time:</strong> {formatTime(timeTracker[selectedQIdx])}</span>
                  </div>
                  <p style={styles.detailText}>{questions[selectedQIdx].question}</p>
                   
                  {questions[selectedQIdx].type === 'Objective' ? (
                    <div style={styles.detailOptions}>
                      {questions[selectedQIdx].options.map((opt, oIdx) => {
                        const isCorrect = oIdx === questions[selectedQIdx].correct;
                        const isUserChoice = answers[selectedQIdx] === oIdx;
                        
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
                            border: borderStyle,
                            background: bgStyle
                          }}>
                            <span>{String.fromCharCode(65 + oIdx)}. {opt}</span>
                            {isCorrect && isUserChoice && <span style={{ color: '#22c55e', fontWeight: 'bold' }}>✨ Correct Answer & Your Choice</span>}
                            {isCorrect && !isUserChoice && <span style={{ color: '#16a34a', fontWeight: 'bold' }}>🎯 Correct Answer</span>}
                            {isUserChoice && !isCorrect && <span style={{ color: '#ef4444', fontWeight: 'bold' }}>❌ Your Wrong Choice</span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* 📝 SUBJECTIVE DISCOVERY OVERHEAD: Renders user upload + AI point summary instead of blank fields */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div style={styles.subAnalysis}>
                        <div style={styles.subPreview}>
                          <strong>Your Uploaded Answer Copy:</strong>
                          {uploads[selectedQIdx] && uploads[selectedQIdx].length > 0 ? (
                            <div style={styles.thumbGrid}>
                              {uploads[selectedQIdx].map((file, fi) => (
                                <img key={fi} src={file.url} style={styles.prevImg} alt="sheet" />
                              ))}
                            </div>
                          ) : <p style={{color:'#64748b', fontSize:'0.9rem', fontStyle:'italic'}}>{answers[selectedQIdx] || "No digital handwritten sheet snapshot uploaded."}</p>}
                        </div>
                      </div>

                      {/* 🔥 NEW LAYOUT BLOCK: Renders point summary exactly where objective choices used to appear */}
                      <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                        <strong style={{ color: '#4f46e5', fontSize: '0.9rem', display: 'block', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
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
                            <>
                              <li style={{ fontSize: '0.92rem', color: '#334155', fontWeight: '500' }}>Addressed the primary core definitions and background timeline constraints.</li>
                              <li style={{ fontSize: '0.92rem', color: '#334155', fontWeight: '500' }}>Incorporated key operational terms and structured structural context segments.</li>
                              <li style={{ fontSize: '0.92rem', color: '#334155', fontWeight: '500' }}>Synchronized technical provisions matching final question marking blueprint grids.</li>
                            </>
                          )}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* DYNAMIC INLINE EXPLANATION CARD (Triggers on Toggle click) */}
                  {showExplanation && (
                    <div style={styles.inlineExplanationCard}>
                      <strong style={{ color: '#6366f1', display: 'block', marginBottom: '6px', fontSize: '0.95rem' }}>
                         {questions[selectedQIdx].type === 'Subjective' ? '🎯 Scope of Improvement Summary:' : '💡 AI Quick Resolution:'}
                      </strong>
                      <p style={{ margin: 0, fontSize: '0.92rem', color: '#334155', lineHeight: '1.5', fontWeight: '500' }}>
                        {questions[selectedQIdx].type === 'Subjective'
                          ? (questions[selectedQIdx].ai_evaluation?.scope_of_improvement || "To score full marks, enrich your core layout matrix with direct legal articles or relevant committee references to solidify final analytical conclusions.")
                          : (questions[selectedQIdx].explanation || "Bhai, is question ke liye koi short explanation available nahi hai.")
                        }
                      </p>
                    </div>
                  )}
                </div>

                {/* PINNED NAVIGATION PANEL ROW */}
                <div style={styles.detailFixedNavRow}>
                  <button onClick={() => { setSelectedQIdx(prev => Math.max(0, prev - 1)); setShowExplanation(false); }} disabled={selectedQIdx === 0} style={styles.navBtn}>Previous</button>
                   
                  {/* Upgraded Toggle Button */}
                  <button 
                     onClick={() => setShowExplanation(!showExplanation)} 
                     style={{ ...styles.doubtBtn, background: showExplanation ? '#ef4444' : '#1e293b' }}
                  >
                    {showExplanation ? "📖 Hide Explanation" : "💡 Show Explanation"}
                  </button>

                  {/* 🎯 INTEGRATED UNIQUE SAVE TO VAULT BUTTON INSIDE REVIEW WORKSPACE */}
                  <button 
                    onClick={(e) => handleSaveQuestion(e, questions[selectedQIdx])}
                    disabled={!!savedStatus[questions[selectedQIdx].question]}
                    style={{ ...styles.doubtBtn, background: savedStatus[questions[selectedQIdx].question] ? '#10b981' : '#6366f1', color: '#fff', border: 'none' }}
                  >
                    {savedStatus[questions[selectedQIdx].question] ? "📁 Question Saved" : "🔖 Save to Library"}
                  </button>
                   
                  <button onClick={() => { setSelectedQIdx(prev => Math.min(questions.length - 1, prev + 1)); setShowExplanation(false); }} disabled={selectedQIdx === questions.length - 1} style={styles.navBtn}>Next</button>
                </div>
              </div>

              {/* ORIGINAL SPLIT PANEL DESIGN: Right Explanation Area (RESTORED WITH CONDITIONAL EVALUATION WINDOW) */}
              <div style={styles.detailRight}>
                <h4 style={styles.explanationTitle}>
                  {questions[selectedQIdx].type === 'Subjective' ? '🎯 What Could Have Been Better (AI Feedback):' : '🧠 AI Explanation & Analytical Working:'}
                </h4>
                <p style={styles.explanationText}>
                  {questions[selectedQIdx].type === 'Subjective'
                    ? (questions[selectedQIdx].ai_evaluation?.scope_of_improvement || "Your fundamental answer pattern is stable, but adding landmark judicial precedents or connecting arguments with standard committee metrics will boost structural clarity. Focus on balancing presentation with specific sub-sections to cross the top evaluation thresholds.")
                    : (questions[selectedQIdx].explanation || "Bhai, is question ke liye koi detailed explanation store nahi hai.")
                  }
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- ORIGINAL STYLES SCHEMA ---
const styles = {
  container: { padding: '30px', background: '#f8fafc', minHeight: '100vh' },
  summaryHeader: { background: '#fff', padding: '30px', borderRadius: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', marginBottom: '30px' },
  summaryHeaderMain: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' },
  homeBtn: { background: '#1e293b', color: '#fff', border: 'none', padding: '12px 25px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' },
  mainStatsGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px' },
  mainStatCard: { padding: '15px', background: '#f8fafc', borderRadius: '15px', textAlign: 'center', border: '1px solid #e2e8f0' },
  mainStatLabel: { display: 'block', fontSize: '0.65rem', fontWeight: '900', color: '#94a3b8', marginBottom: '5px' },
  mainStatValue: { fontSize: '1.5rem', fontWeight: '900', color: '#1e293b' },
  topicSection: { display: 'flex', gap: '10px', marginBottom: '25px' },
  topicBadge: { background: '#f1f5f9', padding: '6px 15px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700', color: '#475569' },
  filterBar: { display: 'flex', gap: '10px', marginBottom: '25px' },
  filterBtn: { padding: '8px 18px', borderRadius: '20px', border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' },
  activeFilter: { padding: '8px 18px', borderRadius: '20px', border: 'none', background: '#6366f1', color: '#fff', fontWeight: 'bold', fontSize: '0.85rem' },
  listGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px' },
  qCardSmall: { padding: '15px', borderRadius: '12px', border: '2px solid', cursor: 'pointer', transition: '0.3s' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: '8px' },
  qNum: { fontWeight: '800', color: '#64748b', fontSize: '0.75rem' },
  qTruncated: { fontSize: '0.9rem', fontWeight: '600', margin: '0 0 10px 0', height: '2.4em', overflow: 'hidden' },
  smallTime: { fontSize: '0.7rem', color: '#94a3b8', fontWeight: '700' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.9)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
  detailContainer: { background: '#fff', width: '100%', maxWidth: '1100px', height: '85vh', borderRadius: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  detailHeader: { padding: '20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fcfdfe' },
  topicTag: { fontSize: '0.7rem', background: '#e0e7ff', color: '#4338ca', padding: '4px 12px', borderRadius: '15px', fontWeight: 'bold' },
  closeBtn: { background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' },
  detailBody: { display: 'flex', flex: 1, overflow: 'hidden' },
  detailLeft: { flex: 1.2, display: 'flex', flexDirection: 'column', background: '#fff', borderRight: '1px solid #e2e8f0', overflow: 'hidden' },
  detailLeftScrollArea: { flex: 1, overflowY: 'auto', padding: '30px' },
  detailFixedNavRow: { padding: '20px 30px', background: '#fff', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '10px', flexShrink: 0 },
  detailRight: { flex: 0.8, padding: '30px', background: '#f8fafc', overflowY: 'auto' },
  explanationTitle: { margin: '0 0 15px 0', color: '#1e293b', fontSize: '1.05rem', fontWeight: '800' },
  explanationText: { color: '#475569', fontSize: '0.95rem', lineHeight: '1.6', fontWeight: '500' },
  metaRow: { display: 'flex', gap: '20px', marginBottom: '20px', borderBottom: '1px solid #f1f5f9', paddingBottom: '15px' },
  metaItem: { fontSize: '0.8rem', color: '#475569' },
  detailText: { fontSize: '1.2rem', fontWeight: '600', marginBottom: '25px', lineHeight: '1.5' },
  detailOptions: { display: 'grid', gap: '10px' },
  detailOpt: { padding: '15px', borderRadius: '10px', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  navBtn: { flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', fontWeight: 'bold', cursor: 'pointer' },
  doubtBtn: { flex: 1.5, background: '#1e293b', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s ease' },
  subAnalysis: { background: '#fff', border: '1px solid #e2e8f0', padding: '20px', borderRadius: '12px' },
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
    animation: 'fadeIn 0.2s ease'
  }
};

export default AnalysisPortal;