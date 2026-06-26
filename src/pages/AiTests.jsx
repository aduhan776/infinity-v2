import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; 
import LatexText from '../components/LatexText'; 

const AiTests = ({ onStartTest }) => {
  const [view, setView] = useState('selection'); // selection, config-full, config-topic, ai-summary, admin-preview, admin-push-cloud
  const [aiTestDetails, setAiTestDetails] = useState(null);
  const [loading, setLoading] = useState(false); 
  const [cooldown, setCooldown] = useState(0); 
  
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

  const fetchCloudDatabaseTree = async () => {
    try {
      const { data, error } = await supabase
        .from('mock_tests')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) {
        setCloudMockTestsPool(data);
      }
    } catch (err) {
      console.error("Failed to sync matrix paths:", err);
    }
  };

  const ensureAiLabCategory = async () => {
    try {
      await supabase.from('exam_categories').insert([{ name: 'AI Lab Generated' }]);
    } catch (e) {
      // Quiet fallback for handled duplicates
    }
  };

  const handleGenerateFullTest = async () => {
    if (!testTitle.trim()) { alert("Please enter a test title to continue."); return; }
    if (cooldown > 0) { alert(`Server cooldown active. Please wait ${cooldown} seconds.`); return; }
    
    setLoading(true);
    await ensureAiLabCategory(); 

    try {
      const generatedTestId = "AI-FULL-" + Date.now();
      let finalStructure = {
        id: generatedTestId,
        title: `AI Full Mock: ${testTitle} [${fullDifficulty}]`,
      };

      if (fullHasSections) {
        if (aiSections.length === 0) { alert("Please add at least one section to build the test blueprint."); setLoading(false); return; }
              
        const totalQuestions = aiSections.reduce((acc, s) => acc + parseInt(s.qCount), 0);
        const totalDuration = aiSections.reduce((acc, s) => acc + parseInt(s.time), 0);
        const compiledSections = [];

        for (const sec of aiSections) {
          const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/generate-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              exam: testTitle,
              topic: sec.name,
              count: parseInt(sec.qCount),
              type: sec.type, 
              difficulty: sec.difficulty,
              language: sec.language
            })
          });

          const data = await response.json();
          if (!data.success) throw new Error(data.error || `Failed on section: ${sec.name}`);

          const processedSectionQuestions = data.questions.map((q, i) => {
            if (sec.type === 'Objective') {
              return {
                id: i,
                type: 'Objective',
                question: q.question,
                options: q.options || ["Option A", "Option B", "Option C", "Option D"],
                correct: q.correctOptionIndex !== undefined ? q.correctOptionIndex : 0,
                marks: `+${parseFloat(sec.marks || 2.0).toFixed(1)}`,
                neg: `-${parseFloat(sec.neg || 0.66).toFixed(2)}`,
                explanation: q.explanation || "Resolution matrix computed."
              };
            } else {
              return {
                id: i,
                type: 'Subjective',
                question: q.question,
                marks: `+${parseFloat(sec.marks || 10.0).toFixed(1)}`,
                neg: "0",
                explanation: q.explanation || "Model marking structure synced."
              };
            }
          });

          compiledSections.push({
            name: sec.name,
            time: parseInt(sec.time),
            language: sec.language,
            questions: processedSectionQuestions
          });
        }

        finalStructure.time = totalDuration;
        finalStructure.questions = totalQuestions;
        finalStructure.hasSectionalTiming = hasSectionalTiming;
        finalStructure.sections = compiledSections;
        finalStructure.mode = `Mixed / Sectional (${fullDifficulty})`;

        await supabase.from('mock_tests').insert([{
          id: generatedTestId,
          category_name: 'AI Lab Generated',
          title: finalStructure.title,
          questions: totalQuestions,
          time: totalDuration,
          sections: compiledSections,
          has_sectional_timing: hasSectionalTiming
        }]);

      } else {
        if (!fullQCount || !fullDuration) { alert("Please enter the question count and duration."); setLoading(false); return; }
        if (parseInt(fullQCount) > 75) { alert("Maximum limit is 75 questions for a single paper."); setLoading(false); return; }
              
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/generate-test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            exam: testTitle,
            topic: testTitle, 
            count: parseInt(fullQCount),
            type: fullType, 
            difficulty: fullDifficulty,
            language: fullLanguage
          })
        });

        const data = await response.json();
        if (!data.success) throw new Error(data.error);

        const generatedQuestions = data.questions.map((q, i) => {
          if (fullType === 'Objective') {
            return {
              id: i,
              type: 'Objective',
              question: q.question,
              options: q.options || ["Option A", "Option B", "Option C", "Option D"],
              correct: q.correctOptionIndex !== undefined ? q.correctOptionIndex : 0,
              marks: `+${parseFloat(fullMarks || 2.0).toFixed(1)}`,
              neg: `-${parseFloat(fullNeg || 0.66).toFixed(2)}`,
              explanation: q.explanation || "Resolution matrix computed."
            };
          } else {
            return {
              id: i,
              type: 'Subjective',
              question: q.question,
              marks: `+${parseFloat(fullMarks || 10.0).toFixed(1)}`,
              neg: "0",
              explanation: q.explanation || "Model marking structure synced."
            };
          }
        });

        finalStructure.time = parseInt(fullDuration);
        finalStructure.questions = generatedQuestions.length;
        finalStructure.hasSectionalTiming = false;
        finalStructure.questions_list = generatedQuestions;
        finalStructure.mode = `${fullType} (${fullDifficulty}) - ${fullLanguage}`;

        await supabase.from('mock_tests').insert([{
          id: generatedTestId,
          category_name: 'AI Lab Generated',
          title: finalStructure.title,
          questions: generatedQuestions.length,
          time: parseInt(fullDuration),
          questions_list: generatedQuestions,
          has_sectional_timing: false
        }]);
      }

      setAiTestDetails(finalStructure);
      setView('ai-summary');

    } catch (error) {
      console.error("Full Test Compilation Error:", error);
      alert("A backend error occurred. A 60-second cooldown has been applied for safety.");
      setCooldown(60); 
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateTopicTest = async () => {
    if (!targetExam.trim()) { alert("Target exam name is mandatory."); return; }
    if (!topicName.trim()) { alert("Please enter a focus topic name."); return; }
    if (!topicQCount || !globalTime) { alert("Please enter the question count and duration."); return; }
    if (cooldown > 0) { alert(`Server cooldown active. Please wait ${cooldown} seconds.`); return; }
    
    if (parseInt(topicQCount) > 50) {
      alert("Maximum limit is 50 questions for topic drill mode.");
      return;
    }

    setLoading(true);
    await ensureAiLabCategory();

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/generate-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          exam: targetExam,
          topic: topicName,
          count: parseInt(topicQCount),
          type: topicType, 
          difficulty: topicDifficulty,
          language: topicLanguage
        })
      });

      const data = await response.json();

      if (data.success) {
        const generatedQuestions = data.questions.map((q, i) => {
          if (topicType === 'Objective') {
            return {
              id: i,
              type: 'Objective',
              question: q.question,
              options: q.options || ["Option A", "Option B", "Option C", "Option D"],
              correct: q.correctOptionIndex !== undefined ? q.correctOptionIndex : 0,
              marks: `+${parseFloat(topicMarks || 2.0).toFixed(1)}`,
              neg: `-${parseFloat(topicNeg || 0.66).toFixed(2)}`,
              explanation: q.explanation || "Resolution matrix computed."
            };
          } else {
            return {
              id: i,
              type: 'Subjective',
              question: q.question,
              marks: `+${parseFloat(topicMarks || 10.0).toFixed(1)}`,
              neg: "0",
              explanation: q.explanation || "Model marking structure synced."
            };
          }
        });

        const generatedTestId = "AI-TOPIC-" + Date.now();
        const topicStructure = {
          id: generatedTestId,
          title: `AI Drill: ${topicName} (${targetExam})`,
          time: parseInt(globalTime),
          questions: generatedQuestions.length,
          hasSectionalTiming: false,
          questions_list: generatedQuestions,
          mode: `${topicType} - ${topicDifficulty} (${topicLanguage})`
        };

        await supabase.from('mock_tests').insert([{
          id: generatedTestId,
          category_name: 'AI Lab Generated',
          title: topicStructure.title,
          questions: generatedQuestions.length,
          time: parseInt(globalTime),
          questions_list: generatedQuestions,
          has_sectional_timing: false
        }]);

        setAiTestDetails(topicStructure);
        setView('ai-summary');
      } else {
        alert("Backend Engine Layer Alert: " + data.error);
        setCooldown(60); 
      }
    } catch (error) {
      console.error("AI Generation Error:", error);
      alert("Connection error occurred. Please try again after 60 seconds.");
      setCooldown(60); 
    } finally {
      setLoading(false);
    }
  };

  const handleAddSectionToBlueprint = () => {
    if (!secName.trim() || !secTime || !secQCount) {
      alert("Please fill out section name, duration, and question count.");
      return;
    }

    if (aiSections.length >= 5) {
      alert("Maximum limit is 5 sections per test blueprint.");
      return;
    }
    if (parseInt(secQCount) > 15) {
      alert("Maximum limit is 15 questions per section.");
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
    setAiSections([...aiSections, newSecObj]);
    setSecName('');
    setSecTime('');
    setSecQCount('');
  };

  if (loading) {
    return (
      <div style={formWrapper}>
        <div style={{ ...formCard, maxWidth: '450px', textAlign: 'center', padding: '50px 30px' }}>
          <h3 style={{ color: '#000000', fontWeight: '900', fontSize: '1.4rem', margin: 0 }}>Generating AI Test Paper...</h3>
          <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '12px', lineHeight: '1.6', fontWeight: '500' }}>
            The AI engine is compiling custom questions and evaluation matrices. Please wait a moment.
          </p>
        </div>
      </div>
    );
  }

  // --- VIEW 1: SELECTION LANDING ---
  if (view === 'selection') {
    return (
      <div style={containerStyle}>
        <header style={{ textAlign: 'center', marginBottom: '50px' }}>
          <h1 style={{ fontSize: '2.6rem', fontWeight: '900', color: '#0f172a', margin: 0, letterSpacing: '-0.8px' }}>AI Test Lab</h1>
          <p style={{ color: '#64748b', marginTop: '8px', fontSize: '1rem', fontWeight: '500' }}>Choose how you want to practice and prepare with AI</p>
        </header>
        
        <div style={selectionGrid}>
          {/* CARD 1: FULL MOCK TEST */}
          <div style={fullMockCardStyle} onClick={() => { setView('config-full'); setAiSections([]); setFullHasSections(false); }}>
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

          {/* CARD 2: TOPIC WISE TEST */}
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
      </div>
    );
  }

  // --- VIEW 2: FULL TEST CONFIG ---
  if (view === 'config-full') {
    return (
      <div style={formWrapper}>
        <div style={formCard}>
          <h2 style={{ color: '#000000', marginBottom: '5px', fontWeight: '900' }}>Full Scale Exam Blueprint</h2>
          <p style={{ color: '#64748b', marginBottom: '25px', fontSize: '0.9rem', fontWeight: '500' }}>Configure structure evaluation parameters and let AI model the questions.</p>
          
          <div style={flexRow}>
            <div style={{ flex: 1.5 }}>
              <label style={labelStyle}>Exam / Paper Reference Title</label>
              <input style={inputStyle} placeholder="e.g. UPSC Mains Mock" value={testTitle} onChange={e => setTestTitle(e.target.value)} />
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
                <div style={{ flex: 1 }}><label style={miniLabel}>Total Questions (Max 75)</label><input style={inputStyle} type="number" placeholder="e.g. 50" value={fullQCount} onChange={e => setFullQCount(e.target.value)} /></div>
                <div style={{ flex: 1 }}><label style={miniLabel}>Total Duration (Mins)</label><input style={inputStyle} type="number" placeholder="e.g. 120" value={fullDuration} onChange={e => setFullDuration(e.target.value)} /></div>
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
              <h4 style={{ margin: '0 0 15px 0', color: '#000000', fontWeight: '800' }}>Configure Section Module (Maximum 5)</h4>
              <div style={flexRow}>
                <div style={{ flex: 1.2 }}><label style={miniLabel}>Section Name</label><input style={inputStyle} placeholder="e.g. History & Culture" value={secName} onChange={e => setSecName(e.target.value)} /></div>
                <div style={{ flex: 0.6 }}><label style={miniLabel}>Duration (Mins)</label><input style={inputStyle} type="number" placeholder="20" value={secTime} onChange={e => setSecTime(e.target.value)} /></div>
                <div style={{ flex: 0.6 }}><label style={miniLabel}>Questions (Max 15)</label><input style={inputStyle} type="number" placeholder="15" value={secQCount} onChange={e => setSecQCount(e.target.value)} /></div>
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
              <button onClick={handleAddSectionToBlueprint} style={addSecBtn}>Save Section Component</button>
            </div>
          )}

          {fullHasSections && aiSections.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>Added Blueprint Layout Matrix ({aiSections.length}/5):</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {aiSections.map((sec, i) => (
                  <div key={i} style={secBadgeRow}>
                    <span>Section: <b>{sec.name}</b> ({sec.type} - {sec.difficulty} - {sec.language})</span>
                    <span>{sec.qCount} Qs | {sec.time} Mins | {sec.marks} M | -{sec.neg}</span>
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
              disabled={cooldown > 0}
              style={{ 
                ...actionBtn, 
                padding: '14px', 
                borderRadius: '12px', 
                background: cooldown > 0 ? '#94a3b8' : '#000000',
                cursor: cooldown > 0 ? 'not-allowed' : 'pointer'
              }}
            >
              {cooldown > 0 ? `Wait ${cooldown}s` : "Compile Full AI Exam Blueprint"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW 3: TOPIC TEST CONFIG ---
  if (view === 'config-topic') {
    return (
      <div style={formWrapper}>
        <div style={formCard}>
          <h2 style={{ color: '#000000', marginBottom: '5px', fontWeight: '900' }}>Targeted Topic Drill</h2>
          <p style={{ color: '#64748b', marginBottom: '25px', fontSize: '0.9rem', fontWeight: '500' }}>Specify single concepts and set direct evaluation criteria.</p>
          
          <div style={flexRow}>
            <div style={{ flex: 1 }}><label style={labelStyle}>Target Exam / Class</label><input style={inputStyle} placeholder="e.g. UPSC Prelims" value={targetExam} onChange={e => setTargetExam(e.target.value)} /></div>
            <div style={{ flex: 1 }}><label style={labelStyle}>Focus Topic Name</label><input style={inputStyle} placeholder="e.g. Geography" value={topicName} onChange={e => setTopicName(e.target.value)} /></div>
          </div>
          
          <div style={flexRow}>
            <div style={{ flex: 1 }}><label style={labelStyle}>Question Count (Max 50)</label><input style={inputStyle} type="number" placeholder="e.g. 15" value={topicQCount} onChange={e => setTopicQCount(e.target.value)} /></div>
            <div style={{ flex: 1 }}><label style={labelStyle}>Total Duration (Mins)</label><input style={inputStyle} type="number" placeholder="e.g. 15" value={globalTime} onChange={e => setGlobalTime(e.target.value)} /></div>
          </div>
          
          <div style={flexRow}>
            <div style={{ flex: 1 }}><label style={labelStyle}>Format Type</label>
              <select style={{ ...inputStyle, padding: '11px' }} value={topicType} onChange={e => setTopicType(e.target.value)}>
                <option value="Objective">Objective (MCQ)</option>
                <option value="Subjective">Subjective (Theory)</option>
              </select>
            </div>
            <div style={{ flex: 1 }}><label style={labelStyle}>Difficulty Level</label>
              <select style={{ ...inputStyle, padding: '11px' }} value={topicDifficulty} onChange={e => setTopicDifficulty(e.target.value)}>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Tough">Tough</option>
              </select>
            </div>
            <div style={{ flex: 1 }}><label style={labelStyle}>Language</label>
              <select style={{ ...inputStyle, padding: '11px' }} value={topicLanguage} onChange={e => setTopicLanguage(e.target.value)}>
                <option value="English">English</option>
                <option value="Hindi">Hindi</option>
              </select>
            </div>
          </div>

          <div style={flexRow}>
            <div style={{ flex: 1 }}><label style={labelStyle}>Positive Marks</label><input style={inputStyle} type="number" step="0.5" value={topicMarks} onChange={e => setTopicMarks(e.target.value)} /></div>
            <div style={{ flex: 1 }}><label style={labelStyle}>Negative Penalty</label><input style={inputStyle} type="number" step="0.01" value={topicNeg} onChange={e => setTopicNeg(e.target.value)} disabled={topicType === 'Subjective'} /></div>
          </div>

          <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '20px', marginTop: '10px' }}>
            <button onClick={() => setView('selection')} style={cancelBtn}>Back</button>
            
            <button 
              onClick={handleGenerateTopicTest} 
              disabled={cooldown > 0}
              style={{ 
                ...actionBtn, 
                padding: '14px', 
                borderRadius: '12px', 
                background: cooldown > 0 ? '#94a3b8' : '#000000',
                cursor: cooldown > 0 ? 'not-allowed' : 'pointer'
              }}
            >
              {cooldown > 0 ? `Wait ${cooldown}s` : "Initialize AI Sniper Drill"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW 4: BLUEPRINT SUMMARY & LAUNCH ---
  if (view === 'ai-summary') {
    return (
      <div style={formWrapper}>
        <div style={{ ...formCard, maxWidth: '460px', textAlign: 'center' }}>
          <h2 style={{ color: '#000000', margin: 0, fontWeight: '900' }}>AI Compilation Successful</h2>
          <p style={{ fontSize: '0.82rem', color: '#000000', fontWeight: 'bold', letterSpacing: '0.5px', marginTop: '4px' }}>ROOM ID: {aiTestDetails.id}</p>
          <div style={summaryVaultBox}>
            <div style={sumLine}><span>Blueprint Title:</span> <strong>{aiTestDetails.title}</strong></div>
            <div style={sumLine}><span>Evaluation Format:</span><strong>{aiTestDetails.mode}</strong></div>
            <div style={sumLine}><span>Total Test Scale:</span> <strong>{aiTestDetails.questions} Compiled Questions</strong></div>
            <div style={sumLine}><span>Cumulative Timer:</span><strong>{aiTestDetails.time} Allotted Mins</strong></div>
          </div>
          
          <button onClick={() => onStartTest(aiTestDetails)} style={{ ...actionBtn, background: '#000000', padding: '14px', fontSize: '1rem', marginBottom: '12px', width: '100%', borderRadius: '12px' }}>
            Launch AI Engine Test Portal →
          </button>

          {/* 🛡️ EXCLUSIVE ADMIN-ONLY CONDITIONAL BUTTONS (ZERO ROUTING OVERHEAD) */}
          {isAdmin && (
            <div style={{ borderTop: '1px dashed #cbd5e1', marginTop: '18px', paddingTop: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '0.78rem', fontWeight: '800', color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left' }}>⚡ Admin Actions:</p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  type="button"
                  onClick={() => setView('admin-preview')} 
                  style={{ ...actionBtn, background: '#1e293b', padding: '11px', fontSize: '0.85rem', borderRadius: '10px', flex: 1, fontWeight: '700' }}
                >
                  🔍 Analyse Test
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
                  📁 Add to Series
                </button>
              </div>
            </div>
          )}

          <button onClick={() => setView('selection')} style={{ ...cancelBtn, width: '100%', marginTop: '12px' }}>Discard Configuration</button>
        </div>
      </div>
    );
  }

  // --- 🔍 EXCLUSIVE ADMIN WORKSPACE: PREVIEW MODE ---
  if (view === 'admin-preview') {
    return (
      <div style={{ padding: '30px 10px', maxWidth: '850px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '1px solid #e2e8f0', paddingBottom: '18px' }}>
          <div>
            <h2 style={{ margin: 0, color: '#0f172a', fontWeight: '900', letterSpacing: '-0.5px' }}>🔍 Admin Blueprint Review</h2>
            <p style={{ color: '#64748b', margin: '4px 0 0 0', fontSize: '0.9rem', fontWeight: '500' }}>Reviewing questions, right choices, and evaluation metrics mapping.</p>
          </div>
          <button onClick={() => setView('ai-summary')} style={{ ...cancelBtn, background: '#000000', color: '#ffffff', borderRadius: '10px' }}>Back to Summary</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
          {aiTestDetails && aiTestDetails.sections ? (
            aiTestDetails.sections.map((sec, sIdx) => (
              <div key={sIdx} style={{ background: '#f8fafc', padding: '20px', borderRadius: '18px', border: '1px solid #e2e8f0' }}>
                <h3 style={{ margin: '0 0 16px 0', color: '#4f46e5', fontWeight: '800', fontSize: '1.15rem' }}>📁 Section Bundle: {sec.name} ({sec.time} Mins)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {sec.questions.map((q, qIdx) => (
                    <div key={qIdx} style={{ background: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #cbd5e1' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <span style={{ fontWeight: '800', color: '#64748b', fontSize: '0.78rem', textTransform: 'uppercase' }}>Item #{qIdx + 1} • {q.type}</span>
                        <span style={{ fontWeight: '800', color: '#10b981', fontSize: '0.8rem' }}>Score: {q.marks} | Neg: {q.neg}</span>
                      </div>
                      <p style={{ fontSize: '1.05rem', fontWeight: '600', margin: '0 0 15px 0', color: '#0f172a', lineHeight: '1.4' }}><LatexText text={q.question} /></p>
                      
                      {q.type === 'Objective' && q.options && (
                        <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
                          {q.options.map((opt, oIdx) => (
                            <div key={oIdx} style={{ padding: '12px 16px', borderRadius: '10px', border: oIdx === q.correct ? '2px solid #10b981' : '1px solid #e2e8f0', background: oIdx === q.correct ? '#f0fdf4' : '#ffffff', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', fontWeight: '500' }}>
                              <span>{String.fromCharCode(65 + oIdx)}. <LatexText text={opt} /></span>
                              {oIdx === q.correct && <span style={{ color: '#15803d', fontWeight: '700' }}>🎯 Correct Target</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ background: '#f0f9ff', padding: '14px', borderRadius: '10px', borderLeft: '4px solid #0284c7' }}>
                        <strong style={{ color: '#0284c7', fontSize: '0.82rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>💡 AI Resolution Matrix:</strong>
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
                  <span style={{ fontWeight: '800', color: '#64748b', fontSize: '0.78rem', textTransform: 'uppercase' }}>Item #{qIdx + 1} • {q.type}</span>
                  <span style={{ fontWeight: '800', color: '#10b981', fontSize: '0.8rem' }}>Score: {q.marks} | Neg: {q.neg}</span>
                </div>
                <p style={{ fontSize: '1.05rem', fontWeight: '600', margin: '0 0 15px 0', color: '#0f172a', lineHeight: '1.4' }}><LatexText text={q.question} /></p>
                
                {q.type === 'Objective' && q.options && (
                  <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} style={{ padding: '12px 16px', borderRadius: '10px', border: oIdx === q.correct ? '2px solid #10b981' : '1px solid #e2e8f0', background: oIdx === q.correct ? '#f0fdf4' : '#ffffff', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', fontWeight: '500' }}>
                        <span>{String.fromCharCode(65 + oIdx)}. <LatexText text={opt} /></span>
                        {oIdx === q.correct && <span style={{ color: '#15803d', fontWeight: '700' }}>🎯 Correct Target</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ background: '#f0f9ff', padding: '14px', borderRadius: '10px', borderLeft: '4px solid #0284c7' }}>
                  <strong style={{ color: '#0284c7', fontSize: '0.82rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>💡 AI Resolution Matrix:</strong>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#334155', lineHeight: '1.5', fontWeight: '500' }}><LatexText text={q.explanation} /></p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // --- 📁 EXCLUSIVE ADMIN WORKSPACE: ROUTING TREE DEPLOYMENT ---
  if (view === 'admin-push-cloud') {
    const categoriesList = Array.from(new Set(cloudMockTestsPool.map(t => t.category_name)))
      .filter(name => name && name !== 'AI Lab Generated');
    const seriesList = selectedMoveCategory ? Array.from(new Set(cloudMockTestsPool.filter(t => t.category_name === selectedMoveCategory && t.series_name).map(t => t.series_name))) : [];
    const subSectionsList = (selectedMoveCategory && selectedMoveSeries) ? Array.from(new Set(cloudMockTestsPool.filter(t => t.category_name === selectedMoveCategory && t.series_name === selectedMoveSeries && t.sub_section).map(t => t.sub_section))) : [];

    const handlePublishToOfficialCloud = async () => {
      if (!renamedTitle.trim() || !selectedMoveCategory || !selectedMoveSeries || !selectedMoveSection) {
        alert("Bhai, Category, Series branch, aur Section tab paths specified hone mandatory hain!");
        return;
      }
      
      const cloudTestId = 'MOCK_MOVED_' + Date.now();
      setLoading(true);

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

        alert(`Success: Test "${renamedTitle.trim()}" is now live inside the official path layout matrix! 🔥`);
        setView('selection');
      } catch (err) {
        console.error("Cloud push failed:", err);
        alert("Database Matrix failure while uploading current configurations packet data.");
      } finally {
        setLoading(false);
      }
    };

    return (
      <div style={formWrapper}>
        <div style={formCard}>
          <h2 style={{ color: '#000000', marginBottom: '5px', fontWeight: '900' }}>📁 Deploy to Official Series</h2>
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
    );
  }

  return null;
};

// --- STYLES SCHEMA ---
const containerStyle = { padding: '40px 20px', maxWidth: '1050px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }; 
const selectionGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginTop: '35px' }; 
const cardHeaderRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '20px' };
const leftCardTitle = { margin: '0 0 16px 0', fontSize: '1.5rem', color: '#0f172a', fontWeight: '800', letterSpacing: '-0.5px' };
const cleanBulletList = { listStyleType: 'none', padding: 0, margin: '0 0 35px 0', display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', flex: 1 };
const bulletItemRow = { display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '0.92rem', color: '#475569', fontWeight: '500', lineHeight: '1.5' };
const fullMockCardStyle = { background: '#ffffff', padding: '35px', borderRadius: '24px', border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', boxShadow: '0 4px 20px rgba(79, 70, 229, 0.03)' };
const indigoIconFrame = { width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e0e7ff', border: '1px solid #c7d2fe' };
const indigoBadge = { background: '#e0e7ff', color: '#4f46e5', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.2px' };
const indigoActionBtn = { border: 'none', color: '#fff', padding: '12px 24px', borderRadius: '12px', fontWeight: '700', fontSize: '0.92rem', cursor: 'pointer', transition: '0.2s', width: '100%', background: '#4f46e5', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.15)' };
const topicMockCardStyle = { background: '#ffffff', padding: '35px', borderRadius: '24px', border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', boxShadow: '0 4px 20px rgba(16, 185, 129, 0.03)' };
const emeraldIconFrame = { width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#d1fae5', border: '1px solid #a7f3d0' };
const emeraldBadge = { background: '#d1fae5', color: '#065f46', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.2px' };
const emeraldActionBtn = { border: 'none', color: '#fff', padding: '12px 24px', borderRadius: '12px', fontWeight: '700', fontSize: '0.92rem', cursor: 'pointer', transition: '0.2s', width: '100%', background: '#10b981', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)' };
const actionBtn = { border: 'none', color: '#fff', padding: '11px 24px', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', transition: '0.2s', width: '100%' }; const formWrapper = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', padding: '20px', background: '#ffffff', fontFamily: 'Inter, sans-serif' }; const formCard = { background: '#fff', padding: '35px', borderRadius: '24px', border: '1px solid #e2e8f0', width: '100%', maxWidth: '620px', boxShadow: '0 10px 30px rgba(0,0,0,0.01)' }; const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }; const miniLabel = { display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: '#475569', marginBottom: '6px', textTransform: 'uppercase' }; const inputStyle = { width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.95rem', outline: 'none', marginBottom: '15px', background: '#f8fafc', fontWeight: '600', color: '#000000', boxSizing: 'border-box' }; const flexRow = { display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '5px' }; const nestedBox = { background: '#f8fafc', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '20px' }; const addSecBtn = { width: '100%', padding: '10px', background: '#000000', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }; const secBadgeRow = { display: 'flex', justifyContent: 'space-between', background: '#fff', padding: '10px 15px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: '600' }; const cancelBtn = { padding: '12px 24px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer' }; const summaryVaultBox = { background: '#f8fafc', border: '1px solid #e2e8f0', padding: '20px', borderRadius: '16px', textAlign: 'left', margin: '20px 0 30px 0' }; const sumLine = { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.9rem', fontWeight: '500' }; const modeToggleRow = { display: 'flex', gap: '10px', background: '#f1f5f9', padding: '5px', borderRadius: '12px', marginBottom: '15px' }; const modeBtn = { flex: 1, padding: '10px', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem', transition: '0.3s' };

export default AiTests;