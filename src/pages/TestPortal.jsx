import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient'; // ⚡ Linked cloud connection gateway

const TestPortal = ({ testData, onExit }) => {
  // --- 1. DATA PARSING & FALLBACKS ---
  const data = testData || { title: "Standard Mock Test", time: 180, questions: 100, id: 'test_' + Date.now() };
  const hasSections = !!data.sections;
  const isSectionalTimed = data.hasSectionalTiming || false;

  // Flatten questions from sections or fallback to global list / dummy generator
  const questions = React.useMemo(() => {
    if (hasSections) {
      let flatList = [];
      data.sections.forEach((sec, secIdx) => {
        sec.questions.forEach((q, qIdx) => {
          flatList.push({
            ...q,
            sectionIndex: secIdx,
            sectionName: sec.name,
            sectionTime: sec.time
          });
        });
      });
      return flatList;
    }
    return data.questions_list || Array.from({ length: data.questions || 100 }, (_, i) => ({
      id: i,
      type: (i + 1) % 5 === 0 ? 'Subjective' : 'Objective',
      question: (i + 1) % 5 === 0 
        ? `Q${i + 1}: Analyze the impact of the 42nd Constitutional Amendment on the Preamble of India.`
        : `Q${i + 1}: Which of the following constitutional amendments is known as the 'Mini Constitution' of India?`,
      options: ["42nd Amendment", "44th Amendment", "73rd Amendment", "86th Amendment"],
      marks: "+2.0",
      neg: "-0.66",
      sectionIndex: 0,
      sectionName: "General Paper",
      sectionTime: data.time || 180
    }));
  }, [data]);

  // --- 2. CORE PORTAL STATES ---
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState({}); 
  const [uploads, setUploads] = useState({}); 
  const [isPaused, setIsPaused] = useState(false);
  const [markedForReview, setMarkedForReview] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState(null); 
  const fileInputRef = useRef(null);

  // --- TIMING STATES ---
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [globalTimeLeft, setGlobalTimeLeft] = useState(data.rawSeconds || (data.time || 180) * 60);
  const [sectionTimeLeft, setSectionTimeLeft] = useState(() => {
    if (data.sectionTimeLeft !== undefined) return data.sectionTimeLeft;
    if (hasSections && isSectionalTimed) {
      return data.sections[0].time * 60;
    }
    return (data.time || 180) * 60;
  });

  // --- STOPWATCH STATES ---
  const [timeTracker, setTimeTracker] = useState({}); 
  const [qStopwatch, setQStopwatch] = useState(0);    

  // --- 3. PERSISTENCE: RESUME LAYER ---
  useEffect(() => {
    const savedDrafts = JSON.parse(localStorage.getItem('infinity_saved_for_later')) || [];
    const currentDraft = savedDrafts.find(d => d.id === data.id);
    if (currentDraft) {
      setAnswers(currentDraft.answers || {});
      setUploads(currentDraft.uploads || {});
      setGlobalTimeLeft(currentDraft.rawSeconds || globalTimeLeft);
      setSectionTimeLeft(currentDraft.sectionTimeLeft || sectionTimeLeft);
      setCurrentSectionIdx(currentDraft.currentSectionIdx || 0);
      setCurrentQ(currentDraft.lastIndex || 0);
      setTimeTracker(currentDraft.timeTracker || {});
      setMarkedForReview(currentDraft.markedForReview || []);
      console.log("Test Resumed: Structural Data Payload Synced Successfully.");
    }
  }, []);

  // Update current section index based on current active question
  useEffect(() => {
    if (questions[currentQ]) {
      setCurrentSectionIdx(questions[currentQ].sectionIndex);
    }
  }, [currentQ, questions]);

  // --- 4. TIMERS ACTION CONTEXT ---
  useEffect(() => {
    if (globalTimeLeft <= 0) { handleFinalSubmit(); return; }
    if (isPaused) return;
     
    const timer = setInterval(() => {
      setGlobalTimeLeft(prev => prev - 1);
       
      if (isSectionalTimed) {
        setSectionTimeLeft(prevSec => {
          if (prevSec <= 1) {
            handleSectionTimeout();
            return 0;
          }
          return prevSec - 1;
        });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [globalTimeLeft, isPaused, isSectionalTimed, currentSectionIdx]);

  // --- LIVE QUESTION STOPWATCH ---
  useEffect(() => {
    if (isPaused) return;
    setQStopwatch(timeTracker[currentQ] || 0);
    const qTimer = setInterval(() => {
      setQStopwatch(prev => prev + 1);
    }, 1000);
    return () => clearInterval(qTimer);
  }, [currentQ, isPaused]);

  useEffect(() => {
    setTimeTracker(prev => ({ ...prev, [currentQ]: qStopwatch }));
  }, [qStopwatch]);

  // --- TIMEOUT & NAVIGATION HANDLERS ---
  const handleSectionTimeout = () => {
    if (!hasSections) return;
     
    const nextSectionIdx = currentSectionIdx + 1;
    if (nextSectionIdx < data.sections.length) {
      alert(`Time Expired: The countdown for section "${data.sections[currentSectionIdx].name}" has ended. Automatically redirecting to the next section.`);
      const firstQOfNextSec = questions.findIndex(q => q.sectionIndex === nextSectionIdx);
       
      setCurrentSectionIdx(nextSectionIdx);
      setSectionTimeLeft(data.sections[nextSectionIdx].time * 60);
      setCurrentQ(firstQOfNextSec >= 0 ? firstQOfNextSec : currentQ);
    } else {
      alert("Time Expired: Maximum countdown threshold reached for final section. Processing automated submission.");
      handleFinalSubmit();
    }
  };

  const formatTime = (seconds) => {
    if (seconds < 0) seconds = 0;
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs > 0 ? hrs + ':' : ''}${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const isAttempted = (idx) => {
    const ans = answers[idx];
    const up = uploads[idx];
    return (ans !== undefined && ans !== null && ans !== "") || (up && up.length > 0);
  };

  // --- DRAFT SAVE FOR LATER (🎯 SUPABASE REAL-TIME DRAFT DUAL-WRITE) ---
  const handleSaveForLater = async () => {
    const savedDrafts = JSON.parse(localStorage.getItem('infinity_saved_for_later')) || [];
    const draftData = {
      id: data.id,
      title: data.title,
      lastIndex: currentQ,
      currentSectionIdx: currentSectionIdx,
      answers: answers,
      uploads: uploads,
      timeTracker: timeTracker,
      markedForReview: markedForReview,
      timeLeft: Math.floor(globalTimeLeft / 60),
      rawSeconds: globalTimeLeft,
      sectionTimeLeft: sectionTimeLeft,
      date: new Date().toLocaleDateString(),
      time: data.time || 180,
      questions: data.questions,
      questions_list: data.questions_list,
      sections: data.sections,
      hasSectionalTiming: data.hasSectionalTiming,
      mode: data.mode
    };

    const index = savedDrafts.findIndex(d => d.id === draftData.id);
    if (index > -1) savedDrafts[index] = draftData;
    else savedDrafts.push(draftData);
    localStorage.setItem('infinity_saved_for_later', JSON.stringify(savedDrafts));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: existing } = await supabase
          .from('test_sessions')
          .select('id')
          .eq('user_id', user.id)
          .eq('test_id', data.id)
          .eq('status', 'draft')
          .limit(1);

        const cloudPayload = {
          user_id: user.id,
          test_id: data.id,
          title: data.title,
          status: 'draft',
          last_index: currentQ,
          time_left: Math.floor(globalTimeLeft / 60),
          raw_seconds: globalTimeLeft,
          answers: answers,
          uploads: uploads,
          time_tracker: timeTracker
        };

        if (existing && existing.length > 0) {
          await supabase.from('test_sessions').update(cloudPayload).eq('id', existing[0].id);
        } else {
          await supabase.from('test_sessions').insert([cloudPayload]);
        }
      }
    } catch (err) {
      console.error("Cloud draft sync exception:", err);
    }

    alert("Success: Assessment session securely preserved inside Cloud Drafts Vault.");
    onExit(null);
  };

  // --- FINAL SUBMIT (🎯 AUTO-SCORE WITH FIXED ACCURACY INTEGRITY) ---
  const handleFinalSubmit = async () => {
    const attemptedCount = questions.filter((_, i) => isAttempted(i)).length;
    
    // 🎯 LIVE MATH SCORING CALCULATIONS ENGINE
    let calculatedScore = 0;
    let correctCount = 0;
    let incorrectCount = 0;

    questions.forEach((q, i) => {
      if (q.type === 'Objective') {
        const userAnswer = answers[i];
        if (userAnswer !== undefined && userAnswer !== null && userAnswer !== "") {
          if (parseInt(userAnswer) === parseInt(q.correct)) {
            const posMarks = parseFloat(String(q.marks || '2.0').replace('+', '')) || 0;
            calculatedScore += posMarks;
            correctCount++;
          } else {
            const negPenalty = parseFloat(String(q.neg || '0.66').replace('-', '')) || 0;
            calculatedScore -= negPenalty;
            incorrectCount++;
          }
        }
      }
    });

    const totalObjectiveAttempted = correctCount + incorrectCount;
    const finalAccuracyRate = totalObjectiveAttempted > 0 
      ? Math.round((correctCount / totalObjectiveAttempted) * 100) 
      : 0;

    const finalScoreString = calculatedScore.toFixed(2);

    const finalReport = {
      id: data.id,
      attemptId: data.id + "_" + Date.now(),
      title: data.title,
      date: new Date().toLocaleDateString('en-GB'),
      score: finalScoreString, 
      accuracy: `${finalAccuracyRate}%`, 
      timeLeft: globalTimeLeft,
      timeTracker: timeTracker,
      answers: answers,
      uploads: uploads,
      questions: questions,
      status: 'submitted',
      time: data.time || 180 
    };

    const history = JSON.parse(localStorage.getItem('infinity_test_history')) || [];
    history.unshift(finalReport);
    localStorage.setItem('infinity_test_history', JSON.stringify(history));
    
    const drafts = JSON.parse(localStorage.getItem('infinity_saved_for_later')) || [];
    const updatedDrafts = drafts.filter(d => d.id !== data.id);
    localStorage.setItem('infinity_saved_for_later', JSON.stringify(updatedDrafts));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('test_sessions').delete().eq('user_id', user.id).eq('test_id', data.id).eq('status', 'draft');
        
        const { error: insertError } = await supabase.from('test_sessions').insert([
          {
            user_id: user.id,
            test_id: data.id,
            title: data.title,
            status: 'submitted',
            score: finalScoreString, 
            accuracy: finalAccuracyRate, 
            time_left: Math.floor(globalTimeLeft / 60),
            raw_seconds: globalTimeLeft,
            answers: answers,
            uploads: uploads,
            time_tracker: timeTracker
          }
        ]);

        if (insertError) {
          alert(`Supabase Insertion Denied:\nMessage: ${insertError.message}\nDetails: ${insertError.details || 'Check column types.'}`);
          console.error("Supabase technical failure log:", insertError);
        }
      }
    } catch (err) {
      console.error("Cloud compilation history submission failed:", err);
      alert("System Crash Exception: " + err.message);
    }

    onExit(finalReport);
  };

  // --- 🔥 UPDATED: MULTI-FILE ASYNC BASE64 CONVERTER PIPELINE (0 MB EXTRA CLOUD STORAGE) ---
  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    
    files.forEach(file => {
      const reader = new FileReader();
      
      reader.onloadend = () => {
        const base64String = reader.result; // Pure data:image/jpeg;base64 text matrix data
        
        setUploads(prev => ({
          ...prev,
          [currentQ]: [
            ...(prev[currentQ] || []),
            {
              url: base64String, // Perfectly compatible with <img src={file.url} /> preview strip
              name: file.name,
              type: file.type
            }
          ]
        }));
      };
      
      // Fires the reader stream engine to encode text bits
      reader.readAsDataURL(file);
    });

    e.target.value = null; // Flush stream reference immediately
  };

  const handleFileUploadReset = (fIdx) => {
    const up = [...(uploads[currentQ] || [])];
    up.splice(fIdx, 1);
    setUploads({ ...uploads, [currentQ]: up });
  };

  const handlePrevNavigation = () => {
    if (currentQ > 0) {
      if (isSectionalTimed && questions[currentQ - 1].sectionIndex !== currentSectionIdx) {
        alert("Navigation Locked: Sectional timing constraints prevent returning to previously locked assessment configurations.");
        return;
      }
      setCurrentQ(prev => prev - 1);
    }
  };

  const handleNextNavigation = () => {
    if (currentQ < questions.length - 1) {
      if (isSectionalTimed && questions[currentQ + 1].sectionIndex !== currentSectionIdx) {
        alert("Navigation Locked: Please wait for the current section countdown to expire or finalize your submission to proceed.");
        return;
      }
      setCurrentQ(prev => prev + 1);
    } else {
      setShowSummary(true);
    }
  };

  const attemptedCount = questions.filter((_, i) => isAttempted(i)).length;
  const unattemptedCount = questions.length - attemptedCount;
  const reviewCount = markedForReview.length;

  return (
    <div className="portalContainer" style={styles.portalContainer}>
      {/* TOP BAR HEADER */}
      <header style={styles.topBarStyle}>
        <div style={styles.headerLeft}>
          <button onClick={() => { if(window.confirm("Warning: Exit test module? Unsaved operational changes will be discarded.")) onExit(null); }} style={styles.exitBtn}>🚪 Exit</button>
          <div style={styles.testTitle}>
            {data.title} {hasSections && <span style={{fontSize:'0.85rem', background:'#e0e7ff', color:'#4338ca', padding:'3px 8px', borderRadius:'6px', marginLeft:'10px'}}>{questions[currentQ].sectionName}</span>}
          </div>
        </div>
        <div style={styles.headerRight}>
          {isSectionalTimed && (
            <div style={{...styles.timerBox, borderColor: '#ef4444', marginRight: '5px'}}>
               <span style={{...styles.timerLabel, color: '#ef4444'}}>SECTION TIME</span>
               <span style={{fontWeight:'bold', color: '#ef4444'}}>{formatTime(sectionTimeLeft)}</span>
            </div>
          )}
          <div style={styles.timerBox}>
             <span style={styles.timerLabel}>TOTAL REMAINING</span>
             <span>{formatTime(globalTimeLeft)}</span>
          </div>
          <button onClick={() => setIsPaused(true)} style={styles.pauseBtn}>⏸️ Pause</button>
          <button onClick={() => setShowSummary(true)} style={styles.submitBtn}>Submit Test</button>
        </div>
      </header>
       
      <div style={styles.mainLayout}>
        <div style={styles.questionSection}>
          {/* CONTROL CENTER */}
          <div style={styles.controlCenterFrame}>
            <div style={styles.qInfoLine}>
              <div style={styles.qBadge}>Question {currentQ + 1} of {questions.length}</div>
              <div style={styles.marksGroup}>
                <span style={{color:'#22c55e'}}>Weight: {questions[currentQ].marks}</span>
                <span style={{color:'#ef4444'}}>Penalty: {questions[currentQ].neg}</span>
                <span style={{color:'#64748b', background:'#f1f5f9', padding:'2px 8px', borderRadius:'4px'}}>{questions[currentQ].type}</span>
              </div>
            </div>
            <div style={styles.buttonActionLine}>
              <div style={styles.leftActions}>
                <button style={styles.secBtnSmall} onClick={() => { setAnswers({...answers, [currentQ]: null}); setUploads({...uploads, [currentQ]: []}); }}>Clear Response</button>
                <button style={{...styles.secBtnSmall, color: markedForReview.includes(currentQ) ? '#fff' : '#f59e0b', background: markedForReview.includes(currentQ) ? '#f59e0b' : '#fff'}} 
                   onClick={() => markedForReview.includes(currentQ) ? setMarkedForReview(markedForReview.filter(i=>i!==currentQ)) : setMarkedForReview([...markedForReview, currentQ])}>
                  {markedForReview.includes(currentQ) ? 'Unmark Review' : 'Mark for Review'}
                </button>
                <div style={styles.stopwatchBadge}>⏱️ {formatTime(qStopwatch)}</div>
              </div>
              <div style={styles.rightActions}>
                <button style={styles.navBtn} disabled={currentQ === 0} onClick={handlePrevNavigation}>Previous</button>
                <button style={styles.priBtn} onClick={handleNextNavigation}>
                  {currentQ === questions.length - 1 ? "Finish Test 🏁" : "Save & Next"}
                </button>
              </div>
            </div>
          </div>
           
          <div style={styles.qContentScroll}>
            <div style={styles.qInnerFrame}>
              <p style={styles.qText}>{questions[currentQ].question}</p>
              {questions[currentQ].type === 'Objective' ? (
                <div style={styles.optionsGrid}>
                  {questions[currentQ].options.map((opt, idx) => (
                    <div key={idx} style={{...styles.optCard, border: answers[currentQ] === idx ? '2px solid #6366f1' : '1px solid #e2e8f0', background: answers[currentQ] === idx ? '#f5f7ff' : '#fff'} } onClick={() => setAnswers({ ...answers, [currentQ]: idx })}>
                      <span style={{...styles.optLabel, background: answers[currentQ] === idx ? '#6366f1' : '#f1f5f9', color: answers[currentQ] === idx ? '#fff' : '#1e293b'}}>{String.fromCharCode(65 + idx)}</span>
                      {opt}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={styles.subjectiveFrame}>
                  <div style={styles.uploadSectionTop}>
                    <div style={styles.uploadActions}>
                      <div style={{flex: 1}}>
                        <p style={styles.sectionTitle}>Handwritten Attachments (Photo/PDF)</p>
                        <button onClick={() => fileInputRef.current.click()} style={styles.uploadBtn}>Upload Media File</button>
                        <input type="file" ref={fileInputRef} multiple accept="image/*, .pdf" style={{display:'none'}} onChange={handleFileUpload} />
                      </div>
                      <div style={styles.qrContainer}><div style={styles.qrBox}>QR</div><div style={styles.qrText}>Scan to<br/>Upload</div></div>
                    </div>
                    <div style={styles.previewStrip}>
                      {(uploads[currentQ] || []).map((file, fIdx) => (
                        <div key={fIdx} style={styles.thumbWindow} onClick={() => setSelectedPreview(file)}>
                          <button style={styles.delBtn} onClick={(e) => { e.stopPropagation(); handleFileUploadReset(fIdx); }}>❌</button>
                          {file.type.includes('image') ? <img src={file.url} style={styles.thumbImg} alt="Thumbnail"/> : <div style={styles.pdfIcon}>PDF</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                  <textarea style={styles.textArea} placeholder="Type notes or supplementary response lines here..." value={answers[currentQ] || ""} onChange={(e) => setAnswers({ ...answers, [currentQ]: e.target.value })} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* SIDEBAR QUESTION PALETTE */}
        <aside style={styles.paletteSection}>
          <div style={styles.palHeader}>Question Matrix Palette</div>
          <div style={styles.pGridScroll}>
            {questions.map((qObj, i) => {
              const isLocked = isSectionalTimed && qObj.sectionIndex !== currentSectionIdx;
              return (
                <div key={i} 
                   onClick={() => {
                     if (isLocked) {
                       alert("Security Restriction: Sectional timing configurations restrict navigation to the active segment matrix only.");
                       return;
                     }
                     setCurrentQ(i);
                   }}
                   style={{
                     ...styles.pNum, 
                     background: currentQ === i ? '#1e293b' : isLocked ? '#e2e8f0' : isAttempted(i) ? '#22c55e' : markedForReview.includes(i) ? '#f59e0b' : '#fff', 
                     color: isLocked ? '#94a3b8' : (currentQ === i || isAttempted(i) || markedForReview.includes(i)) ? '#fff' : '#64748b', 
                     borderColor: currentQ === i ? '#6366f1' : '#e2e8f0',
                     cursor: isLocked ? 'not-allowed' : 'pointer',
                     opacity: isLocked ? 0.6 : 1
                   }}
                >
                  {i + 1}
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {/* SUMMARY MODAL */}
      {showSummary && (
        <div style={styles.overlay}>
          <div style={styles.modalSummary}>
            <div style={styles.summaryTimerHeader}>Remaining Session Timer: <strong style={{color:'#ef4444'}}>{formatTime(globalTimeLeft)}</strong></div>
            <h2 style={{margin:'20px 0'}}>Assessment Submission Summary</h2>
            <div style={styles.summaryGrid}>
              <div style={styles.sumCard}><span>Total Evaluation Scales</span><strong>{questions.length}</strong></div>
              <div style={styles.sumCard}><span>Completed Indices</span><strong style={{color:'#22c55e'}}>{attemptedCount}</strong></div>
              <div style={styles.sumCard}><span>Unattempted Indices</span><strong style={{color:'#64748b'}}>{unattemptedCount}</strong></div>
              <div style={styles.sumCard}><span>Pending Review</span><strong style={{color:'#f59e0b'}}>{reviewCount}</strong></div>
            </div>
            <div style={{marginTop:'35px', display:'flex', gap:'12px'}}>
              <button onClick={() => setShowSummary(false)} style={{...styles.secBtnSmall, flex:1, height:'48px'}}>Review Questions</button>
              <button onClick={handleFinalSubmit} style={{...styles.priBtn, flex:1.5, fontSize:'1rem'}}>Confirm Final Submission</button>
            </div>
          </div>
        </div>
      )}

      {/* PAUSE MODAL */}
      {isPaused && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h2>Assessment Suspended</h2>
            <p style={{marginBottom:'25px', fontWeight:'600'}}>Would you like to cache this execution session inside Drafts for later retrieval?</p>
            <div style={{display:'flex', flexDirection:'column', gap:'12px'}}>
              <button onClick={handleSaveForLater} style={styles.priBtn}>Yes, Save Snapshot Draft</button>
              <button onClick={() => setIsPaused(false)} style={styles.secBtnSmall}>No, Resume Active Session</button>
            </div>
          </div>
        </div>
      )}

      {/* FILE PREVIEW */}
      {selectedPreview && (
        <div style={styles.fullPreview} onClick={() => setSelectedPreview(null)}>
           <div style={styles.prevContent} onClick={e=>e.stopPropagation()}>
             {selectedPreview.type.includes('image') ? <img src={selectedPreview.url} style={styles.fullImg} /> : <iframe src={selectedPreview.url} style={styles.pdfFrame} />}
             <button style={styles.closeBtn} onClick={() => setSelectedPreview(null)}>Close Window</button>
           </div>
        </div>
      )}
    </div>
  );
};

// --- STYLES MATRIX ---
const styles = { portalContainer: { height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }, topBarStyle: { height:'65px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 25px', flexShrink:0 }, headerLeft: { display:'flex', alignItems:'center', gap:'20px' }, testTitle: { fontWeight:'800', fontSize:'1.1rem', display:'flex', alignItems:'center' }, exitBtn: { background:'none', border:'none', color:'#64748b', fontWeight:'700', cursor:'pointer' }, headerRight: { display:'flex', alignItems:'center', gap:'15px' }, timerBox: { background:'#f8fafc', border:'1px solid #e2e8f0', padding:'5px 15px', borderRadius:'8px', textAlign:'center', minWidth: '120px' }, timerLabel: { fontSize:'0.55rem', color:'#94a3b8', display:'block', fontWeight:'800' }, pauseBtn: { padding:'8px 15px', borderRadius:'8px', border:'1px solid #e2e8f0', background:'#fff', cursor:'pointer', fontWeight:'600' }, submitBtn: { padding:'10px 20px', borderRadius:'8px', background:'#22c55e', color:'#fff', border:'none', cursor: 'pointer', fontWeight:'800' }, controlCenterFrame: { background: '#fcfdfe', borderBottom: '1px solid #e2e8f0', padding: '15px 40px', flexShrink: 0 }, qInfoLine: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, qBadge: { fontWeight:'800', color:'#6366f1', fontSize:'0.9rem' }, marksGroup: { display:'flex', gap:'15px', fontWeight:'800', fontSize:'0.75rem' }, buttonActionLine: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, leftActions: { display: 'flex', gap: '10px', alignItems: 'center' }, stopwatchBadge: { background: '#f0f9ff', color: '#0369a1', padding: '6px 12px', borderRadius: '8px', fontWeight: '800', fontSize: '0.85rem', border: '1px solid #bae6fd' }, rightActions: { display: 'flex', gap: '10px' }, secBtnSmall: { background: '#fff', border: '1px solid #e2e8f0', padding: '8px 15px', borderRadius: '8px', color: '#64748b', fontWeight: '700', cursor: 'pointer', fontSize: '0.8rem' }, navBtn: { background: '#fff', border: '1px solid #6366f1', padding: '8px 20px', borderRadius: '8px', color: '#6366f1', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }, priBtn: { background: '#6366f1', color: '#fff', border: 'none', padding: '10px 25px', borderRadius: '10px', fontWeight: '800', cursor: 'pointer' }, mainLayout: { display:'flex', flex:1, overflow:'hidden' }, questionSection: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }, qContentScroll: { flex: 1, overflowY: 'auto' }, qInnerFrame: { padding:'40px 60px', maxWidth:'900px', margin:'0 auto', width:'100%' }, qText: { fontSize:'1.4rem', lineHeight:'1.6', color:'#1e293b', marginBottom:'35px', fontWeight:'500' }, optionsGrid: { display:'grid', gap:'12px' }, optCard: { padding:'18px', borderRadius:'12px', cursor:'pointer', display:'flex', alignItems:'center', gap:'15px', transition:'0.2s' }, optLabel: { width:'32px', height:'32px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'800', fontSize:'0.85rem' }, subjectiveFrame: { background:'#f8fafc', padding:'25px', borderRadius:'15px', border:'1px solid #e2e8f0', display:'flex', flexDirection:'column', gap:'20px' }, uploadSectionTop: { paddingBottom:'20px', borderBottom:'1px solid #e2e8f0' }, textArea: { width:'100%', height:'250px', border:'none', background:'transparent', outline:'none', fontSize:'1.1rem', resize:'none', padding:'10px' }, uploadActions: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px' }, sectionTitle: { margin:'0 0 10px 0', fontWeight:'700', color:'#475569', fontSize:'0.9rem' }, uploadBtn: { background:'#1e293b', color:'#fff', border:'none', padding:'8px 15px', borderRadius:'8px', cursor:'pointer', fontWeight:'700', fontSize:'0.8rem' }, qrContainer: { display:'flex', alignItems:'center', gap:'10px', borderLeft:'2px solid #e2e8f0', paddingLeft:'15px' }, qrBox: { width:'40px', height:'40px', background:'#fff', border:'1px solid #ccc', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', fontSize:'0.7rem' }, qrText: { fontSize:'0.6rem', color:'#64748b', fontWeight:'700' }, previewStrip: { display:'flex', gap:'10px', overflowX:'auto', padding:'5px 0' }, thumbWindow: { width:'80px', height:'100px', background:'#fff', border:'1px solid #ddd', borderRadius:'6px', position:'relative', overflow:'hidden', flexShrink:0 }, thumbImg: { width:'100%', height:'100%', objectFit:'cover' }, pdfIcon: { height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', fontSize:'0.7rem', color:'#64748b' }, delBtn: { position:'absolute', top:0, right:0, background:'red', color:'#fff', border:'none', width:'20px', height:'20px', cursor:'pointer', fontSize:'10px' }, paletteSection: { width:'280px', background:'#f8fafc', borderLeft:'1px solid #e2e8f0', display:'flex', flexDirection:'column' }, palHeader: { padding:'20px', fontWeight:'800', borderBottom:'1px solid #e2e8f0' }, pGridScroll: { flex:1, padding:'20px', display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'8px', overflowY:'auto' }, pNum: { height:'40px', borderRadius:'8px', border:'1px solid', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'800', fontSize:'0.8rem', transition: 'all 0.2s' }, overlay: { position:'fixed', inset:0, background:'rgba(15, 23, 42, 0.9)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }, modal: { background:'#fff', padding:'40px', borderRadius:'24px', textAlign:'center', width:'380px' }, modalSummary: { background:'#fff', padding:'35px', borderRadius:'24px', width:'520px', textAlign:'center' }, summaryTimerHeader: { background:'#fef2f2', padding:'10px', borderRadius:'10px', fontSize:'1.1rem', fontWeight:'800', marginBottom:'10px', border:'1px solid #fee2e2' }, summaryGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'15px', marginTop:'20px', textAlign:'left' }, sumCard: { padding:'15px', background:'#f8fafc', borderRadius:'12px', display:'flex', flexDirection:'column', gap:'5px', border:'1px solid #e2e8f0' }, fullPreview: { position:'fixed', inset:0, background:'rgba(0,0,0,0.95)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }, prevContent: { position:'relative', maxWidth:'90vw', maxHeight:'90vh' }, fullImg: { maxWidth:'100%', maxHeight:'85vh', borderRadius:'12px', border:'4px solid #fff' }, pdfFrame: { width:'80vw', height:'80vh', background:'#fff' }, closeBtn: { position:'absolute', top:'-50px', right:0, background:'#fff', padding:'8px 20px', borderRadius:'8px', fontWeight:'800', cursor:'pointer', border:'none' } };

export default TestPortal;