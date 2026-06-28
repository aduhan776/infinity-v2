import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; 
import LatexText from '../components/LatexText'; 

// --- 🌐 LIGHTWEIGHT INLINE INDEXEDDB ENGINE FOR DEVICE STORAGE ---
const dbName = "InfinityLocalDB";

const initLibraryDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 2); // 🚨 BUMPED TO VERSION 2 FOR FORCED CACHE RESET
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

const getAllFromLocalStore = async (storeName) => {
  const db = await initLibraryDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
};

const deleteFromLocalStore = async (storeName, id) => {
  const db = await initLibraryDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
};

const Library = ({ onResumeTest, onViewAnalysis, onStartTest }) => {
  const [activeSubTab, setActiveSubTab] = useState('tests'); 
  const [testFilter, setTestFilter] = useState('attempted'); 
  const [selectedItem, setSelectedItem] = useState(null); 
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});

  // --- CORE LIBRARY DATA STATES ---
  const [savedQuestions, setSavedQuestions] = useState([]);
  const [savedTests, setSavedTests] = useState([]); 
  const [attemptedHistory, setAttemptedHistory] = useState([]); 

  // --- LOAD DATA ENGINE FROM OFFLINE STORAGE NODES ---
  const loadLibraryData = async () => {
    try {
      // 1. Fetch Saved Questions direct from IndexedDB Offline Store
      const localQuestions = await getAllFromLocalStore("saved_questions");
      const sortedQuestions = localQuestions.sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
      setSavedQuestions(sortedQuestions);

      // 2. Fetch Centralized Test Sessions from IndexedDB Offline Store
      const localSessions = await getAllFromLocalStore("test_sessions");
      const { data: masterTests } = await supabase.from('mock_tests').select('*');

      const cloudTestsMap = {};
      if (masterTests) {
        masterTests.forEach(m => { cloudTestsMap[m.id] = m; });
      }

      // Parse and map Submitted Tests History
      const historyRows = localSessions
        .filter(row => row.status === 'submitted')
        .map(row => {
          const cloudMatch = cloudTestsMap[row.test_id] || {};
          const rawAccuracy = row.accuracy;
          const formattedAccuracy = rawAccuracy 
            ? (String(rawAccuracy).includes('%') ? rawAccuracy : `${rawAccuracy}%`)
            : "0%";

          return {
            id: row.test_id,
            attemptId: row.id,
            title: row.title,
            score: row.score || "Analyzing...",
            accuracy: formattedAccuracy,
            date: row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : "Recent",
            timeLeft: row.time_left,
            rawSeconds: row.raw_seconds,
            answers: row.answers || {},
            uploads: row.uploads || {},
            timeTracker: row.time_tracker || {},
            questions: cloudMatch.questions_list || [],
            questions_list: cloudMatch.questions_list || [],
            sections: cloudMatch.sections || null,
            hasSectionalTiming: cloudMatch.has_sectional_timing || false,
            mode: cloudMatch.category_name || "Standard",
            time: cloudMatch.time || 180,
            createdAt: row.created_at || 0 
          };
        });

      // Parse and map Paused Draft Snapshots
      const draftRows = localSessions
        .filter(row => row.status === 'draft')
        .map(row => {
          const cloudMatch = cloudTestsMap[row.test_id] || {};
          return {
            id: row.test_id, 
            title: row.title,
            lastIndex: row.last_index || 0,
            timeLeft: row.time_left || 0,
            rawSeconds: row.raw_seconds,
            date: row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : "Recent",
            answers: row.answers || {},
            uploads: row.uploads || {},
            timeTracker: row.time_tracker || {},
            markedForReview: [],
            questions: cloudMatch.questions_list || [],
            questions_list: cloudMatch.questions_list || [],
            sections: cloudMatch.sections || null,
            hasSectionalTiming: cloudMatch.has_sectional_timing || false,
            mode: cloudMatch.category_name || "Standard",
            time: cloudMatch.time || 180,
            createdAt: row.created_at || 0
          };
        });

      setAttemptedHistory(historyRows.sort((a, b) => b.createdAt - a.createdAt));
      setSavedTests(draftRows.sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      console.error("Local database retrieval system failure:", err);
    }
  };

  useEffect(() => {
    loadLibraryData();
    window.addEventListener('focus', loadLibraryData);
    return () => window.removeEventListener('focus', loadLibraryData);
  }, []);

  const groupedAttempts = React.useMemo(() => {
    const groups = {};
    attemptedHistory.forEach(test => {
      const groupKey = test.id || test.title;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          id: test.id,
          title: test.title,
          isAi: test.id && (String(test.id).startsWith('INF-AI') || String(test.id).startsWith('AI-') || String(test.id).startsWith('ai_')),
          isSectional: !!test.sections || (test.mode && test.mode.includes('Sectional')),
          attempts: []
        };
      }
      groups[groupKey].attempts.push(test);
    });
    return Object.values(groups);
  }, [attemptedHistory]);

  const handleShareTest = (test) => {
    try {
      if (!test?.id) return alert("Execution Error: Test Identifier could not be resolved.");
      const shareUrl = `${window.location.origin}?testId=${test.id}`;
      navigator.clipboard.writeText(shareUrl).then(() => {
        alert("Success: Assessment invitation link copied to clipboard successfully.");
      }).catch(() => {
        prompt("Copy Notification: Clipboard fallback generated string:", shareUrl);
      });
    } catch (err) {
      alert("System error mapping invitation string tokens.");
    }
  };

  const handleRemove = async (id, category, attemptId = null) => {
    if (category === 'questions') {
      if (window.confirm("Bhai, kya tu sach mein is question ko offline library se delete karna chahta hai?")) {
        try {
          await deleteFromLocalStore("saved_questions", id);
          setSavedQuestions(savedQuestions.filter(item => item.id !== id));
          if (selectedItem && selectedItem.id === id) setSelectedItem(null);
          alert("Success: Question record removed from device storage successfully!");
        } catch (err) {
          alert("Delete Failure: Hardware IO error.");
        }
      }
      return;
    }

    if (category === 'history') {
      if (window.confirm("Bhai, kya tu sach mein is test history record ko device memory se permanently mitaana chahta hai?")) {
        try {
          await deleteFromLocalStore("test_sessions", attemptId);
          setAttemptedHistory(attemptedHistory.filter(item => item.attemptId !== attemptId));
          if (selectedItem && selectedItem.attemptId === attemptId) setSelectedItem(null);
          alert("Success: Evaluation record permanently erased.");
        } catch (err) {
          alert("Delete Failure: Storage node link breakdown.");
        }
      }
      return;
    }

    if (category === 'drafts') {
      if (window.confirm("Bhai, is paused draft snapshot ko device memory se discard karna hai?")) {
        try {
          await deleteFromLocalStore("test_sessions", id);
          setSavedTests(savedTests.filter(item => item.id !== id));
          if (selectedItem && selectedItem.id === id) setSelectedItem(null);
          alert("Success: Draft snapshot discarded safely.");
        } catch (err) {
          alert("Delete Failure: Storage configuration error.");
        }
      }
      return;
    }
  };

  const toggleGroupDropdown = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <div style={libContainer}>
      <div style={privacyNoticeBanner}>
        <div style={privacyIconFrame}>🛡️</div>
        <div style={{ textAlign: 'left' }}>
          <strong style={{ color: '#0f172a', display: 'block', fontSize: '0.92rem', fontWeight: '800' }}>Local Device Privacy Protection Active</strong>
          <span style={{ color: '#475569', fontSize: '0.84rem', fontWeight: '600', lineHeight: '1.4' }}>
            Aapke saare test sessions aur saved questions direct aapke browser local storage (IndexedDB) mein saved hain, hamare central database mein nahi. Your data stays 100% offline.
          </span>
        </div>
      </div>

      {selectedItem && selectedItem.question && (
        <div style={modalOverlay} onClick={() => setSelectedItem(null)}>
          <div style={modalContent} onClick={e => e.stopPropagation()}>
            <div style={modalHeader}>
              <span style={subjectTagSmall}>{selectedItem.topic || 'Saved Question'}</span>
              <button style={closeBtn} onClick={() => setSelectedItem(null)}>✕</button>
            </div>
            <div style={modalBody}>
              <h2 style={modalQText}><LatexText text={selectedItem.question} /></h2>
              <div style={correctAnswerBox}>Verified Correct Response: {selectedItem.answer}</div>
              <div style={explanationBoxModal}>
                <strong style={{display: 'block', marginBottom: '8px', color: '#000000'}}>Conceptual Solution Framework:</strong>
                <p style={{fontSize: '0.95rem', color: '#334155', lineHeight: '1.6', margin: 0}}><LatexText text={selectedItem.explanation || "No explanation provided."} /></p>
              </div>
            </div>
            <div style={modalFooter}>
              <p style={{fontSize: '0.75rem', color: '#94a3b8', margin: 0}}>Device Storage Vault Ref: {selectedItem.id}</p>
            </div>
          </div>
        </div>
      )}

      <header style={libHeader}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end'}}>
          <div>
            <h1 style={{color: '#1e293b', marginBottom: '5px', fontSize: '2.2rem', fontWeight: '900', letterSpacing: '-0.5px'}}>Academic Library</h1>
            <p style={{color: '#64748b', fontWeight: '600', fontSize: '0.92rem'}}>Manage your personalized workspace and secure question vaults.</p>
          </div>
          <div style={searchWrapper}>
            <input type="text" placeholder={`Search fields in ${activeSubTab}...`} style={searchField} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
        </div>
      </header>

      <div style={tabRow}>
        {['tests', 'questions'].map(tab => (
           <button key={tab} onClick={() => { setActiveSubTab(tab); setSearchQuery(''); }} style={{...tabStyle, color: activeSubTab === tab ? '#000000' : '#94a3b8', borderBottom: activeSubTab === tab ? '3px solid #000000' : 'none'}}>{tab === 'tests' ? "TEST SESSIONS" : tab.toUpperCase()}</button>
        ))}
      </div>

      <div style={contentArea}>
        {activeSubTab === 'questions' && (
          <div style={verticalList}>
            {savedQuestions.filter(q => q.question.toLowerCase().includes(searchQuery.toLowerCase())).map(q => (
              <div key={q.id} style={{...itemCard, borderLeft: '5px solid #000000', cursor: 'pointer'}} onClick={() => setSelectedItem(q)}>
                <div style={{flex: 1}}><h4 style={{...itemTitle, fontSize: '0.95rem'}}><LatexText text={q.question} /></h4></div>
                <button onClick={(e) => { e.stopPropagation(); handleRemove(q.id, 'questions', null); }} style={{...actionBtn, color: '#ef4444', borderColor: '#fee2e2'}}>Remove</button>
              </div>
            ))}
            {savedQuestions.length === 0 && <p style={emptyStateText}>No questions saved in library vault yet.</p>}
          </div>
        )}

        {activeSubTab === 'tests' && (
          <div>
            <div style={testToggleRow}>
              <button onClick={() => setTestFilter('attempted')} style={{...testToggleBtn, background: testFilter === 'attempted' ? '#000000' : '#f1f5f9', color: testFilter === 'attempted' ? '#fff' : '#475569'}}>Evaluation History</button>
              <button onClick={() => setTestFilter('saved')} style={{...testToggleBtn, background: testFilter === 'saved' ? '#000000' : '#f1f5f9', color: testFilter === 'saved' ? '#fff' : '#475569'}}>Paused Draft Snapshots</button>
            </div>
            
            <div style={verticalList}>
              {testFilter === 'attempted' ? (
                groupedAttempts.filter(g => g.title.toLowerCase().includes(searchQuery.toLowerCase())).map((group, i) => {
                  const isExpanded = !!expandedGroups[group.id || group.title];
                  const numericalScores = group.attempts.map(a => parseFloat(a.score) || 0);
                  const highestHistoricScore = Math.max(...numericalScores);
                  return (
                    <div key={group.id || i} style={{ display: 'flex', flexDirection: 'column', background: 'white', padding: '20px 25px', borderRadius: '20px', border: '1px solid #e2e8f0', gap: '15px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <h4 style={{ ...itemTitle, fontSize: '1.15rem' }}>{group.title}</h4>
                            {group.isAi && <span style={aiBadge}>AI Engine Built</span>}
                            {group.isSectional && <span style={secBadge}>Sectional</span>}
                          </div>
                          <p style={{ ...itemSubText, marginTop: '5px' }}>
                            Total Session Attempts: <b>{group.attempts.length} records</b> | Performance Peak: <b style={{color:'#000000'}}>{highestHistoricScore.toFixed(2)} M</b>
                          </p>
                        </div>
                        
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            onClick={() => {
                              const baseTest = group.attempts[0];
                              const testPayload = {
                                id: baseTest.id,
                                title: baseTest.title,
                                time: baseTest.time || 180, 
                                sections: baseTest.sections,
                                hasSectionalTiming: baseTest.hasSectionalTiming,
                                mode: baseTest.mode,
                                questions_list: baseTest.questions_list
                              };
                              onStartTest?.(testPayload);
                            }} 
                            style={{ ...actionBtn, background: '#000000', color: '#fff', border: 'none' }}
                          >
                            Reattempt Test
                          </button>
                          <button onClick={() => toggleGroupDropdown(group.id || group.title)} style={actionBtn}>
                            {isExpanded ? "Hide Analytics" : "View Attempt History"}
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '14px', border: '1px dashed #000000' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {group.attempts.map((attempt, idx) => (
                              <div key={attempt.attemptId || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '10px 15px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#475569' }}>
                                    Execution Run #{group.attempts.length - idx} ({attempt.date})
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                  <span style={{ fontSize: '0.88rem', fontWeight: '800', color: '#1e293b' }}>
                                    Score Evaluation: {attempt.score} M ({attempt.accuracy})
                                  </span>
                                  <button onClick={() => onViewAnalysis?.(attempt)} style={{ ...actionBtn, background: '#000000', color: '#fff', border: 'none' }}>Detailed Review</button>
                                  <button onClick={() => handleShareTest(attempt)} style={actionBtn}>Share</button>
                                  <button onClick={() => handleRemove(null, 'history', attempt.attemptId)} style={{ ...actionBtn, color: '#ef4444', borderColor: '#fee2e2' }}>Wipe Record</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                savedTests.filter(draft => draft.title.toLowerCase().includes(searchQuery.toLowerCase())).map(draft => (
                  <div key={draft.id} style={{...itemCard, borderLeft: '5px solid #000000'}}>
                    <div style={{...iconBox, background: '#f1f5f9'}}>⏳</div>
                    <div style={{flex: 1}}><h4 style={itemTitle}>{draft.title}</h4><p style={itemSubText}>Suspended at assessment position: Q{draft.lastIndex + 1} ({draft.timeLeft} mins left)</p></div>
                    <div style={{display: 'flex', gap: '10px'}}>
                       <button onClick={() => onResumeTest?.(draft)} style={{...actionBtn, background: '#000000', color: '#fff', border: 'none'}}>Resume Session</button>
                       <button onClick={() => handleRemove(draft.id, 'drafts', null)} style={{...actionBtn, color: '#ef4444', borderColor: '#fee2e2'}}>Discard Draft</button>
                    </div>
                  </div>
                ))
              )}
              {testFilter === 'attempted' && attemptedHistory.length === 0 && <p style={emptyStateText}>No logged diagnostic evaluations found.</p>}
              {testFilter === 'saved' && savedTests.length === 0 && <p style={emptyStateText}>No paused session draft snapshots found.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const libContainer = { padding: '40px', maxWidth: '950px', margin: '0 auto' }; const libHeader = { marginBottom: '40px' }; const searchWrapper = { width: '300px' }; const searchField = { width: '100%', padding: '12px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', outline: 'none', background: '#fff', fontSize: '0.9rem', fontWeight: '600' }; const tabRow = { display: 'flex', gap: '30px', borderBottom: '1px solid #e2e8f0', marginBottom: '30px' }; const tabStyle = { background: 'none', border: 'none', padding: '15px 10px', fontWeight: '800', cursor: 'pointer', fontSize: '0.95rem', textTransform: 'uppercase' }; const testToggleRow = { display: 'flex', gap: '15px', marginBottom: '20px' }; const testToggleBtn = { padding: '10px 20px', borderRadius: '10px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer' }; const contentArea = { minHeight: '400px' }; const verticalList = { display: 'flex', flexDirection: 'column', gap: '15px' }; const itemCard = { background: 'white', padding: '20px 25px', borderRadius: '20px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.01)' }; const iconBox = { width: '50px', height: '50px', background: '#f1f5f9', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }; const itemTitle = { margin: 0, fontSize: '1.05rem', color: '#1e293b', fontWeight: '800' }; const itemSubText = { margin: '6px 0 0 0', fontSize: '0.85rem', color: '#64748b', fontWeight: '600' }; const actionBtn = { padding: '9px 18px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontWeight: '800', fontSize: '0.8rem' }; const subjectTagSmall = { background: '#f1f5f9', color: '#000000', padding: '4px 12px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '900', border: '1px solid #e2e8f0' }; const modalOverlay = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }; const modalContent = { background: 'white', width: '90%', maxWidth: '650px', padding: '35px', borderRadius: '30px', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }; const closeBtn = { background: '#f1f5f9', border: 'none', width: '35px', height: '35px', borderRadius: '50%', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' }; const modalQText = { fontSize: '1.4rem', color: '#1e293b', padding: '15px 0 25px 0', fontWeight: '800', lineHeight: '1.4' }; const correctAnswerBox = { background: '#f8fafc', padding: '18px', borderRadius: '15px', color: '#000000', fontWeight: '900', marginBottom: '20px', border: '1px solid #e2e8f0' }; const explanationBoxModal = { padding: '22px', background: '#f8fafc', borderRadius: '20px', borderLeft: '5px solid #000000', border: '1px solid #e2e8f0' }; const modalHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '15px' }; const modalBody = { padding: '10px 0' }; const modalFooter = { borderTop: '1px solid #f1f5f9', paddingTop: '15px', marginTop: '15px' }; const emptyStateText = { textAlign: 'center', color: '#94a3b8', padding: '40px 0', fontSize: '0.9rem', fontWeight: '600', fontStyle: 'italic' }; const aiBadge = { fontSize: '0.72rem', background: '#f1f5f9', color: '#000000', padding: '3px 10px', borderRadius: '6px', fontWeight: '800', border: '1px solid #cbd5e1' }; const secBadge = { fontSize: '0.72rem', background: '#000000', color: '#ffffff', padding: '3px 10px', borderRadius: '6px', fontWeight: '800' };
const privacyNoticeBanner = { display: 'flex', gap: '15px', background: '#fafafb', border: '1px solid #e2e8f0', padding: '16px 20px', borderRadius: '16px', marginBottom: '30px', alignItems: 'center' };
const privacyIconFrame = { width: '40px', height: '40px', background: '#f1f5f9', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', fontSize: '1.2rem' };

export default Library;