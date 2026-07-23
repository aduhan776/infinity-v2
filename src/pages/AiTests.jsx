import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient'; 
import LatexText from '../components/LatexText'; 

// --- 🌐 INLINE BULLETPROOF INDEXEDDB STORAGE SYSTEM INITIALIZER ---
const dbName = "InfinityLocalDB";

const initAiTestsDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 3); // ENGINE VERSION 3 FOR LOCAL EXAM BLUEPRINTS
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("test_sessions")) {
        db.createObjectStore("test_sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("saved_questions")) {
        db.createObjectStore("saved_questions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("ai_mock_tests")) {
        db.createObjectStore("ai_mock_tests", { keyPath: "id" });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

const saveAiTestToLocalStore = async (payload) => {
  const db = await initAiTestsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("ai_mock_tests", "readwrite");
    const store = tx.objectStore("ai_mock_tests");
    store.put(payload);
    tx.oncomplete = () => resolve();
    tx.onerror = (err) => reject(tx.error);
  });
};

const AiTests = ({ onStartTest }) => {
  const [view, setView] = useState('selection'); // selection, config-full, config-topic, ai-summary, admin-preview, admin-push-cloud
  const [aiTestDetails, setAiTestDetails] = useState(null);
  const [loading, setLoading] = useState(false); 
  const [loadingMessage, setLoadingMessage] = useState(''); 
  const [cooldown, setCooldown] = useState(0); 

  // 🚨 SYNCHRONOUS MUTEX LOCK REF TO CUT-OFF MULTI-TAP CLICK FLOODS
  const processingRef = useRef(false);

  // --- INTERNAL ADMIN CONTROLS STATE (ZERO APP.JSX DEPENDENCY) ---
  const [isAdmin, setIsAdmin] = useState(false);
  const [cloudMockTestsPool, setCloudMockTestsPool] = useState([]);
  const [renamedTitle, setRenamedTitle] = useState('');
  const [selectedMoveCategory, setSelectedMoveCategory] = useState('');
  const [selectedMoveSeries, setSelectedMoveSeries] = useState('');
  const [selectedMoveSection, setSelectedMoveSection] = useState('');

  // --- COMMON METADATA STATES ---
  const [testTitle, setTestTitle] = useState('');
  const [targetExam, setTargetExam] = useState('');
  const [topicSubjectSection, setTopicSubjectSection] = useState('');
  const [topicName, setTopicName] = useState('');
  const [globalTime, setGlobalTime] = useState('');

  // --- DIFFICULTY & LANGUAGE GLOBAL STATES ---
  const [fullDifficulty, setFullDifficulty] = useState('Medium'); 
  const [fullLanguage, setFullLanguage] = useState('English'); 
  const [topicDifficulty, setTopicDifficulty] = useState('Medium'); 
  const [topicLanguage, setTopicLanguage] = useState('English'); 

  // --- SWITCH TO ENABLE/DISABLE SECTIONS INSIDE FULL TEST MODE ---
  const [fullHasSections, setFullHasSections] = useState(false); 

  // --- FULL TEST FLOW: FLAT SINGLE PAPER CONFIG STATES ---
  const [fullQCount, setFullQCount] = useState('');
  const [fullDuration, setFullDuration] = useState('');
  const [fullType, setFullType] = useState('Objective');
  const [fullMarks, setFullMarks] = useState('2.0');
  const [fullNeg, setFullNeg] = useState('0.66');

  // --- FULL TEST FLOW: MULTI-SECTIONS ACCUMULATOR ---
  const [aiSections, setAiSections] = useState([]); 
  const [editingSecIdx, setEditingSecIdx] = useState(null); 
  const [secName, setSecName] = useState('');
  const [secTime, setSecTime] = useState('');
  const [secQCount, setSecQCount] = useState('');
  const [secMarks, setSecMarks] = useState('2.0');
  const [secNeg, setSecNeg] = useState('0.66');
  const [secType, setSecType] = useState('Objective');
  const [secDifficulty, setSecDifficulty] = useState('Medium');
  const [secLanguage, setSecLanguage] = useState('English');
  const [hasSectionalTiming, setHasSectionalTiming] = useState(true);

  // --- TOPIC TEST FLOW: DIRECT CONFIG STATES ---
  const [topicQCount, setTopicQCount] = useState('');
  const [topicMarks, setTopicMarks] = useState('2.0');
  const [topicNeg, setTopicNeg] = useState('0.66');
  const [topicType, setTopicType] = useState('Objective');

  // 🚨 FIXED: DYNAMIC CLOUD MATRIX DROPDOWNS (MOVED TO THE TOP FOR GUARANTEED RENDER SCOPE)
  const categoriesList = Array.from(new Set((cloudMockTestsPool || []).map(t => t.category_name))).filter(name => name && name !== 'AI Lab Generated');
  const seriesList = selectedMoveCategory ? Array.from(new Set((cloudMockTestsPool || []).filter(t => t.category_name === selectedMoveCategory && t.series_name).map(t => t.series_name))) : [];
  const subSectionsList = (selectedMoveCategory && selectedMoveSeries) ? Array.from(new Set((cloudMockTestsPool || []).filter(t => t.category_name === selectedMoveCategory && t.series_name === selectedMoveSeries && t.sub_section).map(t => t.sub_section))) : [];

  // --- SILENT INTERNAL ADMIN VERIFIER ---
  useEffect(() => {
    const silentAdminCheck = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          if (user.email === 'aduhan776@gmail.com') {
            setIsAdmin(true);
          } else {
            const { data: profile } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', user.id)
              .single();
            if (profile && (profile.role === 'admin' || profile.role === 'superuser')) {
              setIsAdmin(true);
            }
          }
        }
      } catch (err) {
        console.error("Admin verification log:", err);
      }
    };
    silentAdminCheck();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const intervalInstance = setInterval(() => {
      setCooldown(prev => prev - 1);
    }, 1000);
    return () => clearInterval(intervalInstance);
  }, [cooldown]);

  // Hardened cloud database tree reader with active profile session parameters
  const fetchCloudDatabaseTree = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('mock_tests')
        .select('id, category_name, series_name, sub_section')
        .order('created_at', { ascending: false });
        
      if (!error && data) {
        setCloudMockTestsPool(data);
      } else if (error) {
        console.error("Supabase branch query breakdown:", error.message);
      }
    } catch (err) {
      console.error("Failed to sync matrix paths:", err);
    }
  };

  // ======================================================================
  // ⚡ HARDENED BATCHING ENGINE WITH DYNAMIC PARSER EXTRACTIONS
  // ======================================================================
  const fetchInBatches = async (exam, topic, targetCount, type, difficulty, language, marks, neg, subject = '') => {
    let remaining = targetCount;
    let masterQuestionsArray = [];
    
    while (remaining > 0) {
      const currentBatchSize = Math.min(15, remaining); 
      const startIndex = masterQuestionsArray.length + 1;
      const endIndex = startIndex + currentBatchSize - 1;
      
      setLoadingMessage(`Generating Questions ${startIndex} to ${endIndex}... Please wait`);
      
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/generate-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          exam,
          subject,
          topic,
          count: currentBatchSize,
          type, 
          difficulty,
          language
        })
      });

      const rawText = await response.text();
      let data;

      try {
        const cleanPayload = rawText.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\");
        data = JSON.parse(cleanPayload);
      } catch (e) {
        try {
          const isolatedObjectString = rawText.substring(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);
          const dynamicExtractor = new Function(`return ${isolatedObjectString}`);
          data = dynamicExtractor();
        } catch (innerError) {
          console.log("🚨 --- INFINITY CRIME SCENE INSPECTION --- 🚨");
          console.log("Raw Response Dump:", rawText);
          throw new Error(`Data format corrupted. Backend response can't be parsed.`);
        }
      }
      
      if (!data || !data.success) throw new Error((data && data.error) || `Batch stream failed at query slot index: ${startIndex}`);
      if (!data.questions || !Array.isArray(data.questions)) {
        throw new Error("Backend response mismatch: 'questions' data array package is missing.");
      }

      const processedBatch = data.questions.map((q, i) => {
        const structuralIndex = masterQuestionsArray.length + i;
        if (type === 'Objective') {
          return {
            id: structuralIndex,
            type: 'Objective',
            question: q.question,
            options: q.options || ["Option A", "Option B", "Option C", "Option D"],
            correct: q.correctOptionIndex !== undefined ? q.correctOptionIndex : 0,
            marks: `+${parseFloat(marks || 2.0).toFixed(1)}`,
            neg: `-${parseFloat(neg || 0.66).toFixed(2)}`,
            explanation: q.explanation || "Resolution matrix computed."
          };
        } else {
          return {
            id: structuralIndex,
            type: 'Subjective',
            question: q.question,
            marks: `+${parseFloat(marks || 10.0).toFixed(1)}`,
            neg: "0",
            explanation: q.explanation || "Model marking structure synced."
          };
        }
      });
      masterQuestionsArray = [...masterQuestionsArray, ...processedBatch];
      remaining -= currentBatchSize;
    }
    
    return masterQuestionsArray;
  };

  const handleGenerateFullTest = async () => {
    if (processingRef.current) return;
    if (!testTitle.trim()) { alert("Please enter a test title to continue."); return; }
    if (cooldown > 0) { alert(`Server cooldown active. Please wait ${cooldown} seconds.`); return; }
    
    processingRef.current = true; 
    setLoading(true);
    setLoadingMessage("Initializing Project Infinity Mock Pipeline...");
    
    try {
      const generatedTestId = "AI-FULL-" + Date.now();
      let finalStructure = {
        id: generatedTestId,
        title: `AI Full Mock: ${testTitle} [${fullDifficulty}]`,
      };

      if (fullHasSections) {
        if (aiSections.length === 0) { alert("Please add at least one section to build the test blueprint."); setLoading(false); processingRef.current = false; return; }
        
        const totalQuestions = aiSections.reduce((acc, s) => acc + parseInt(s.qCount), 0);
        const totalDuration = aiSections.reduce((acc, s) => acc + parseInt(s.time), 0);
        const compiledSections = [];

        for (const sec of aiSections) {
          const sectionalQuestions = await fetchInBatches(
            testTitle, 
            sec.name, 
            parseInt(sec.qCount), 
            sec.type, 
            sec.difficulty, 
            sec.language, 
            sec.marks, 
            sec.neg
          );
          compiledSections.push({
            name: sec.name,
            time: parseInt(sec.time),
            language: sec.language,
            questions: sectionalQuestions
          });
        }

        finalStructure.time = totalDuration;
        finalStructure.questions = totalQuestions;
        finalStructure.hasSectionalTiming = hasSectionalTiming;
        finalStructure.sections = compiledSections;
        finalStructure.mode = `Mixed / Sectional (${fullDifficulty})`;

        await saveAiTestToLocalStore({
          id: generatedTestId,
          category_name: 'AI Lab Generated',
          title: finalStructure.title,
          questions: totalQuestions,
          time: totalDuration,
          sections: compiledSections,
          has_sectional_timing: hasSectionalTiming,
          created_at: new Date().getTime()
        });

      } else {
        if (!fullQCount || !fullDuration) { alert("Please enter the question count and duration."); setLoading(false); processingRef.current = false; return; }
        
        const targetQCount = parseInt(fullQCount);
        const targetDuration = parseInt(fullDuration);

        if (!Number.isFinite(targetQCount) || targetQCount <= 0) {
          alert("Question count must be a positive number greater than 0.");
          setLoading(false); processingRef.current = false; return;
        }
        if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
          alert("Duration must be a positive number greater than 0.");
          setLoading(false); processingRef.current = false; return;
        }
        if (targetQCount > 100) { alert("Maximum limit is 100 questions for a single paper flat configuration."); setLoading(false); processingRef.current = false; return; }
        
        const flatPaperQuestionsList = await fetchInBatches(
          testTitle,
          testTitle,
          targetQCount,
          fullType,
          fullDifficulty,
          fullLanguage,
          fullMarks,
          fullNeg
        );

        finalStructure.time = parseInt(fullDuration);
        finalStructure.questions = flatPaperQuestionsList.length;
        finalStructure.hasSectionalTiming = false;
        finalStructure.questions_list = flatPaperQuestionsList;
        finalStructure.mode = `${fullType} (${fullDifficulty}) - ${fullLanguage}`;

        await saveAiTestToLocalStore({
          id: generatedTestId,
          category_name: 'AI Lab Generated',
          title: finalStructure.title,
          questions: flatPaperQuestionsList.length,
          time: parseInt(fullDuration),
          questions_list: flatPaperQuestionsList,
          has_sectional_timing: false,
          created_at: new Date().getTime()
        });
      }

      setAiTestDetails(finalStructure);
      setView('ai-summary');
    } catch (error) {
      console.error("Full Test Compilation Error:", error);
      alert(`Full Test Compilation Error:\n${error.message}`);
      setCooldown(15);
    } finally {
      setLoading(false);
      setLoadingMessage('');
      processingRef.current = false; 
    }
  };

  const handleGenerateTopicTest = async () => {
    if (processingRef.current) return;
    if (!targetExam.trim()) { alert("Target exam name is mandatory."); return; }
    if (!topicSubjectSection.trim()) { alert("Subject / Section is mandatory."); return; }
    if (!topicQCount || !globalTime) { alert("Please enter the question count and duration."); return; }
    
    const targetQCount = parseInt(topicQCount);
    const targetDuration = parseInt(globalTime);

    if (!Number.isFinite(targetQCount) || targetQCount <= 0) {
      alert("Question count must be a positive number greater than 0.");
      return;
    }
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
      alert("Duration must be a positive number greater than 0.");
      return;
    }
    if (cooldown > 0) { alert(`Server cooldown active. Please wait ${cooldown} seconds.`); return; }
    
    if (targetQCount > 100) {
      alert("Maximum limit is 100 questions for topic drill modes execution.");
      return;
    }
    
    processingRef.current = true;
    setLoading(true);
    setLoadingMessage("Assembling Drill Tracks Layout...");

    try {
      const topicQuestionsList = await fetchInBatches(
        targetExam,
        topicName,
        targetQCount,
        topicType,
        topicDifficulty,
        topicLanguage,
        topicMarks,
        topicNeg,
        topicSubjectSection
      );

      const generatedTestId = "AI-TOPIC-" + Date.now();
      const displayTopicLabel = topicName.trim() ? `${topicSubjectSection}: ${topicName}` : topicSubjectSection;
      const topicStructure = {
        id: generatedTestId,
        title: `AI Drill: ${displayTopicLabel} (${targetExam})`,
        time: targetDuration,
        questions: topicQuestionsList.length,
        hasSectionalTiming: false,
        questions_list: topicQuestionsList,
        mode: `${topicType} - ${topicDifficulty} (${topicLanguage})`
      };

      await saveAiTestToLocalStore({
        id: generatedTestId,
        category_name: 'AI Lab Generated',
        title: topicStructure.title,
        questions: topicQuestionsList.length,
        time: targetDuration,
        questions_list: topicQuestionsList,
        has_sectional_timing: false,
        created_at: new Date().getTime()
      });

      setAiTestDetails(topicStructure);
      setView('ai-summary');
    } catch (error) {
      console.error("AI Generation Error:", error);
      alert(`AI Topic Test Generation Error:\n${error.message}`);
      setCooldown(15);
    } finally {
      setLoading(false);
      setLoadingMessage('');
      processingRef.current = false; 
    }
  };

  const handleAddSectionToBlueprint = () => {
    if (!secName.trim() || !secTime || !secQCount) {
      alert("Please fill out section name, duration, and question count.");
      return;
    }
    const parsedSecTime = parseInt(secTime);
    const parsedSecQCount = parseInt(secQCount);
    if (!Number.isFinite(parsedSecTime) || parsedSecTime <= 0) {
      alert("Duration must be a positive number greater than 0.");
      return;
    }
    if (!Number.isFinite(parsedSecQCount) || parsedSecQCount <= 0) {
      alert("Question count must be a positive number greater than 0.");
      return;
    }
    if (editingSecIdx === null && aiSections.length >= 5) {
      alert("Maximum limit is 5 sections per test blueprint.");
      return;
    }
    if (parsedSecQCount > 50) {
      alert("Maximum limit is 50 questions per individual section bundle.");
      return;
    }

    const newSecObj = {
      name: secName.trim(),
      time: secTime,
      qCount: secQCount,
      marks: secMarks,
      neg: secType === 'Subjective' ? '0' : secNeg,
      type: secType,
      difficulty: secDifficulty,
      language: secLanguage
    };

    if (editingSecIdx !== null) {
      const updated = [...aiSections];
      updated[editingSecIdx] = newSecObj;
      setAiSections(updated);
      setEditingSecIdx(null);
    } else {
      setAiSections([...aiSections, newSecObj]);
    }

    setSecName('');
    setSecTime('');
    setSecQCount('');
  };

  const handlePublishToOfficialCloud = async () => {
    if (!renamedTitle.trim() || !selectedMoveCategory || !selectedMoveSeries || !selectedMoveSection) {
      alert("Bhai, Category, Series branch, aur Section tab paths specified hone mandatory hain!");
      return;
    }
           
    const cloudTestId = 'MOCK_MOVED_' + Date.now();
    setLoading(true);
    setLoadingMessage("Transmitting configuration packet onto the cloud schema...");
    try {
      const { error } = await supabase
        .from('mock_tests')
        .insert([
          {
            id: cloudTestId,
            category_name: selectedMoveCategory,
            series_name: selectedMoveSeries,
            sub_section: selectedMoveSection,
            title: renamedTitle.trim(),
            questions: parseInt(aiTestDetails.questions),
            time: parseInt(aiTestDetails.time),
            sections: aiTestDetails.sections || null, 
            questions_list: aiTestDetails.questions_list || null, 
            has_sectional_timing: aiTestDetails.hasSectionalTiming || false
          }
        ]);
      if (error) throw error;
      alert(`Success: Test "${renamedTitle.trim()}" is now live inside the official path layout matrix!`);
      setView('selection');
    } catch (err) {
      console.error("Cloud push failed:", err);
      alert("Database Matrix failure while uploading current configurations packet data.");
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* 🚨 UNBREAKABLE INTERCEPTOR OVERLAY: Screen freeze logic locked at the global root window layer */}
      {loading && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(8px)',
          zIndex: 999999,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontFamily: 'Inter, sans-serif'
        }}>
          <div style={{ background: '#fff', padding: '40px', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 20px 40px rgba(0,0,0,0.06)', width: '90%', maxWidth: '460px', textAlign: 'center' }}>
            <div style={{ width: '50px', height: '50px', border: '5px solid #f1f5f9', borderTop: '5px solid #000000', borderRadius: '50%', margin: '0 auto 20px auto', animation: 'spin 1s linear infinite' }}></div>
            <h3 style={{ color: '#000000', fontWeight: '900', fontSize: '1.4rem', margin: 0 }}>Project Infinity AI Lab</h3>
            <p style={{ color: '#64748b', fontSize: '0.92rem', marginTop: '12px', lineHeight: '1.6', fontWeight: '600' }}>
              {loadingMessage || "Assembling questions datasets layers..."}
            </p>
          </div>
        </div>
      )}

      {view === 'selection' && (
        <>
          <header style={{ textAlign: 'center', marginBottom: '50px' }}>
            <h1 style={{ fontSize: '2.6rem', fontWeight: '900', color: '#0f172a', margin: 0, letterSpacing: '-0.8px' }}>AI Test Lab</h1>
            <p style={{ color: '#64748b', marginTop: '8px', fontSize: '1rem', fontWeight: '500' }}>Choose how you want to practice and prepare with AI</p>
          </header>
                   
          <div style={selectionGrid}>
            <div style={fullMockCardStyle} onClick={() => { setView('config-full'); setAiSections([]); setFullHasSections(false); setEditingSecIdx(null); }}>
              <div style={cardHeaderRow}>
                <div style={indigoIconFrame}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                </div>
                <span style={indigoBadge}>Syllabus-wide</span>
              </div>
              <h3 style={leftCardTitle}>Full Mock Test</h3>
              <ul style={cleanBulletList}>
                <li style={bulletItemRow}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="3" style={{ marginTop: '2px', flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Complete exam syllabus coverage</span>
                </li>
                <li style={bulletItemRow}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="3" style={{ marginTop: '2px', flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Real exam interface and timer</span>
                </li>
                <li style={bulletItemRow}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="3" style={{ marginTop: '2px', flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Section-wise practice available</span>
                </li>
              </ul>
              <button style={indigoActionBtn}>Start Full Test</button>
            </div>
            <div style={topicMockCardStyle} onClick={() => setView('config-topic')}>
              <div style={cardHeaderRow}>
                <div style={emeraldIconFrame}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="6"></circle>
                    <circle cx="12" cy="12" r="2"></circle>
                  </svg>
                </div>
                <span style={emeraldBadge}>Targeted Drills</span>
              </div>
              <h3 style={leftCardTitle}>Topic Wise Test</h3>
              <ul style={cleanBulletList}>
                <li style={bulletItemRow}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" style={{ marginTop: '2px', flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Practice specific weak topics</span>
                </li>
                <li style={bulletItemRow}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" style={{ marginTop: '2px', flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Set custom question limits</span>
                </li>
                <li style={bulletItemRow}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" style={{ marginTop: '2px', flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Instant step-by-step solutions</span>
                </li>
              </ul>
              <button style={emeraldActionBtn}>Start Topic Test</button>
            </div>
          </div>
        </>
      )}

      {view === 'config-full' && (
        <div style={formWrapper}>
          <div style={formCard}>
            <h2 style={{ color: '#000000', marginBottom: '5px', fontWeight: '900' }}>Full Scale Exam Blueprint</h2>
            <p style={{ color: '#64748b', marginBottom: '25px', fontSize: '0.9rem', fontWeight: '500' }}>Configure structure evaluation parameters and let AI model the questions.</p>
                       
            <div style={flexRow}>
              <div style={{ flex: 1.5 }}>
                <label style={labelStyle}>Exam / Paper Reference Title</label>
                <input style={inputStyle} placeholder="e.g. UPSC Prelims Mock" value={testTitle} onChange={e => setTestTitle(e.target.value)} />
              </div>
              <div style={{ flex: 0.8 }}>
                <label style={labelStyle}>Difficulty Level</label>
                <select style={{ ...inputStyle, padding: '11px' }} value={fullDifficulty} onChange={e => setFullDifficulty(e.target.value)}>
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Tough">Tough</option>
                </select>
              </div>
              {!fullHasSections && (
                <div style={{ flex: 0.8 }}>
                  <label style={labelStyle}>Paper Language</label>
                  <select style={{ ...inputStyle, padding: '11px' }} value={fullLanguage} onChange={e => setFullLanguage(e.target.value)}>
                    <option value="English">English</option>
                    <option value="Hindi">Hindi</option>
                  </select>
                </div>
              )}
            </div>
                       
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>Paper Architecture Structure</label>
              <div style={modeToggleRow}>
                <button type="button" onClick={() => setFullHasSections(false)} style={{ ...modeBtn, background: !fullHasSections ? '#000000' : '#f1f5f9', color: !fullHasSections ? 'white' : '#000000' }}>
                  Single Flat Paper
                </button>
                <button type="button" onClick={() => setFullHasSections(true)} style={{ ...modeBtn, background: fullHasSections ? '#000000' : '#f1f5f9', color: fullHasSections ? 'white' : '#000000' }}>
                  Multi-Section Paper
                </button>
              </div>
            </div>
            {!fullHasSections ? (
              <div style={nestedBox}>
                <h4 style={{ margin: '0 0 15px 0', color: '#000000', fontWeight: '800' }}>Configure Full Paper Metrics</h4>
                <div style={flexRow}>
                  <div style={{ flex: 1 }}><label style={miniLabel}>Total Questions (Max 100)</label><input style={inputStyle} type="number" min="1" placeholder="e.g. 100" value={fullQCount} onChange={e => setFullQCount(e.target.value)} /></div>
                  <div style={{ flex: 1 }}><label style={miniLabel}>Total Duration (Mins)</label><input style={inputStyle} type="number" min="1" placeholder="e.g. 120" value={fullDuration} onChange={e => setFullDuration(e.target.value)} /></div>
                </div>
                <div style={flexRow}>
                  <div style={{ flex: 1 }}><label style={miniLabel}>Question Format Type</label>
                    <select style={{ ...inputStyle, padding: '11px' }} value={fullType} onChange={e => setFullType(e.target.value)}>
                      <option value="Objective">Objective (MCQ)</option>
                      <option value="Subjective">Subjective (Theory)</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}><label style={miniLabel}>Correct Mark (+)</label><input style={inputStyle} type="number" step="0.5" value={fullMarks} onChange={e => setFullMarks(e.target.value)} /></div>
                  <div style={{ flex: 1 }}><label style={miniLabel}>Negative Mark (-)</label><input style={inputStyle} type="number" step="0.01" value={fullNeg} onChange={e => setFullNeg(e.target.value)} disabled={fullType === 'Subjective'} /></div>
                </div>
              </div>
            ) : (
              <div style={nestedBox}>
                <h4 style={{ margin: '0 0 15px 0', color: '#000000', fontWeight: '800' }}>
                  {editingSecIdx !== null ? `Modify Section Component #${editingSecIdx + 1}` : "Configure Section Module (Maximum 5)"}
                </h4>
                <div style={flexRow}>
                  <div style={{ flex: 1.2 }}><label style={miniLabel}>Section Name</label><input style={inputStyle} placeholder="e.g. History & Culture" value={secName} onChange={e => setSecName(e.target.value)} /></div>
                  <div style={{ flex: 0.6 }}><label style={miniLabel}>Duration (Mins)</label><input style={inputStyle} type="number" min="1" placeholder="20" value={secTime} onChange={e => setSecTime(e.target.value)} /></div>
                  <div style={{ flex: 0.6 }}><label style={miniLabel}>Questions (Max 50)</label><input style={inputStyle} type="number" min="1" placeholder="50" value={secQCount} onChange={e => setSecQCount(e.target.value)} /></div>
                </div>
                <div style={flexRow}>
                  <div style={{ flex: 1 }}><label style={miniLabel}>Question Type</label>
                    <select style={{ ...inputStyle, padding: '11px' }} value={secType} onChange={e => setSecType(e.target.value)}>
                      <option value="Objective">Objective (MCQ)</option>
                      <option value="Subjective">Subjective (Theory)</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}><label style={miniLabel}>Difficulty</label>
                    <select style={{ ...inputStyle, padding: '11px' }} value={secDifficulty} onChange={e => setSecDifficulty(e.target.value)}>
                      <option value="Easy">Easy</option>
                      <option value="Medium">Medium</option>
                      <option value="Tough">Tough</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}><label style={miniLabel}>Section Language</label>
                    <select style={{ ...inputStyle, padding: '11px' }} value={secLanguage} onChange={e => setSecLanguage(e.target.value)}>
                      <option value="English">English</option>
                      <option value="Hindi">Hindi</option>
                    </select>
                  </div>
                </div>
                <div style={flexRow}>
                  <div style={{ flex: 1 }}><label style={miniLabel}>Correct Mark (+)</label><input style={inputStyle} type="number" step="0.5" value={secMarks} onChange={e => setSecMarks(e.target.value)} /></div>
                  <div style={{ flex: 1 }}><label style={miniLabel}>Negative Mark (-)</label><input style={inputStyle} type="number" step="0.01" value={secNeg} onChange={e => setSecNeg(e.target.value)} disabled={secType === 'Subjective'} /></div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={handleAddSectionToBlueprint} style={{ ...addSecBtn, flex: 2 }}>
                    {editingSecIdx !== null ? "Update Section Configuration" : "Save Section Component"}
                  </button>
                  {editingSecIdx !== null && (
                    <button 
                      type="button" 
                      onClick={() => { setEditingSecIdx(null); setSecName(''); setSecTime(''); setSecQCount(''); }} 
                      style={{ ...cancelBtn, padding: '10px', fontSize: '0.85rem' }}
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>
              </div>
            )}
            
            {fullHasSections && aiSections.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Added Blueprint Layout Matrix ({aiSections.length}/5):</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {aiSections.map((sec, i) => (
                    <div key={i} style={{ ...secBadgeRow, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ flex: 1 }}>
                        <span>Section: <b>{sec.name}</b> ({sec.type} - {sec.difficulty} - {sec.language})</span>
                        <span style={{ display: 'block', fontSize: '0.78rem', color: '#64748b', marginTop: '4px' }}>
                          {sec.qCount} Qs | {sec.time} Mins | {sec.marks} M | -{sec.neg}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button 
                          type="button" 
                          onClick={() => {
                            setEditingSecIdx(i);
                            setSecName(sec.name);
                            setSecTime(sec.time);
                            setSecQCount(sec.qCount);
                            setSecMarks(sec.marks);
                            setSecNeg(sec.neg);
                            setSecType(sec.type);
                            setSecDifficulty(sec.difficulty);
                            setSecLanguage(sec.language);
                          }} 
                          style={miniSectionActionControlBtn}
                        >
                          ✏️ Edit
                        </button>
                        <button 
                          type="button" 
                          onClick={() => {
                            setAiSections(aiSections.filter((_, idx) => idx !== i));
                            if (editingSecIdx === i) setEditingSecIdx(null);
                          }} 
                          style={{ ...miniSectionActionControlBtn, color: '#ef4444', borderColor: '#fee2e2' }}
                        >
                          ❌ Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {fullHasSections && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '20px 0', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 'bold', color: '#000000' }}>
                <input type="checkbox" checked={hasSectionalTiming} onChange={e => setHasSectionalTiming(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: '#000000' }} />
                Enforce Strict Sectional Timing Rules?
              </label>
            )}
            <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
              <button onClick={() => setView('selection')} style={cancelBtn}>Back</button>
                           
              <button 
                 onClick={handleGenerateFullTest}
                style={{ 
                   ...actionBtn, 
                   padding: '14px', 
                   borderRadius: '12px', 
                   background: '#000000',
                  cursor: 'pointer'
                }}
              >
                Compile Full AI Exam Blueprint
              </button>
            </div>
          </div>
        </div>
      )}

      {view === 'config-topic' && (
        <div style={formWrapper}>
          <div style={formCard}>
            <h2 style={{ color: '#000000', marginBottom: '5px', fontWeight: '900' }}>Targeted Topic Drill</h2>
            <p style={{ color: '#64748b', marginBottom: '25px', fontSize: '0.9rem', fontWeight: '500' }}>Specify single concepts and set direct evaluation criteria.</p>
                       
            <div style={flexRow}>
              <div style={{ flex: 1 }}><label style={labelStyle}>Target Exam / Class <span style={mandatoryStar}>*</span></label><input style={inputStyle} placeholder="e.g. UPSC Prelims" value={targetExam} onChange={e => setTargetExam(e.target.value)} /></div>
              <div style={{ flex: 1 }}><label style={labelStyle}>Subject / Section <span style={mandatoryStar}>*</span></label><input style={inputStyle} placeholder="e.g. Maths, English, GK" value={topicSubjectSection} onChange={e => setTopicSubjectSection(e.target.value)} /></div>
            </div>

            <div>
              <label style={labelStyle}>Topic Name (Optional)</label>
              <input style={inputStyle} placeholder="e.g. Geography (leave blank for general)" value={topicName} onChange={e => setTopicName(e.target.value)} />
            </div>
                       
            <div style={flexRow}>
              <div style={{ flex: 1 }}><label style={labelStyle}>Question Count (Max 100) <span style={mandatoryStar}>*</span></label><input style={inputStyle} type="number" min="1" placeholder="e.g. 15" value={topicQCount} onChange={e => setTopicQCount(e.target.value)} /></div>
              <div style={{ flex: 1 }}><label style={labelStyle}>Total Duration (Mins) <span style={mandatoryStar}>*</span></label><input style={inputStyle} type="number" min="1" placeholder="e.g. 15" value={globalTime} onChange={e => setGlobalTime(e.target.value)} /></div>
            </div>
                       
            <div style={flexRow}>
              <div style={{ flex: 1 }}><label style={labelStyle}>Format Type <span style={mandatoryStar}>*</span></label>
                <select style={{ ...inputStyle, padding: '11px' }} value={topicType} onChange={e => setTopicType(e.target.value)}>
                  <option value="Objective">Objective (MCQ)</option>
                  <option value="Subjective">Subjective (Theory)</option>
                </select>
              </div>
              <div style={{ flex: 1 }}><label style={labelStyle}>Difficulty Level <span style={mandatoryStar}>*</span></label>
                <select style={{ ...inputStyle, padding: '11px' }} value={topicDifficulty} onChange={e => setTopicDifficulty(e.target.value)}>
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Tough">Tough</option>
                </select>
              </div>
              <div style={{ flex: 1 }}><label style={labelStyle}>Language <span style={mandatoryStar}>*</span></label>
                <select style={{ ...inputStyle, padding: '11px' }} value={topicLanguage} onChange={e => setTopicLanguage(e.target.value)}>
                  <option value="English">English</option>
                  <option value="Hindi">Hindi</option>
                </select>
              </div>
            </div>
            <div style={flexRow}>
              <div style={{ flex: 1 }}><label style={labelStyle}>Positive Marks <span style={mandatoryStar}>*</span></label><input style={inputStyle} type="number" step="0.5" min="0" value={topicMarks} onChange={e => setTopicMarks(e.target.value)} /></div>
              <div style={{ flex: 1 }}><label style={labelStyle}>Negative Penalty <span style={mandatoryStar}>*</span></label><input style={inputStyle} type="number" step="0.01" min="0" value={topicNeg} onChange={e => setTopicNeg(e.target.value)} disabled={topicType === 'Subjective'} /></div>
            </div>
            <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '20px', marginTop: '10px' }}>
              <button onClick={() => setView('selection')} style={cancelBtn}>Back</button>
                           
              <button 
                 onClick={handleGenerateTopicTest}
                style={{ 
                   ...actionBtn, 
                   padding: '14px', 
                   borderRadius: '12px', 
                   background: '#000000',
                  cursor: 'pointer'
                }}
              >
                Initialize AI Sniper Drill
              </button>
            </div>
          </div>
        </div>
      )}

      {view === 'ai-summary' && (
        <div style={formWrapper}>
          <div style={{ ...formCard, maxWidth: '460px', textAlign: 'center' }}>
            <h2 style={{ color: '#000000', margin: 0, fontWeight: '900' }}>AI Compilation Successful</h2>
            <p style={{ fontSize: '0.82rem', color: '#000000', fontWeight: 'bold', letterSpacing: '0.5px', marginTop: '4px' }}>ROOM ID: {aiTestDetails.id}</p>
            <div style={summaryVaultBox}>
              <div style={sumLine}><span>Blueprint Title:</span> <strong>{aiTestDetails.title}</strong></div>
              <div style={sumLine}><span>Evaluation Format:</span> <strong>{aiTestDetails.mode}</strong></div>
              <div style={sumLine}><span>Total Test Scale:</span> <b>{aiTestDetails.questions} Compiled Questions</b></div>
              <div style={sumLine}><span>Cumulative Timer:</span> <strong>{aiTestDetails.time} Allotted Mins</strong></div>
            </div>
                       
            <button onClick={() => onStartTest(aiTestDetails)} style={{ ...actionBtn, background: '#000000', padding: '14px', fontSize: '1rem', marginBottom: '12px', width: '100%', borderRadius: '12px' }}>
              Launch AI Engine Test Portal 
            </button>
            {isAdmin && (
              <div style={{ borderTop: '1px dashed #cbd5e1', marginTop: '18px', paddingTop: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <p style={{ margin: '0 0 4px 0', fontSize: '0.78rem', fontWeight: '800', color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left' }}> Admin Actions:</p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button 
                     type="button"
                    onClick={() => setView('admin-preview')} 
                     style={{ ...actionBtn, background: '#1e293b', padding: '11px', fontSize: '0.85rem', borderRadius: '10px', flex: 1, fontWeight: '700' }}
                  >
                      Analyse Test
                  </button>
                  <button 
                     type="button"
                    onClick={() => {
                      setRenamedTitle(aiTestDetails.title);
                      setSelectedMoveCategory('');
                      setSelectedMoveSeries('');
                      setSelectedMoveSection('');
                      fetchCloudDatabaseTree();
                      setView('admin-push-cloud');
                    }} 
                     style={{ ...actionBtn, background: '#4f46e5', padding: '11px', fontSize: '0.85rem', borderRadius: '10px', flex: 1, fontWeight: '700' }}
                  >
                      Add to Series
                  </button>
                </div>
              </div>
            )}
            <button onClick={() => setView('selection')} style={{ ...cancelBtn, width: '100%', marginTop: '12px' }}>Discard Configuration</button>
          </div>
        </div>
      )}

      {view === 'admin-preview' && (
        <div style={{ padding: '30px 10px', maxWidth: '850px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '1px solid #e2e8f0', paddingBottom: '18px' }}>
            <div>
              <h2 style={{ margin: 0, color: '#0f172a', fontWeight: '900', letterSpacing: '-0.5px' }}> Admin Blueprint Review</h2>
              <p style={{ color: '#64748b', margin: '4px 0 0 0', fontSize: '0.9rem', fontWeight: '500' }}>Reviewing questions, right choices, and evaluation metrics mapping.</p>
            </div>
            <button onClick={() => setView('ai-summary')} style={{ ...cancelBtn, background: '#000000', color: '#ffffff', borderRadius: '10px' }}>Back to Summary</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
            {aiTestDetails && aiTestDetails.sections ? (
              aiTestDetails.sections.map((sec, sIdx) => (
                <div key={sIdx} style={{ background: '#f8fafc', padding: '20px', borderRadius: '18px', border: '1px solid #e2e8f0' }}>
                  <h3 style={{ margin: '0 0 16px 0', color: '#4f46e5', fontWeight: '800', fontSize: '1.15rem' }}> Section Bundle: {sec.name} ({sec.time} Mins)</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {sec.questions.map((q, qIdx) => (
                      <div key={qIdx} style={{ background: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #cbd5e1' }}>
                         <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                           <span style={{ fontWeight: '800', color: '#64748b', fontSize: '0.78rem', textTransform: 'uppercase' }}>Item #{qIdx + 1} {q.type}</span>
                           <span style={{ fontWeight: '800', color: '#10b981', fontSize: '0.8rem' }}>Score: {q.marks} | Neg: {q.neg}</span>
                         </div>
                         <p style={{ fontSize: '1.05rem', fontWeight: '600', margin: '0 0 15px 0', color: '#0f172a', lineHeight: '1.4' }}><LatexText text={q.question} /></p>
                                               
                         {q.type === 'Objective' && q.options && (
                           <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
                             {q.options.map((opt, oIdx) => (
                               <div key={oIdx} style={{ padding: '12px 16px', borderRadius: '10px', border: oIdx === q.correct ? '2px solid #10b981' : '1px solid #e2e8f0', background: oIdx === q.correct ? '#f0fdf4' : '#ffffff', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', fontWeight: '500' }}>
                                 <span>{String.fromCharCode(64 + oIdx)}. <LatexText text={opt} /></span>
                                 {oIdx === q.correct && <span style={{ color: '#15803d', fontWeight: '700' }}> Correct Target</span>}
                               </div>
                             ))}
                           </div>
                         )}
                         <div style={{ background: '#f0f9ff', padding: '14px', borderRadius: '10px', borderLeft: '4px solid #0284c7' }}>
                           <strong style={{ color: '#0284c7', fontSize: '0.82rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}> AI Resolution Matrix:</strong>
                           <p style={{ margin: 0, fontSize: '0.9rem', color: '#334155', lineHeight: '1.5', fontWeight: '500' }}><LatexText text={q.explanation} /></p>
                         </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              aiTestDetails && aiTestDetails.questions_list && aiTestDetails.questions_list.map((q, qIdx) => (
                <div key={qIdx} style={{ background: '#ffffff', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.01)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <span style={{ fontWeight: '800', color: '#64748b', fontSize: '0.78rem', textTransform: 'uppercase' }}>Item #{qIdx + 1} {q.type}</span>
                    <span style={{ fontWeight: '800', color: '#10b981', fontSize: '0.8rem' }}>Score: {q.marks} | Neg: {q.neg}</span>
                  </div>
                  <p style={{ fontSize: '1.05rem', fontWeight: '600', margin: '0 0 15px 0', color: '#0f172a', lineHeight: '1.4' }}><LatexText text={q.question} /></p>
                                   
                  {q.type === 'Objective' && q.options && (
                    <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
                      {q.options.map((opt, oIdx) => (
                        <div key={oIdx} style={{ padding: '12px 16px', borderRadius: '10px', border: oIdx === q.correct ? '2px solid #10b981' : '1px solid #e2e8f0', background: oIdx === q.correct ? '#f0fdf4' : '#ffffff', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', fontWeight: '500' }}>
                          <span>{String.fromCharCode(64 + oIdx)}. <LatexText text={opt} /></span>
                          {oIdx === q.correct && <span style={{ color: '#15803d', fontWeight: '700' }}> Correct Target</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ background: '#f0f9ff', padding: '14px', borderRadius: '10px', borderLeft: '4px solid #0284c7' }}>
                    <strong style={{ color: '#0284c7', fontSize: '0.82rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}> AI Resolution Matrix:</strong>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#334155', lineHeight: '1.5', fontWeight: '500' }}><LatexText text={q.explanation} /></p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {view === 'admin-push-cloud' && (
        <div style={formWrapper}>
          <div style={formCard}>
            <h2 style={{ color: '#000000', marginBottom: '5px', fontWeight: '900' }}> Deploy to Official Series</h2>
            <p style={{ color: '#64748b', marginBottom: '25px', fontSize: '0.9rem', fontWeight: '500' }}>Rename and position this AI generated exam blueprint inside official routing matrices.</p>
                       
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Customize / Rename Title</label>
              <input style={inputStyle} value={renamedTitle} onChange={e => setRenamedTitle(e.target.value)} placeholder="e.g. UPSC Prelims Sectional Mock" />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>1. Main Exam Category Folder</label>
              <select style={{ ...inputStyle, padding: '11px' }} value={selectedMoveCategory} onChange={e => { setSelectedMoveCategory(e.target.value); setSelectedMoveSeries(''); setSelectedMoveSection(''); }}>
                <option value="">-- Choose Target Category --</option>
                {categoriesList.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            {selectedMoveCategory && (
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>2. Target Test Series Branch</label>
                <select style={{ ...inputStyle, padding: '11px' }} value={selectedMoveSeries} onChange={e => { setSelectedMoveSeries(e.target.value); setSelectedMoveSection(''); }}>
                  <option value="">-- Choose Series Branch --</option>
                  {seriesList.map(ser => <option key={ser} value={ser}>{ser}</option>)}
                </select>
              </div>
            )}
            {selectedMoveCategory && selectedMoveSeries && (
              <div style={{ marginBottom: '22px' }}>
                <label style={labelStyle}>3. Target Section Tab Placement</label>
                <select style={{ ...inputStyle, padding: '11px' }} value={selectedMoveSection} onChange={e => setSelectedMoveSection(e.target.value)}>
                  <option value="">-- Choose Section Tab Layer --</option>
                  {subSectionsList.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
              <button onClick={() => setView('ai-summary')} style={cancelBtn}>Cancel</button>
              <button onClick={handlePublishToOfficialCloud} style={{ ...actionBtn, background: '#4f46e5', borderRadius: '12px' }}>Transmit to Cloud Matrix</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- STYLES SCHEMA ---
const containerStyle = { padding: '40px 20px', maxWidth: '1050px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }; 
const selectionGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginTop: '35px' }; 
const cardHeaderRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '20px' }; const leftCardTitle = { margin: '0 0 16px 0', fontSize: '1.5rem', color: '#0f172a', fontWeight: '800', letterSpacing: '-0.5px' }; const cleanBulletList = { listStyleType: 'none', padding: 0, margin: '0 0 35px 0', display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', flex: 1 }; const bulletItemRow = { display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '0.92rem', color: '#475569', fontWeight: '500', lineHeight: '1.5' }; const fullMockCardStyle = { background: '#ffffff', padding: '35px', borderRadius: '24px', border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', boxShadow: '0 4px 20px rgba(79, 70, 229, 0.03)' }; const indigoIconFrame = { width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e0e7ff', border: '1px solid #c7d2fe' }; const indigoBadge = { background: '#e0e7ff', color: '#4f46e5', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.2px' }; const indigoActionBtn = { border: 'none', color: '#fff', padding: '12px 24px', borderRadius: '12px', fontWeight: '700', fontSize: '0.92rem', cursor: 'pointer', transition: '0.2s', width: '100%', background: '#4f46e5', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.15)' }; const topicMockCardStyle = { background: '#ffffff', padding: '35px', borderRadius: '24px', border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', boxShadow: '0 4px 20px rgba(16, 185, 129, 0.03)' }; const emeraldIconFrame = { width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#d1fae5', border: '1px solid #a7f3d0' }; const emeraldBadge = { background: '#d1fae5', color: '#065f46', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.2px' }; const emeraldActionBtn = { border: 'none', color: '#fff', padding: '12px 24px', borderRadius: '12px', fontWeight: '700', fontSize: '0.92rem', cursor: 'pointer', transition: '0.2s', width: '100%', background: '#10b981', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)' }; const actionBtn = { border: 'none', color: '#fff', padding: '11px 24px', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', transition: '0.2s', width: '100%' }; const formWrapper = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', padding: '20px', background: '#ffffff', fontFamily: 'Inter, sans-serif' }; const formCard = { background: '#fff', padding: '35px', borderRadius: '24px', border: '1px solid #e2e8f0', width: '100%', maxWidth: '620px', boxShadow: '0 10px 30px rgba(0,0,0,0.01)' }; const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }; const mandatoryStar = { color: '#ef4444', fontWeight: '900' }; const miniLabel = { display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', marginBottom: '6px', textTransform: 'uppercase' }; const inputStyle = { width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.95rem', outline: 'none', marginBottom: '15px', background: '#f8fafc', fontWeight: '600', color: '#000000', boxSizing: 'border-box' }; const flexRow = { display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '5px' }; const nestedBox = { background: '#f8fafc', padding: '16px', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '20px' }; const addSecBtn = { width: '100%', padding: '10px', background: '#000000', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }; const secBadgeRow = { display: 'flex', justifyContent: 'space-between', background: '#fff', padding: '10px 15px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: '600' }; const cancelBtn = { padding: '12px 24px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer' }; const summaryVaultBox = { background: '#f8fafc', border: '1px solid #e2e8f0', padding: '20px', borderRadius: '16px', textAlign: 'left', margin: '20px 0 30px 0' }; const sumLine = { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.9rem', fontWeight: '500' }; const modeToggleRow = { display: 'flex', gap: '10px', background: '#f1f5f9', padding: '5px', borderRadius: '12px', marginBottom: '15px' }; const modeBtn = { flex: 1, padding: '10px', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem', transition: '0.3s' }; 

const miniSectionActionControlBtn = {
  padding: '4px 10px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#334155',
  fontSize: '0.75rem',
  fontWeight: '700',
  cursor: 'pointer',
  transition: 'all 0.15s ease'
};

export default AiTests;