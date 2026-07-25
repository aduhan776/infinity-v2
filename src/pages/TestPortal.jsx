import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient'; 
import LatexText from '../components/LatexText';

// --- 🌐 LOCAL STORAGE STORAGE ENGINE MAPPINGS ---
const dbName = "InfinityLocalDB";

const initPortalDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 2); // 🚨 ENGINE VERSION 2
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

const saveToLocalStore = async (storeName, payload) => {
  const db = await initPortalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.put(payload);
    tx.oncomplete = () => resolve();
    tx.onerror = (err) => reject(err);
  });
};

const deleteFromLocalStore = async (storeName, id) => {
  const db = await initPortalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (err) => reject(err);
  });
};

const TestPortal = ({ testData, onExit }) => {
  // --- 1. DATA PARSING & FALLBACKS ---
  const data = testData || { title: "Standard Mock Test", time: 180, questions: 100, id: 'test_' + Date.now() };
  const hasSections = !!data.sections && data.sections.length > 0;
  const isSectionalTimed = data.hasSectionalTiming || false;

  const questions = React.useMemo(() => {
    if (hasSections) {
      let flatList = [];
      data.sections.forEach((sec, secIdx) => {
        if (sec && Array.isArray(sec.questions)) {
          sec.questions.forEach((q) => {
            flatList.push({
              ...q,
              sectionIndex: secIdx,
              sectionName: sec.name,
              sectionTime: sec.time
            });
          });
        }
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
  const [isSubmitting, setIsSubmitting] = useState(false); 
  const [markedForReview, setMarkedForReview] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState(null); 
  const fileInputRef = useRef(null);

  const isSubmittingRef = useRef(false);

  // --- TIMING STATES ---
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [globalTimeLeft, setGlobalTimeLeft] = useState(data.rawSeconds || (data.time || 180) * 60);
  const [sectionTimeLeft, setSectionTimeLeft] = useState(() => {
    if (data.sectionTimeLeft !== undefined && data.sectionTimeLeft !== null) return data.sectionTimeLeft;
    if (hasSections && isSectionalTimed && data.sections[0]) {
      return data.sections[0].time * 60;
    }
    return (data.time || 180) * 60;
  });

  // --- STOPWATCH STATES ---
  const [timeTracker, setTimeTracker] = useState({}); 
  const [qStopwatch, setQStopwatch] = useState(0);    

  const stateRef = useRef({ answers, uploads, globalTimeLeft, sectionTimeLeft, currentSectionIdx, timeTracker, questions, isSubmitting });
  useEffect(() => {
    stateRef.current = { answers, uploads, globalTimeLeft, sectionTimeLeft, currentSectionIdx, timeTracker, questions, isSubmitting };
  }, [answers, uploads, globalTimeLeft, sectionTimeLeft, currentSectionIdx, timeTracker, questions, isSubmitting]);

  // --- 3. PERSISTENCE RESUME SNAPSHOTS ---
  useEffect(() => {
    try {
      const savedDrafts = JSON.parse(localStorage.getItem('infinity_saved_for_later')) || [];
      const currentDraft = savedDrafts.find(d => d.id === data.id);
      // Fallback: if this device's localStorage doesn't have a matching cached
      // draft (e.g. it was auto-cleaned, evicted by the browser, or the
      // original save hit a storage quota limit), fall back to whatever was
      // passed in directly via testData — this is what Library's "Resume
      // Session" button now provides straight from IndexedDB.
      const sourceDraft = currentDraft || (data.status === 'draft' ? data : null);
      if (sourceDraft) {
        setAnswers(sourceDraft.answers || {});
        setUploads(sourceDraft.uploads || {});
        setGlobalTimeLeft(sourceDraft.rawSeconds || globalTimeLeft);
        setSectionTimeLeft(sourceDraft.sectionTimeLeft !== undefined ? sourceDraft.sectionTimeLeft : sectionTimeLeft);
        setCurrentSectionIdx(sourceDraft.currentSectionIdx || 0);
        setCurrentQ(sourceDraft.lastIndex || 0);
        setTimeTracker(sourceDraft.timeTracker || {});
        setMarkedForReview(sourceDraft.markedForReview || []);
      }
    } catch (e) {
      console.error("Failed to parse local draft backup:", e);
    }
  }, []);

  useEffect(() => {
    if (questions[currentQ]) {
      setCurrentSectionIdx(questions[currentQ].sectionIndex);
    }
  }, [currentQ, questions]);

  const formatTime = (seconds) => {
    if (seconds <= 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const isAttempted = (idx) => {
    const ans = answers[idx];
    const up = uploads[idx];
    return (ans !== undefined && ans !== null && ans !== "") || (up && up.length > 0);
  };

  const handleSaveForLater = async () => {
    const snapshot = stateRef.current;
    const nowTimestamp = new Date().getTime();
    const draftData = {
      id: data.id,
      title: data.title,
      status: 'draft',
      lastIndex: currentQ,
      currentSectionIdx: snapshot.currentSectionIdx,
      answers: snapshot.answers,
      // 📎 Uploaded photos are deliberately NOT saved into paused drafts —
      // they're the one heavy thing here, and text answers are what actually
      // matter for resuming. If a subjective upload was pending, the user
      // just re-uploads it on resume (they'll still have the same paper).
      timeTracker: snapshot.timeTracker,
      markedForReview: markedForReview,
      timeLeft: Math.floor(snapshot.globalTimeLeft / 60),
      rawSeconds: snapshot.globalTimeLeft,
      sectionTimeLeft: snapshot.sectionTimeLeft,
      date: new Date().toLocaleDateString(),
      created_at: nowTimestamp, // 🕒 raw timestamp used for 7-day auto-cleanup
      time: data.time || 180,
      questions: data.questions,
      questions_list: data.questions_list,
      sections: data.sections,
      hasSectionalTiming: data.hasSectionalTiming,
      mode: data.mode
    };

    let localStorageSaveFailed = false;

    // Text-only now, so this is tiny and essentially never hits a quota —
    // kept as its own try/catch anyway so it can never block the IndexedDB save.
    try {
      const savedDrafts = JSON.parse(localStorage.getItem('infinity_saved_for_later')) || [];
      const index = savedDrafts.findIndex(d => d.id === draftData.id);
      if (index !== -1) {
        savedDrafts[index] = draftData;
      } else {
        savedDrafts.unshift(draftData);
      }
      localStorage.setItem('infinity_saved_for_later', JSON.stringify(savedDrafts));
    } catch (lsErr) {
      console.error("Local resume-cache save failed:", lsErr);
      localStorageSaveFailed = true;
    }

    try {
      await saveToLocalStore("test_sessions", {
        ...draftData,
        test_id: data.id,
        score: 'Drafted',
        accuracy: 0,
        time_left: draftData.timeLeft,
        raw_seconds: draftData.rawSeconds,
        time_tracker: snapshot.timeTracker
      });

      if (localStorageSaveFailed) {
        alert("Your progress was saved, but there wasn't enough free browser storage to also cache a fast-resume copy. You can still resume it from your Library.");
      } else {
        alert("Active test cached securely inside Drafts! 📂");
      }
      onExit(null);
    } catch (err) {
      console.error("Draft save failed entirely:", err);
      alert("Could not save your progress. Please try again before exiting.");
    }
  };

  const handleSectionTimeout = useCallback(() => {
    if (!hasSections) return;
    const nextSectionIdx = stateRef.current.currentSectionIdx + 1;
    if (nextSectionIdx < data.sections.length) {
      alert(`Section threshold limit reached. Transferring to section: "${data.sections[nextSectionIdx].name}".`);
      const firstQOfNextSec = stateRef.current.questions.findIndex(q => q.sectionIndex === nextSectionIdx);
      setCurrentSectionIdx(nextSectionIdx);
      setSectionTimeLeft(data.sections[nextSectionIdx].time * 60);
      if (firstQOfNextSec >= 0) setCurrentQ(firstQOfNextSec);
    } else {
      handleFinalSubmit();
    }
  }, [data, hasSections]);

  const handleFinalSubmit = useCallback(async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    
    const snapshot = stateRef.current;
    const evaluatedQuestions = [...snapshot.questions];

    // 🎯 Needed to log attempts back to the shared question pool ledger.
    // Non-blocking by design elsewhere below — if this comes back null
    // (session hiccup), ledger logging is simply skipped, test submission
    // itself is never blocked by this.
    let studentId = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      studentId = user ? user.id : null;
    } catch (authErr) {
      console.warn("Could not resolve student id for ledger logging (non-blocking):", authErr);
    }

    const hasSubjectiveToEvaluate = evaluatedQuestions.some((q, i) => 
      q.type === 'Subjective' && (snapshot.answers[i] || (snapshot.uploads[i] && snapshot.uploads[i].length > 0))
    );

    if (hasSubjectiveToEvaluate) {
      setIsSubmitting(true); 
    }
    setShowSummary(false);

    let objectiveCalculatedScore = 0;
    let correctCount = 0;
    let incorrectCount = 0;

    for (let i = 0; i < evaluatedQuestions.length; i++) {
      const q = evaluatedQuestions[i];
      if (q.type === 'Subjective' && (snapshot.answers[i] || (snapshot.uploads[i] && snapshot.uploads[i].length > 0))) {
        try {
          const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/evaluate-subjective`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: q.question,
              userAnswer: snapshot.answers[i] || "",
              uploadedFiles: snapshot.uploads[i] || [],
              testTitle: data.title,
              maxMarks: parseFloat(String(q.marks || '10').replace('+', '')) || 10,
              studentId,
              questionId: q.id
            })
          });

          const resData = await res.json();
          if (resData.success && resData.evaluation) {
            evaluatedQuestions[i] = {
              ...q,
              score_given: parseFloat(resData.evaluation.score_given) || 0,
              ai_evaluation: resData.evaluation.ai_evaluation
            };
          } else {
            throw new Error(resData.error || "Evaluation layer breakdown.");
          }
        } catch (err) {
          setIsSubmitting(false);
          isSubmittingRef.current = false;
          alert("Busy server, failed to submit test responses. Please try again.");
          return; 
        }
      }
    }

    evaluatedQuestions.forEach((q, i) => {
      if (q.type === 'Objective') {
        const userAnswer = snapshot.answers[i];
        if (userAnswer !== undefined && userAnswer !== null && userAnswer !== "") {
          const correctAns = q.correct !== undefined ? q.correct : q.correctOptionIndex;
          if (parseInt(userAnswer) === parseInt(correctAns)) {
            objectiveCalculatedScore += parseFloat(String(q.marks || '2.0').replace('+', '')) || 0;
            correctCount++;
          } else {
            objectiveCalculatedScore -= parseFloat(String(q.neg || '0.66').replace('-', '')) || 0;
            incorrectCount++;
          }

          // 🎯 Fire-and-forget ledger logging — only matters for pool-sourced
          // questions (AI Labs). Admin-made or pre-pool-migration questions
          // will simply get a harmless "not found" from the backend, which
          // we intentionally ignore here so it can never block submission.
          if (studentId && q.id) {
            fetch(`${import.meta.env.VITE_API_BASE_URL}/api/pool/submit-attempt`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                studentId,
                questionId: q.id,
                selectedOptionIndex: parseInt(userAnswer)
              })
            }).catch(err => console.warn("Pool ledger update skipped for a question (non-blocking):", err));
          }
        }
      }
    });

    let finalAggregateScore = objectiveCalculatedScore;
    evaluatedQuestions.forEach(q => {
      if (q.type === 'Subjective' && q.score_given !== undefined) {
        finalAggregateScore += q.score_given;
      }
    });

    const totalObjectiveAttempted = correctCount + incorrectCount;
    const finalAccuracyRate = totalObjectiveAttempted > 0 ? Math.round((correctCount / totalObjectiveAttempted) * 100) : 0;
    const finalScoreString = finalAggregateScore.toFixed(2);

    const optimizedLocalUploads = {};
    Object.keys(snapshot.uploads).forEach(qKey => {
      optimizedLocalUploads[qKey] = (snapshot.uploads[qKey] || []).map(file => ({
        name: file.name,
        type: file.type,
        url: "[Attached & Uploaded via Local Sandbox]" 
      }));
    });

    const uniqueAttemptTimestampId = new Date().getTime();
    const finalReport = {
      id: data.id,
      attemptId: data.id + "_" + uniqueAttemptTimestampId,
      title: data.title,
      date: new Date().toLocaleDateString('en-GB'),
      score: finalScoreString, 
      accuracy: finalAccuracyRate, 
      timeLeft: snapshot.globalTimeLeft,
      timeTracker: snapshot.timeTracker,
      answers: snapshot.answers,
      uploads: optimizedLocalUploads, 
      questions: evaluatedQuestions,
      status: 'submitted',
      time: data.time || 180 
    };

    try {
      await deleteFromLocalStore("test_sessions", data.id); 
      
      await saveToLocalStore("test_sessions", {
        id: finalReport.attemptId, 
        test_id: data.id,
        title: data.title,
        status: 'submitted',
        score: finalScoreString, 
        accuracy: finalAccuracyRate, 
        time_left: Math.floor(snapshot.globalTimeLeft / 60),
        raw_seconds: snapshot.globalTimeLeft,
        answers: snapshot.answers,
        uploads: optimizedLocalUploads, 
        time_tracker: snapshot.timeTracker,
        created_at: uniqueAttemptTimestampId
      });
    } catch (err) {
      console.error("Local sandbox compilation fault:", err);
    }

    try {
      const history = JSON.parse(localStorage.getItem('infinity_test_history')) || [];
      history.unshift(finalReport);
      localStorage.setItem('infinity_test_history', JSON.stringify(history));
      
      const drafts = JSON.parse(localStorage.getItem('infinity_saved_for_later')) || [];
      localStorage.setItem('infinity_saved_for_later', JSON.stringify(drafts.filter(d => d.id !== data.id)));
    } catch (e) {
      console.error(e);
    }

    setIsSubmitting(false);
    onExit(finalReport);
  }, [data, onExit]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (isPaused || stateRef.current.isSubmitting) return;
      
      setGlobalTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleFinalSubmit();
          return 0;
        }
        return prev - 1;
      });

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
  }, [isPaused, isSectionalTimed, handleFinalSubmit, handleSectionTimeout]);

  useEffect(() => {
    if (isPaused || isSubmitting) return;
    setQStopwatch(timeTracker[currentQ] || 0);
    const qTimer = setInterval(() => {
      setQStopwatch(prev => prev + 1);
    }, 1000);
    return () => clearInterval(qTimer);
  }, [currentQ, isPaused, isSubmitting]);

  useEffect(() => {
    if (isSubmitting) return;
    setTimeTracker(prev => ({ ...prev, [currentQ]: qStopwatch }));
  }, [qStopwatch, currentQ, isSubmitting]);

  // 🚨 SAFETY CEILING: absolute max file size accepted before we even try to process it
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
  const IMAGE_MAX_DIMENSION = 1600; // longest side, in px, after compression
  const IMAGE_JPEG_QUALITY = 0.7;

  // Resizes + re-encodes an image on an invisible canvas so heavy phone-camera
  // photos don't bloat local storage or the evaluation payload.
  const compressImageFile = (file) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > IMAGE_MAX_DIMENSION) {
          height = Math.round(height * (IMAGE_MAX_DIMENSION / width));
          width = IMAGE_MAX_DIMENSION;
        } else if (height >= width && height > IMAGE_MAX_DIMENSION) {
          width = Math.round(width * (IMAGE_MAX_DIMENSION / height));
          height = IMAGE_MAX_DIMENSION;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY));
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      };
      img.src = objectUrl;
    });
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);

    files.forEach(async (file) => {
      // Hard ceiling: block anything absurdly large before we even try to process it
      if (file.size > MAX_UPLOAD_BYTES) {
        alert(`"${file.name}" is over 10MB and can't be uploaded. Please choose a smaller file.`);
        return;
      }

      // Images: auto-compress silently in the background, no size complaint shown
      if (file.type.startsWith('image/')) {
        try {
          const compressedDataUrl = await compressImageFile(file);
          setUploads(prev => ({
            ...prev,
            [currentQ]: [...(prev[currentQ] || []), { url: compressedDataUrl, name: file.name, type: 'image/jpeg' }]
          }));
        } catch (err) {
          console.error("Image compression failed:", err);
          alert(`Could not process "${file.name}". Please try a different image.`);
        }
        return;
      }

      // PDFs (or anything else): no client-side compression possible, store as-is
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploads(prev => ({
          ...prev,
          [currentQ]: [...(prev[currentQ] || []), { url: reader.result, name: file.name, type: file.type }]
        }));
      };
      reader.readAsDataURL(file);
    });

    e.target.value = null; 
  };

  const handleFileUploadReset = (fIdx) => {
    const up = [...(uploads[currentQ] || [])];
    up.splice(fIdx, 1);
    setUploads({ ...uploads, [currentQ]: up });
  };

  const handlePrevNavigation = () => {
    if (currentQ > 0) {
      if (isSectionalTimed && questions[currentQ - 1] && questions[currentQ - 1].sectionIndex !== currentSectionIdx) return;
      setCurrentQ(prev => prev - 1);
    }
  };

  // 🚨 FIXED: Increments cleanly forward count structures safely
  const handleNextNavigation = () => {
    if (currentQ < questions.length - 1) {
      if (isSectionalTimed && questions[currentQ + 1] && questions[currentQ + 1].sectionIndex !== currentSectionIdx) return;
      setCurrentQ(prev => prev + 1); 
    } else {
      setShowSummary(true);
    }
  };

  // Which section to visually highlight in the tab row — derived from the
  // actual current question rather than currentSectionIdx, since in
  // free-switching (non-strict) mode the user can move across sections via
  // Previous/Next without going through handleSectionSwitch.
  const activeSectionForDisplay = questions[currentQ] ? questions[currentQ].sectionIndex : currentSectionIdx;

  // Jump directly to a section's first question. Only allowed when the test
  // does NOT have strict sectional timing — strict-timed tests lock this.
  const handleSectionSwitch = (secIdx) => {
    if (isSectionalTimed) return;
    if (secIdx === activeSectionForDisplay) return;
    const firstQOfSec = questions.findIndex(q => q.sectionIndex === secIdx);
    if (firstQOfSec >= 0) {
      setCurrentSectionIdx(secIdx);
      setCurrentQ(firstQOfSec);
    }
  };

  // Lets a user finish a strict-timed section early instead of sitting idle
  // until the section clock runs out. Reuses the exact same transition logic
  // handleSectionTimeout already uses on auto-timeout.
  const handleSubmitSection = () => {
    if (!isSectionalTimed || !hasSections) return;
    const isLastSection = currentSectionIdx >= data.sections.length - 1;
    const confirmMsg = isLastSection
      ? "This is the final section. Submitting now will finish and submit your entire test. Continue?"
      : `Submit "${data.sections[currentSectionIdx].name}" now? You won't be able to return to this section afterwards.`;
    if (window.confirm(confirmMsg)) {
      handleSectionTimeout();
    }
  };

  const attemptedCount = questions.filter((_, i) => isAttempted(i)).length;
  const unattemptedCount = questions.length - attemptedCount;
  const reviewCount = markedForReview.length;

  return (
    <div className="portalContainer" style={styles.portalContainer}>
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      
      {isSubmitting && (
        <div style={styles.submittingOverlay}>
          <div style={styles.spinnerCard}>
            <div style={styles.spinner}></div>
            <h3 style={{ color: '#000000', fontWeight: '900', marginTop: '22px', marginBottom: '8px', fontSize: '1.25rem' }}>Please wait, AI is analyzing your responses...</h3>
            <p style={{ color: '#64748b', fontSize: '0.86rem', fontWeight: '500', margin: 0, lineHeight: '1.5' }}>
              Project Infinity engine is evaluating your handwritten answer sheets and structural metrics compilation patterns.
            </p>
          </div>
        </div>
      )}

      <header style={styles.topBarStyle}>
        <div style={styles.headerLeft}>
          <button onClick={() => { if(window.confirm("Warning: Exit test module? operational changes will be discarded.")) onExit(null); }} style={styles.exitBtn}>🚪 Exit</button>
          <div style={styles.testTitle}>
            {data.title} {hasSections && questions[currentQ] && <span style={{fontSize:'0.85rem', background:'#e0e7ff', color:'#4338ca', padding:'3px 8px', borderRadius:'6px', marginLeft:'10px'}}>{questions[currentQ].sectionName}</span>}
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

      {hasSections && (
        <div style={styles.sectionTabsBar}>
          <div style={styles.sectionTabsScroll}>
            {data.sections.map((sec, secIdx) => {
              const isActive = secIdx === activeSectionForDisplay;
              const isLockedTab = isSectionalTimed && secIdx !== currentSectionIdx;
              return (
                <button
                  key={secIdx}
                  onClick={() => handleSectionSwitch(secIdx)}
                  disabled={isSectionalTimed}
                  title={isSectionalTimed ? "Section switching is locked for this timed test" : `Go to ${sec.name}`}
                  style={{
                    ...styles.sectionTab,
                    ...(isActive ? styles.sectionTabActive : {}),
                    ...(isLockedTab ? styles.sectionTabDisabled : {}),
                    cursor: isSectionalTimed ? 'not-allowed' : 'pointer'
                  }}
                >
                  {sec.name}
                </button>
              );
            })}
          </div>
          {isSectionalTimed && (
            <button onClick={handleSubmitSection} style={styles.submitSectionBtn}>
              {currentSectionIdx >= data.sections.length - 1 ? "Finish Test 🏁" : "Submit Section ✅"}
            </button>
          )}
        </div>
      )}
       
      <div style={styles.mainLayout}>
        <div style={styles.questionSection}>
          <div style={styles.controlCenterFrame}>
            <div style={styles.qInfoLine}>
              <div style={styles.qBadge}>Question {currentQ + 1} of {questions.length}</div>
              {questions[currentQ] && (
                <div style={styles.marksGroup}>
                  <span style={{color:'#22c55e'}}>Weight: {questions[currentQ].marks}</span>
                  <span style={{color:'#ef4444'}}>Penalty: {questions[currentQ].neg}</span>
                  <span style={{color:'#64748b', background:'#f1f5f9', padding:'2px 8px', borderRadius:'4px'}}>{questions[currentQ].type}</span>
                </div>
              )}
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
            {questions[currentQ] ? (
              <div style={styles.qInnerFrame}>
                <p style={styles.qText}><LatexText text={questions[currentQ].question} /></p>
                {questions[currentQ].type === 'Objective' ? (
                  <div style={styles.optionsGrid}>
                    {(questions[currentQ].options || []).map((opt, idx) => (
                      <div key={idx} style={{...styles.optCard, border: answers[currentQ] === idx ? '2px solid #6366f1' : '1px solid #e2e8f0', background: answers[currentQ] === idx ? '#f5f7ff' : '#fff'} } onClick={() => setAnswers({ ...answers, [currentQ]: idx })}>
                        <span style={{...styles.optLabel, background: answers[currentQ] === idx ? '#6366f1' : '#f1f5f9', color: answers[currentQ] === idx ? '#fff' : '#1e293b'}}>{String.fromCharCode(65 + idx)}</span>
                        <LatexText text={opt} />
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
            ) : (
              <div style={{padding: '50px', textAlign: 'center', color: '#64748b', fontSize: '1.1rem', fontWeight: '600'}}>
                Loading active assessment framework stream matrix...
              </div>
            )}
          </div>
        </div>

        <aside style={styles.paletteSection}>
          <div style={styles.palHeader}>Question Matrix Palette</div>
          <div style={styles.pGridScroll}>
            {questions.map((qObj, i) => {
              const isLocked = isSectionalTimed && qObj.sectionIndex !== currentSectionIdx;
              return (
                <div key={i} 
                   onClick={() => {
                     if (isLocked) {
                       alert("Security Restriction: Sectional configurations restrict navigation.");
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

      {isPaused && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h2>Assessment Suspended</h2>
            <p style={{marginBottom:'15px', fontWeight:'600'}}>Would you like to cache this execution session inside Drafts for later retrieval?</p>
            <div style={styles.pauseWarningBox}>
              <p style={styles.pauseWarningLine}>📎 Any uploaded photos won't be saved — you'll need to re-upload them for subjective questions when you resume.</p>
              <p style={styles.pauseWarningLine}>🕒 Paused drafts are automatically deleted after 7 days if not resumed.</p>
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:'12px'}}>
              <button onClick={handleSaveForLater} style={styles.priBtn}>Yes, Save Snapshot Draft</button>
              <button onClick={() => setIsPaused(false)} style={styles.secBtnSmall}>No, Resume Active Session</button>
            </div>
          </div>
        </div>
      )}

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

const styles = { 
  portalContainer: { height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }, 
  topBarStyle: { height:'65px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 25px', flexShrink:0 }, 
  headerLeft: { display:'flex', alignItems:'center', gap:'20px' }, 
  testTitle: { fontWeight:'800', fontSize:'1.1rem', display:'flex', alignItems:'center' }, 
  exitBtn: { background:'none', border:'none', color:'#64748b', fontWeight:'700', cursor:'pointer' }, 
  headerRight: { display:'flex', alignItems:'center', gap:'15px' }, 
  timerBox: { background:'#f8fafc', border:'1px solid #e2e8f0', padding:'5px 15px', borderRadius:'8px', textAlign:'center', minWidth: '120px' }, 
  timerLabel: { fontSize:'0.55rem', color:'#94a3b8', display:'block', fontWeight:'800' }, 
  pauseBtn: { padding:'8px 15px', borderRadius:'8px', border:'1px solid #e2e8f0', background:'#fff', cursor:'pointer', fontWeight:'600' }, 
  submitBtn: { padding:'10px 20px', borderRadius:'8px', background:'#22c55e', color:'#fff', border:'none', cursor: 'pointer', fontWeight:'800' }, 
  controlCenterFrame: { background: '#fcfdfe', borderBottom: '1px solid #e2e8f0', padding: '15px 40px', flexShrink: 0 }, 
  qInfoLine: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, 
  qBadge: { fontWeight:'800', color:'#6366f1', fontSize:'0.9rem' }, 
  marksGroup: { display:'flex', gap:'15px', fontWeight:'800', fontSize:'0.75rem' }, 
  buttonActionLine: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, 
  leftActions: { display: 'flex', gap: '10px', alignItems: 'center' }, 
  stopwatchBadge: { background: '#f0f9ff', color: '#0369a1', padding: '6px 12px', borderRadius: '8px', fontWeight: '800', fontSize: '0.85rem', border: '1px solid #bae6fd' }, 
  rightActions: { display: 'flex', gap: '10px' }, 
  secBtnSmall: { background: '#fff', border: '1px solid #e2e8f0', padding: '8px 15px', borderRadius: '8px', color: '#64748b', fontWeight: '700', cursor: 'pointer', fontSize: '0.8rem' }, 
  navBtn: { background: '#fff', border: '1px solid #6366f1', padding: '8px 20px', borderRadius: '8px', color: '#6366f1', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }, 
  priBtn: { background: '#6366f1', color: '#fff', border: 'none', padding: '10px 25px', borderRadius: '10px', fontWeight: '800', cursor: 'pointer' }, 
  mainLayout: { display:'flex', flex:1, overflow:'hidden' }, 
  sectionTabsBar: { display:'flex', alignItems:'center', justifyContent:'space-between', gap:'15px', padding:'10px 25px', borderBottom:'1px solid #e2e8f0', background:'#f8fafc', flexShrink:0 }, 
  sectionTabsScroll: { display:'flex', alignItems:'center', gap:'8px', overflowX:'auto' }, 
  sectionTab: { padding:'7px 16px', borderRadius:'8px', border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontWeight:'700', fontSize:'0.82rem', whiteSpace:'nowrap', flexShrink:0 }, 
  sectionTabActive: { background:'#000000', color:'#ffffff', border:'1px solid #000000' }, 
  sectionTabDisabled: { opacity:0.45 }, 
  submitSectionBtn: { padding:'8px 16px', borderRadius:'8px', border:'none', background:'#16a34a', color:'#fff', fontWeight:'800', fontSize:'0.82rem', whiteSpace:'nowrap', flexShrink:0, cursor:'pointer' }, 
  pauseWarningBox: { background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'10px', padding:'12px 14px', marginBottom:'22px', textAlign:'left' }, 
  pauseWarningLine: { fontSize:'0.82rem', color:'#92400e', fontWeight:'600', margin:'4px 0', lineHeight:'1.4' }, 
  questionSection: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }, 
  qContentScroll: { flex: 1, overflowY: 'auto' }, 
  qInnerFrame: { padding:'40px 60px', maxWidth:'900px', margin:'0 auto', width:'100%' }, 
  qText: { fontSize:'1.4rem', lineHeight:'1.6', color:'#1e293b', marginBottom:'35px', fontWeight:'500' }, 
  optionsGrid: { display:'grid', gap:'12px' }, 
  optCard: { padding:'18px', borderRadius:'12px', cursor:'pointer', display:'flex', alignItems:'center', gap:'15px', transition:'0.2s' }, 
  optLabel: { width:'32px', height:'32px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'800', fontSize:'0.85rem' }, 
  subjectiveFrame: { background:'#f8fafc', padding:'25px', borderRadius:'15px', border:'1px solid #e2e8f0', display:'flex', flexDirection:'column', gap:'20px' }, 
  uploadSectionTop: { paddingBottom:'20px', borderBottom:'1px solid #e2e8f0' }, 
  textArea: { width:'100%', height:'250px', border:'none', background:'transparent', outline:'none', fontSize:'1.1rem', resize:'none', padding:'10px' }, 
  uploadActions: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px' }, 
  sectionTitle: { margin:'0 0 10px 0', fontWeight:'700', color:'#475569', fontSize:'0.9rem' }, 
  uploadBtn: { background:'#1e293b', color:'#fff', border:'none', padding:'8px 15px', borderRadius:'8px', cursor:'pointer', fontWeight:'700', fontSize:'0.8rem' }, 
  qrContainer: { display:'flex', alignItems:'center', gap:'10px', borderLeft:'2px solid #e2e8f0', paddingLeft:'15px' }, 
  qrBox: { width:'40px', height:'40px', background:'#fff', border:'1px solid #ccc', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', fontSize:'0.7rem' }, 
  qrText: { fontSize:'0.6rem', color:'#64748b', fontWeight:'700' }, 
  previewStrip: { display:'flex', gap:'10px', overflowX:'auto', padding:'5px 0' }, 
  thumbWindow: { width:'80px', height:'100px', background:'#fff', border:'1px solid #ddd', borderRadius:'6px', position:'relative', overflow:'hidden', flexShrink:0 }, 
  thumbImg: { width:'100%', height:'100%', objectFit:'cover' }, 
  pdfIcon: { height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', fontSize:'0.7rem', color:'#64748b' }, 
  delBtn: { position:'absolute', top:0, right:0, background:'red', color:'#fff', border:'none', width:'20px', height:'20px', cursor:'pointer', fontSize:'10px' }, 
  paletteSection: { width:'280px', background:'#f8fafc', borderLeft:'1px solid #e2e8f0', display:'flex', flexDirection:'column' }, 
  palHeader: { padding:'20px', fontWeight:'800', borderBottom:'1px solid #e2e8f0' }, 
  pGridScroll: { flex:1, padding:'20px', display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'8px', overflowY:'auto' }, 
  pNum: { height:'40px', borderRadius:'8px', border:'1px solid', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'800', fontSize:'0.8rem', transition: 'all 0.2s' }, 
  overlay: { position:'fixed', inset:0, background:'rgba(15, 23, 42, 0.9)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }, 
  modal: { background:'#fff', padding:'40px', borderRadius:'24px', textAlign:'center', width:'380px' }, 
  modalSummary: { background:'#fff', padding:'35px', borderRadius:'24px', width:'520px', textAlign:'center' }, 
  summaryTimerHeader: { background:'#fef2f2', padding:'10px', borderRadius:'10px', fontSize:'1.1rem', fontWeight:'800', marginBottom:'10px', border:'1px solid #fee2e2' }, 
  summaryGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'15px', marginTop:'20px', textAlign:'left' }, 
  sumCard: { padding:'15px', background:'#f8fafc', borderRadius:'12px', display:'flex', flexDirection:'column', gap:'5px', border:'1px solid #e2e8f0' }, 
  fullPreview: { position:'fixed', inset:0, background:'rgba(0,0,0,0.95)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }, 
  prevContent: { position:'relative', maxWidth:'90vw', maxHeight:'90vh' }, 
  fullImg: { maxWidth:'100%', maxHeight:'85vh', borderRadius:'12px', border:'4px solid #fff' }, 
  pdfFrame: { width:'80vw', height:'80vh', background:'#fff' }, 
  closeBtn: { position:'absolute', top:'-50px', right:0, background:'#fff', padding:'8px 20px', borderRadius:'8px', fontWeight:'800', cursor:'pointer', border:'none' },
  submittingOverlay: { position: 'fixed', inset: 0, background: 'rgba(255, 255, 255, 0.75)', backdropFilter: 'blur(10px)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinnerCard: { background: '#ffffff', padding: '40px', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 20px 40px rgba(0,0,0,0.06)', width: '90%', maxWidth: '460px', textAlign: 'center' },
  spinner: { width: '50px', height: '50px', border: '5px solid #f1f5f9', borderTop: '5px solid #6366f1', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }
};

export default TestPortal;