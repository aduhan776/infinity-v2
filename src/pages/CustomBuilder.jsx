import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; 

const CustomBuilder = ({ onStartTest }) => {
  const [createdTests, setCreatedTests] = useState([]);
  const [cloudMockTestsPool, setCloudMockTestsPool] = useState([]);
  const [activeMoveTestId, setActiveMoveTestId] = useState(null);
  
  // --- SELECTED PATH MATRIX FOR MOVING TO CLOUD ---
  const [selectedMoveCategory, setSelectedMoveCategory] = useState('');
  const [selectedMoveSeries, setSelectedMoveSeries] = useState('');
  const [selectedMoveSection, setSelectedMoveSection] = useState('');

  // Test Meta States
  const [testTitle, setTestTitle] = useState('');
  const [testTime, setTestTime] = useState(''); 
  const [testStructure, setTestStructure] = useState('Simple'); 
  const [hasSectionalTiming, setHasSectionalTiming] = useState(false);

  // --- SECTION MANAGER STATES ---
  const [sectionsList, setSectionsList] = useState([]); 
  const [secNameInput, setSecNameInput] = useState('');
  const [secTimeInput, setSecTimeInput] = useState('');
  const [targetSectionIdx, setTargetSectionIdx] = useState(0);

  // --- SIMPLE TEST QUESTIONS ACCUMULATOR ---
  const [flatQuestionsList, setFlatQuestionsList] = useState([]);
  
  // --- EDITING MODE TRACKER STATE ---
  const [editingIdx, setEditingIdx] = useState(null); 

  // Current Active Question Input States
  const [currentQType, setCurrentQType] = useState('Objective');
  const [currentQText, setCurrentQText] = useState('');
  const [currentOptions, setCurrentOptions] = useState(['', '', '', '']);
  const [currentCorrectOpt, setCurrentCorrectOpt] = useState(0);
  const [customMarks, setCustomMarks] = useState('2.0');
  const [customNeg, setCustomNeg] = useState('0.66');

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
      console.error("Failed to sync builder path matrix trees:", err);
    }
  };

  useEffect(() => {
    const savedHandmade = JSON.parse(localStorage.getItem('infinity_handmade_tests')) || [];
    setCreatedTests(savedHandmade);
    fetchCloudDatabaseTree();
  }, []);

  // --- DYNAMIC RESOLUTION EXTRACTORS FOR CLOUD MOVING PATHS ---
  const getUniqueCategories = () => {
    return Array.from(new Set(cloudMockTestsPool.map(t => t.category_name)))
      .filter(name => name && name !== 'AI Lab Generated');
  };

  const getSeriesForSelectedCategory = () => {
    if (!selectedMoveCategory) return [];
    return Array.from(new Set(cloudMockTestsPool
      .filter(t => t.category_name === selectedMoveCategory && t.series_name)
      .map(t => t.series_name)
    ));
  };

  const getSectionsForSelectedSeries = () => {
    if (!selectedMoveCategory || !selectedMoveSeries) return [];
    return Array.from(new Set(cloudMockTestsPool
      .filter(t => t.category_name === selectedMoveCategory && t.series_name === selectedMoveSeries && t.sub_section)
      .map(t => t.sub_section)
    ));
  };

  // --- LOAD QUESTION INTO FIELDS FOR EDITING ---
  const loadQuestionForEdit = (idx) => {
    const qList = testStructure === 'Simple' ? flatQuestionsList : (sectionsList[targetSectionIdx]?.questions || []);
    const q = qList[idx];
    if (!q) return;

    setEditingIdx(idx);
    setCurrentQType(q.type);
    setCurrentQText(q.question);
    if (q.type === 'Objective') {
      setCurrentOptions([...q.options]);
      setCurrentCorrectOpt(q.correct);
    }
    setCustomMarks(q.marks.replace('+', ''));
    setCustomNeg(q.neg.replace('-', ''));
  };

  // --- ADD NEW SECTION ---
  const handleAddSection = () => {
    if (!secNameInput.trim() || !secTimeInput) {
      alert("Please provide both a Section Name and Duration time values.");
      return;
    }
    const newSection = {
      name: secNameInput.trim(),
      time: parseInt(secTimeInput),
      questions: []
    };
    setSectionsList([...sectionsList, newSection]);
    setSecNameInput('');
    setSecTimeInput('');
  };

  // --- SAVE OR UPDATE INDIVIDUAL QUESTION ---
  const handleAddQuestion = () => {
    if (!currentQText.trim()) {
      alert("Question statement content field cannot be blank.");
      return;
    }
    if (currentQType === 'Objective' && currentOptions.some(opt => !opt.trim())) {
      alert("All four multiple choice fields must be completed.");
      return;
    }

    const questionObj = {
      id: editingIdx !== null ? editingIdx : (testStructure === 'Simple' ? flatQuestionsList.length : (sectionsList[targetSectionIdx]?.questions.length || 0)),
      type: currentQType,
      question: currentQText,
      options: currentQType === 'Objective' ? [...currentOptions] : [],
      correct: currentQType === 'Objective' ? currentCorrectOpt : null,
      marks: `+${parseFloat(customMarks || 0).toFixed(1)}`,
      neg: `-${parseFloat(customNeg || 0).toFixed(2)}`
    };

    if (testStructure === 'Simple') {
      if (editingIdx !== null) {
        const updated = [...flatQuestionsList];
        updated[editingIdx] = questionObj;
        setFlatQuestionsList(updated);
      } else {
        setFlatQuestionsList([...flatQuestionsList, questionObj]);
      }
    } else {
      if (sectionsList.length === 0) {
        alert("Please create at least one structural section component folder above first.");
        return;
      }
      const updatedSections = [...sectionsList];
      if (editingIdx !== null) {
        updatedSections[targetSectionIdx].questions[editingIdx] = questionObj;
      } else {
        updatedSections[targetSectionIdx].questions.push(questionObj);
      }
      setSectionsList(updatedSections);
    }
    
    setEditingIdx(null);
    setCurrentQText('');
    setCurrentOptions(['', '', '', '']);
    setCurrentCorrectOpt(0);
  };

  // --- COMPILE & PUBLISH TEST LOCAL STORAGE SNAPSHOT ---
  const handlePublishTest = () => {
    if (!testTitle.trim()) {
      alert("Please supply an evaluation mock title configuration.");
      return;
    }

    let newCustomTest = {
      id: 'handmade_' + Date.now(),
      title: testTitle,
    };

    if (testStructure === 'Simple') {
      if (!testTime) { alert("Please provide flat time duration configurations."); return; }
      if (flatQuestionsList.length === 0) { alert("Add at least one question structure node into the bundle."); return; }
      
      newCustomTest.time = parseInt(testTime);
      newCustomTest.questions = flatQuestionsList.length;
      newCustomTest.questions_list = flatQuestionsList;
    } else {
      if (sectionsList.length === 0) { alert("Sectional blueprints require at least one active component partition."); return; }
      const totalQuestionsCount = sectionsList.reduce((acc, sec) => acc + sec.questions.length, 0);
      const totalTestTime = sectionsList.reduce((acc, sec) => acc + sec.time, 0);
      
      if (totalQuestionsCount === 0) { alert("Please add at least one question card inside any section tab."); return; }

      newCustomTest.time = totalTestTime;
      newCustomTest.questions = totalQuestionsCount;
      newCustomTest.hasSectionalTiming = hasSectionalTiming;
      newCustomTest.sections = sectionsList; 
    }

    const updatedTests = [newCustomTest, ...createdTests];
    setCreatedTests(updatedTests);
    localStorage.setItem('infinity_handmade_tests', JSON.stringify(updatedTests));

    setTestTitle('');
    setTestTime('');
    setSectionsList([]);
    setFlatQuestionsList([]);
    setEditingIdx(null);
    alert("Success: Custom configuration compiled into your offline workspace storage!");
  };

  // --- 🎯 CLOUD MOVE PIPELINE ---
  const handleMoveToOfficialSeries = async (testObj) => {
    if (!selectedMoveCategory || !selectedMoveSeries || !selectedMoveSection) {
      alert("Please ensure Category, Series, and Section paths are fully specified.");
      return;
    }

    const cloudTestId = 'MOCK_MOVED_' + Date.now();
    
    try {
      const { error } = await supabase
        .from('mock_tests')
        .insert([
          {
            id: cloudTestId,
            category_name: selectedMoveCategory,
            series_name: selectedMoveSeries,
            sub_section: selectedMoveSection,
            title: testObj.title,
            questions: parseInt(testObj.questions),
            time: parseInt(testObj.time),
            sections: testObj.sections || null, 
            questions_list: testObj.questions_list || null, 
            has_sectional_timing: testObj.hasSectionalTiming || false
          }
        ]);

      if (error) throw error;

      const updatedCustomVault = createdTests.filter(t => t.id !== testObj.id);
      setCreatedTests(updatedCustomVault);
      localStorage.setItem('infinity_handmade_tests', JSON.stringify(updatedCustomVault));

      setActiveMoveTestId(null);
      setSelectedMoveCategory('');
      setSelectedMoveSeries('');
      setSelectedMoveSection('');
      fetchCloudDatabaseTree();
      
      alert(`Success: Test "${testObj.title}" is now live inside the official path layout matrix!`);
    } catch (err) {
      console.error("Cloud alignment migration breakdown:", err);
      alert("Database Error: Failed to transmit test packet configurations onto the cloud.");
    }
  };

  const handleDeleteTest = (id) => {
    if (window.confirm("Are you sure you want to delete this custom blueprint configuration?")) {
      const updated = createdTests.filter(t => t.id !== id);
      setCreatedTests(updated);
      localStorage.setItem('infinity_handmade_tests', JSON.stringify(updated));
    }
  };

  const totalSectionalQuestions = sectionsList.reduce((acc, sec) => acc + sec.questions.length, 0);
  const categoriesList = getUniqueCategories();
  const seriesList = getSeriesForSelectedCategory();
  const sectionsListDropdown = getSectionsForSelectedSeries();

  return (
    <div style={containerStyle}>
      <header style={{ marginBottom: '40px' }}>
        <h1 style={{ fontSize: '2.4rem', fontWeight: '900', color: '#0f172a', margin: 0, letterSpacing: '-0.5px' }}>Custom Test Builder</h1>
        <p style={{ color: '#64748b', marginTop: '4px', fontWeight: '500' }}>Design personalized evaluation items, question sets, and custom sectional blueprints.</p>
      </header>

      <div style={workspaceGrid}>
        
        {/* LEFT COLUMN STACK: VAULT SYSTEM (TOP) & BLUEPRINT PARAMETERS (BOTTOM) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          
          {/* [TOP LEFT] OFFLINE BUILT TEST VAULT CONTAINER */}
          <div style={cardStyle}>
            <h3 style={{ marginBottom: '20px', color: '#0f172a', fontWeight: '900', fontSize: '1.15rem' }}>Offline Built Test Vault</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
              {createdTests.map(test => (
                <div key={test.id} style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: '#ffffff', padding: '18px 22px', borderRadius: '20px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ margin: '0 0 4px 0', color: '#0f172a', fontWeight: '900', fontSize: '1.1rem' }}>{test.title}</h4>
                      <span style={{ fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.5px' }}>
                        {test.sections ? `Sectional Model Blueprint` : 'Flat Single Paper Module'}
                      </span>
                      <p style={{ margin: '6px 0 0 0', fontSize: '0.85rem', color: '#475569', fontWeight: '600' }}>
                        Time Allotted: {test.time} Mins | Scale Size: {test.questions} Questions
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => onStartTest(test)} style={runTestBtnStyle}>Launch</button>
                      <button onClick={() => handleDeleteTest(test.id)} style={delBtnStyle}>Delete</button>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '12px', marginTop: '4px' }}>
                    {activeMoveTestId === test.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <p style={{ fontSize: '0.75rem', fontWeight: '800', color: '#000000', margin: 0, textTransform: 'uppercase' }}>Specify Target Route Allocation Parameters:</p>
                        
                        <div>
                          <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#475569' }}>1. Main Exam Category Folder</label>
                          <select style={{ ...inputStyle, margin: 0, padding: '8px' }} value={selectedMoveCategory} onChange={e => { setSelectedMoveCategory(e.target.value); setSelectedMoveSeries(''); setSelectedMoveSection(''); }}>
                            <option value="">-- Select Existing Category --</option>
                            {categoriesList.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                          </select>
                        </div>

                        {selectedMoveCategory && (
                          <div>
                            <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#475569' }}>2. Target Test Series Branch</label>
                            <select style={{ ...inputStyle, margin: 0, padding: '8px' }} value={selectedMoveSeries} onChange={e => { setSelectedMoveSeries(e.target.value); setSelectedMoveSection(''); }}>
                              <option value="">-- Select Series --</option>
                              {seriesList.map(ser => <option key={ser} value={ser}>{ser}</option>)}
                            </select>
                          </div>
                        )}

                        {selectedMoveCategory && selectedMoveSeries && (
                          <div>
                            <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#475569' }}>3. Target Section Tab Placement</label>
                            <select style={{ ...inputStyle, margin: 0, padding: '8px' }} value={selectedMoveSection} onChange={e => setSelectedMoveSection(e.target.value)}>
                              <option value="">-- Select Section Tab Layer --</option>
                              {sectionsListDropdown.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                            </select>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '8px', marginTop: '5px' }}>
                          <button onClick={() => { setActiveMoveTestId(null); setSelectedMoveCategory(''); setSelectedMoveSeries(''); setSelectedMoveSection(''); }} style={{ padding: '8px 14px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer', flex: 1 }}>Cancel</button>
                          <button onClick={() => handleMoveToOfficialSeries(test)} style={{ padding: '8px 14px', background: '#000000', color: '#ffffff', border: 'none', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '800', cursor: 'pointer', flex: 1.4 }}>Transmit To Cloud Matrix</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setActiveMoveTestId(test.id); setSelectedMoveCategory(''); setSelectedMoveSeries(''); setSelectedMoveSection(''); }} style={moveCloudTriggerBtnStyle}>Move to Official Test Series Structure →</button>
                    )}
                  </div>

                </div>
              ))}
              {createdTests.length === 0 && (
                <p style={{ textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', padding: '30px 0', fontSize: '0.88rem', fontWeight: '600' }}>Your personal builder vault database is empty.</p>
              )}
            </div>
          </div>

          {/* [BOTTOM LEFT] TEST BLUEPRINT PARAMETERS BOX */}
          <div style={cardStyle}>
            <h3 style={{ marginBottom: '20px', color: '#000000', fontWeight: '900', fontSize: '1.15rem' }}>1. Test Blueprint Setup</h3>
            
            <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>Mock Test Title</label>
                <input style={inputStyle} placeholder="e.g. Advanced Mock Assessment 01" value={testTitle} onChange={e => setTestTitle(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Structure Architecture</label>
                <select style={{...inputStyle, padding:'11px'}} value={testStructure} onChange={e => { setTestStructure(e.target.value); setEditingIdx(null); }}>
                  <option value="Simple">Simple Flat Paper</option>
                  <option value="Sectional">Sectional Component Paper</option>
                </select>
              </div>
            </div>

            {testStructure === 'Sectional' && (
              <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '16px', border: '1px dashed #000000', marginBottom: '5px' }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#000000', fontWeight: '800' }}>Initialize Sectional Folders</h4>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <input style={{...inputStyle, margin:0}} placeholder="Section Name" value={secNameInput} onChange={e => setSecNameInput(e.target.value)} />
                  <input style={{...inputStyle, margin:0, width:'120px'}} type="number" placeholder="Mins" value={secTimeInput} onChange={e => setSecTimeInput(e.target.value)} />
                  <button onClick={handleAddSection} style={{...monochromeControlActionBtn, padding:'0 20px', borderRadius:'10px', background:'#000000', color:'#fff'}}>Add Node</button>
                </div>
                
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                  {sectionsList.map((sec, idx) => (
                    <span key={idx} style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 'bold', color: '#0f172a' }}>
                      {sec.name} ({sec.time}m) • <b>{sec.questions.length} Qs</b>
                    </span>
                  ))}
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold', color: '#000000' }}>
                  <input type="checkbox" checked={hasSectionalTiming} onChange={e => setHasSectionalTiming(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: '#000000' }} />
                  Enforce Strict Sectional Timing Counts?
                </label>
              </div>
            )}

            {testStructure === 'Simple' && (
              <div>
                <label style={labelStyle}>Total Duration (Minutes)</label>
                <input style={inputStyle} type="number" placeholder="e.g. 120" value={testTime} onChange={e => setTestTime(e.target.value)} />
              </div>
            )}
          </div>

        </div>

        {/* [RIGHT COLUMN] QUESTIONS COMPILATION PANEL AND SAVING LOGS */}
        <div style={cardStyle}>
          <h3 style={{ marginBottom: '20px', color: '#000000', fontWeight: '900', fontSize: '1.15rem' }}>2. Questions Compilation</h3>
          
          <div style={questionBuilderBox}>
            <div style={{ marginBottom: '18px' }}>
              <label style={labelStyle}>Questions Deployed In This Active Configuration:</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', background: '#fff', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', minHeight: '46px', alignItems: 'center' }}>
                {(testStructure === 'Simple' ? flatQuestionsList : (sectionsList[targetSectionIdx]?.questions || [])).map((_, qIdx) => (
                  <button
                    key={qIdx}
                    type="button"
                    onClick={() => loadQuestionForEdit(qIdx)}
                    style={{
                      padding: '5px 12px', borderRadius: '8px', border: '1px solid',
                      borderColor: editingIdx === qIdx ? '#000000' : '#cbd5e1',
                      background: editingIdx === qIdx ? '#000000' : '#f8fafc',
                      color: editingIdx === qIdx ? '#ffffff' : '#0f172a',
                      fontWeight: '800', cursor: 'pointer', fontSize: '0.8rem'
                    }}
                  >
                    Q{qIdx + 1}
                  </button>
                ))}
                {(testStructure === 'Simple' ? flatQuestionsList : (sectionsList[targetSectionIdx]?.questions || [])).length === 0 && (
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic', fontWeight: '500' }}>No questions compiled in this active array folder yet.</span>
                )}
                
                {editingIdx !== null && (
                  <button
                    type="button"
                    onClick={() => { setEditingIdx(null); setCurrentQText(''); setCurrentOptions(['', '', '', '']); setCurrentCorrectOpt(0); }}
                    style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #000000', background: '#ffffff', color: '#000000', fontWeight: '800', fontSize: '0.75rem', cursor: 'pointer', marginLeft: 'auto' }}
                  >
                    Exit Edit Mode
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderTop: '1px solid #f1f5f9', paddingTop: '15px' }}>
              <span style={{ fontWeight: '800', color: '#0f172a', fontSize: '0.9rem' }}>
                {editingIdx !== null ? `Modifying Question Component #${editingIdx + 1}` : `Assembling Question Component #${(testStructure === 'Simple' ? flatQuestionsList.length : (sectionsList[targetSectionIdx]?.questions.length || 0)) + 1}`}
              </span>
              <select style={selectStyle} value={currentQType} onChange={e => setCurrentQType(e.target.value)}>
                <option value="Objective">Objective (MCQ)</option>
                <option value="Subjective">Subjective (Theory)</option>
              </select>
            </div>

            {testStructure === 'Sectional' && (
              <div style={{ marginBottom: '15px' }}>
                <label style={labelStyle}>Target Blueprint Section Association</label>
                <select style={{...inputStyle, margin:0, padding:'10px'}} value={targetSectionIdx} onChange={e => { setTargetSectionIdx(parseInt(e.target.value)); setEditingIdx(null); }}>
                  {sectionsList.map((sec, idx) => (
                    <option key={idx} value={idx}>Target Folder: {sec.name}</option>
                  ))}
                  {sectionsList.length === 0 && <option value="0">Create a sectional configuration partition first.</option>}
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: '15px', marginBottom: '15px', background: '#fff', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Correct Response Score (+)</label>
                <input style={{ ...inputStyle, margin: 0, padding: '8px' }} type="number" step="0.5" value={customMarks} onChange={e => setCustomMarks(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Negative Penalty Penalty (-)</label>
                <input style={{ ...inputStyle, margin: 0, padding: '8px' }} type="number" step="0.01" value={customNeg} onChange={e => setCustomNeg(e.target.value)} disabled={currentQType === 'Subjective'} />
              </div>
            </div>

            <label style={labelStyle}>Question Content Statement Text</label>
            <textarea style={{ ...inputStyle, height: '75px', resize: 'none' }} placeholder="Type item question content string line context..." value={currentQText} onChange={e => setCurrentQText(e.target.value)} />

            {currentQType === 'Objective' && (
              <div>
                <label style={labelStyle}>Multiple Choice Matrix Layout Options</label>
                {currentOptions.map((opt, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                    <input type="radio" name="correct_opt" checked={currentCorrectOpt === idx} onChange={() => setCurrentCorrectOpt(idx)} style={{ cursor: 'pointer', width: '18px', height: '18px', accentColor: '#000000' }} />
                    <input style={{ ...inputStyle, margin: 0 }} placeholder={`Option Label ${String.fromCharCode(65 + idx)}`} value={opt} onChange={e => {
                      const updated = [...currentOptions]; updated[idx] = e.target.value; setCurrentOptions(updated);
                    }} />
                  </div>
                ))}
              </div>
            )}

            <button onClick={handleAddQuestion} style={{...addQBtnStyle, background: '#000000', color: '#ffffff', fontWeight: '800'}}>
              {editingIdx !== null ? `Update Question Frame #${editingIdx + 1}` : 'Save Question to Selected Component Stack'}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '25px' }}>
            <span style={{ fontWeight: '800', color: '#0f172a', background: '#f1f5f9', padding: '10px 16px', borderRadius: '10px', fontSize: '0.85rem' }}>
              Cumulative Matrix Size: {testStructure === 'Simple' ? `${flatQuestionsList.length} Items` : `${totalSectionalQuestions} Items`}
            </span>
            <button onClick={handlePublishTest} style={monochromeControlActionBtn}>Compile and Displace Into Vault</button>
          </div>
        </div>

      </div>
    </div>
  );
};

// --- CORE MONOCHROME STYLING DICTIONARIES ---
const containerStyle = { padding: '20px 10px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'Inter, sans-serif' }; 
const workspaceGrid = { display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '30px', alignItems: 'start' }; 
const cardStyle = { background: '#fff', padding: '30px', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 15px rgba(0,0,0,0.005)' }; const labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: 'bold', color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }; const inputStyle = { width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '0.95rem', outline: 'none', marginBottom: '15px', background: '#f8fafc', fontWeight: '600', boxSizing: 'border-box' }; const selectStyle = { padding: '8px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer' }; const questionBuilderBox = { background: '#f8fafc', padding: '20px', borderRadius: '20px', border: '1px solid #e2e8f0' }; const addQBtnStyle = { width: '100%', padding: '12px', border: 'none', borderRadius: '12px', cursor: 'pointer', fontSize: '0.9rem', marginTop: '10px' }; const monochromeControlActionBtn = { padding: '12px 24px', background: '#000000', color: '#fff', border: 'none', borderRadius: '12px', fontWeight: '800', cursor: 'pointer' }; const runTestBtnStyle = { background: '#000000', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '0.85rem' }; const delBtnStyle = { background: '#ffffff', color: '#ef4444', border: '1px solid #fee2e2', padding: '8px 14px', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }; const moveCloudTriggerBtnStyle = { background: 'none', border: '1px solid #000000', padding: '6px 14px', borderRadius: '10px', fontSize: '0.78rem', fontWeight: '800', color: '#000000', cursor: 'pointer', width: '100%', textAlign: 'center' };

export default CustomBuilder;