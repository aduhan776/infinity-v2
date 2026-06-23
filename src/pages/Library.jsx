import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient'; 

// --- 🌐 LIGHTWEIGHT INLINE INDEXEDDB ENGINE FOR DEVICE STORAGE ---
const dbName = "NeuxentLibraryDB";
const storeName = "pdf_files";

const initLibraryDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

const saveFileToIndexedDB = async (id, fileData) => {
  const db = await initLibraryDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.put({ id, data: fileData });
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
};

const getFileFromIndexedDB = async (id) => {
  const db = await initLibraryDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(id);
    request.onsuccess = (e) => resolve(e.target.result?.data || null);
    request.onerror = (e) => reject(e.target.error);
  });
};

const deleteFileFromIndexedDB = async (id) => {
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
  const [activeSubTab, setActiveSubTab] = useState('documents');
  const [testFilter, setTestFilter] = useState('attempted'); 
  const [selectedItem, setSelectedItem] = useState(null); 
  const fileInputRef = useRef(null); 

  // --- CORE LIBRARY DATA STATES ---
  const [documents, setDocuments] = useState([]);
  const [savedQuestions, setSavedQuestions] = useState([]);
  const [savedTests, setSavedTests] = useState([]); 
  const [attemptedHistory, setAttemptedHistory] = useState([]); 
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});

  // --- 📂 NEW ACTIVE FOLDERING STATES ---
  const [folders, setFolders] = useState([]);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // --- LOAD DATA ENGINE ---
  const loadLibraryData = async () => {
    const savedDocs = JSON.parse(localStorage.getItem('infinity_docs')) || [
      { id: 1, title: "Laxmikanth Polity Notes", type: "PDF", date: "12 April", folderId: null },
      { id: 2, title: "My Ancient History Notes", type: "Note", date: "15 April", folderId: null }
    ];
    setDocuments(savedDocs);

    // Load local workspace folders configuration
    const savedFolders = JSON.parse(localStorage.getItem('infinity_folders')) || [];
    setFolders(savedFolders);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Fetch Saved Questions Cloud Vault array
        const { data: qData, error: qError } = await supabase
          .from('saved_questions')
          .select('*')
          .eq('user_id', user.id)
          .order('saved_at', { ascending: false });
        if (!qError && qData) setSavedQuestions(qData);

        // Fetch Centralized Test Sessions
        const { data: sData, error: sError } = await supabase
          .from('test_sessions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        const { data: masterTests } = await supabase.from('mock_tests').select('*');

        if (!sError && sData) {
          const cloudTestsMap = {};
          if (masterTests) {
            masterTests.forEach(m => { cloudTestsMap[m.id] = m; });
          }

          // Parse and map Submitted Tests
          const historyRows = sData
            .filter(row => row.status === 'submitted')
            .map(row => {
              const cloudMatch = cloudTestsMap[row.test_id] || {};
              return {
                id: row.test_id,
                attemptId: row.id,
                title: row.title,
                score: row.score || "Analyzing...",
                accuracy: row.accuracy || "0%",
                date: new Date(row.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
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
                time: cloudMatch.time || 180
              };
            });

          // Parse and map Paused Tests
          const draftRows = sData
            .filter(row => row.status === 'draft')
            .map(row => {
              const cloudMatch = cloudTestsMap[row.test_id] || {};
              return {
                id: row.test_id, 
                title: row.title,
                lastIndex: row.last_index || 0,
                timeLeft: row.time_left || 0,
                rawSeconds: row.raw_seconds,
                date: new Date(row.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
                answers: row.answers || {},
                uploads: row.uploads || {},
                timeTracker: row.time_tracker || {},
                markedForReview: [],
                questions: cloudMatch.questions_list || [],
                questions_list: cloudMatch.questions_list || [],
                sections: cloudMatch.sections || null,
                hasSectionalTiming: cloudMatch.has_sectional_timing || false,
                mode: cloudMatch.category_name || "Standard",
                time: cloudMatch.time || 180
              };
            });

          setAttemptedHistory(historyRows);
          setSavedTests(draftRows);
        }
      }
    } catch (err) {
      console.error("Library background sync error:", err);
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

  // --- CREATE NEW SUBJECT WORKSPACE FOLDER ---
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const newFolderObj = {
      id: 'folder_' + Date.now(),
      name: newFolderName.trim()
    };
    const updatedFolders = [...folders, newFolderObj];
    setFolders(updatedFolders);
    localStorage.setItem('infinity_folders', JSON.stringify(updatedFolders));
    setNewFolderName('');
    setShowFolderModal(false);
  };

  // --- DELETE FOLDER & CASCADES REMOVAL FOR ALL ITS NESTED STORAGE ITEMS ---
  const handleDeleteFolder = async (e, folderId) => {
    e.stopPropagation();
    if (window.confirm("Bhai, kya tu sach mein is subject folder ko iske saare files ke sath delete karna chahta hai?")) {
      const updatedFolders = folders.filter(f => f.id !== folderId);
      setFolders(updatedFolders);
      localStorage.setItem('infinity_folders', JSON.stringify(updatedFolders));

      // Reclaim memory space from IndexedDB for all targeted documents
      const targetedDocs = documents.filter(d => d.folderId === folderId);
      for (const doc of targetedDocs) {
        await deleteFileFromIndexedDB(doc.id).catch(console.error);
      }

      const updatedDocs = documents.filter(d => d.folderId !== folderId);
      setDocuments(updatedDocs);
      localStorage.setItem('infinity_docs', JSON.stringify(updatedDocs));

      if (currentFolderId === folderId) setCurrentFolderId(null);
    }
  };

  // --- DEVICE MEMORY SAVING HOOK (INDEXEDDB SE WIRE KIYA) ---
  const handleAddDocument = (e) => {
    const file = e.target.files[0];
    if (file && file.type === "application/pdf") {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const docId = Date.now();
          
          // Save file contents into IndexedDB to manage 500 MB constraints safely
          await saveFileToIndexedDB(docId, reader.result);

          const newDoc = {
            id: docId,
            title: file.name.replace(".pdf", ""),
            type: "PDF",
            date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
            folderId: currentFolderId // Pushes file directly inside the active subject segment
          };
          
          const updatedDocs = [...documents, newDoc];
          setDocuments(updatedDocs);
          localStorage.setItem('infinity_docs', JSON.stringify(updatedDocs));
        } catch (err) {
          console.error(err);
          alert("Storage Fault: Unable to write file payload onto browser storage nodes.");
        }
      };
      reader.readAsDataURL(file);
    } else {
      alert("Validation Error: Only PDF documents are permitted for upload.");
    }
    e.target.value = null; 
  };

  // --- FETCH FILE FROM BROWSERS HARD MEMORY NODES ---
  const openDocument = async (doc) => {
    try {
      const binaryDataStream = await getFileFromIndexedDB(doc.id);
      if (binaryDataStream) {
        const newTab = window.open();
        newTab.document.write(`<iframe src="${binaryDataStream}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
      } else {
        alert("Content Unavailable: File reference link is blank or missing binary fragments.");
      }
    } catch (err) {
      console.error(err);
      alert("Execution Error: Failed to fetch binary node streams from local sandbox memory.");
    }
  };

  const handleShareTest = (test) => {
    try {
      if (!test?.id) return alert("Execution Error: Test Identifier could not be resolved.");
      const shareUrl = `${window.location.origin}?testId=${test.id}`;
      navigator.clipboard.writeText(shareUrl).then(() => {
        alert("Success: Assessment invitation link copied to clipboard successfully.");
      }).catch(() => {
        prompt("Copy Notification: Automatic clipboard copy failed. Please manually copy the URL string:", shareUrl);
      });
    } catch (err) {
      alert("System Error: Something went wrong while generating the secure link layout.");
    }
  };

  const handleRemove = async (id, category, attemptId = null, title = null) => {
    if (category === 'questions') {
      if (window.confirm("Bhai, kya tu sach mein is question ko cloud vault se vaporize karna chahta hai?")) {
        try {
          const { error } = await supabase.from('saved_questions').delete().eq('id', id);
          if (error) throw error;
          setSavedQuestions(savedQuestions.filter(item => item.id !== id));
          if (selectedItem && selectedItem.id === id) setSelectedItem(null);
          alert("Success: Question record removed from cloud storage successfully!");
        } catch (err) {
          console.error(err);
          alert("Delete Failure: Database node error.");
        }
      }
      return;
    }

    if (category === 'history') {
      if (window.confirm("Bhai, test history record delete karna hai cloud aur local memory se?")) {
        try {
          const { error } = await supabase.from('test_sessions').delete().eq('id', attemptId);
          if (error) throw error;
          setAttemptedHistory(attemptedHistory.filter(item => item.attemptId !== attemptId));
          if (selectedItem && selectedItem.attemptId === attemptId) setSelectedItem(null);
          alert("Success: Evaluation record permanently erased.");
        } catch (err) {
          console.error(err);
          alert("Delete Failure: Cloud gateway response error.");
        }
      }
      return;
    }

    if (category === 'drafts') {
      if (window.confirm("Bhai, is paused draft snapshot ko discard karna hai cloud aur local memory se?")) {
        try {
          const { error } = await supabase.from('test_sessions').delete().eq('test_id', id).eq('status', 'draft');
          if (error) throw error;
          setSavedTests(savedTests.filter(item => item.id !== id));
          if (selectedItem && selectedItem.id === id) setSelectedItem(null);
          alert("Success: Draft snapshot discarded safely.");
        } catch (err) {
          console.error(err);
          alert("Delete Failure: Cloud connection fault.");
        }
      }
      return;
    }

    if (category === 'documents') {
      const updated = documents.filter(item => {
        const matchId = id && item.id && String(item.id).trim() === String(id).trim();
        const matchTitle = title && item.title && String(item.title).trim() === String(title).trim();
        if (matchId) {
          deleteFileFromIndexedDB(item.id).catch(console.error);
        }
        return !(matchId || matchTitle);
      });
      localStorage.setItem('infinity_docs', JSON.stringify(updated));
      setDocuments(updated);
      if (selectedItem && (selectedItem.id === id || selectedItem.title === title)) setSelectedItem(null);
    }
  };

  const toggleGroupDropdown = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // Filters out localized lists matching current configurations
  const filteredDocuments = documents.filter(d => {
    const matchesSearch = d.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFolder = d.folderId === currentFolderId;
    return matchesSearch && matchesFolder;
  });

  return (
    <div style={libContainer}>
      {selectedItem && selectedItem.question && (
        <div style={modalOverlay} onClick={() => setSelectedItem(null)}>
          <div style={modalContent} onClick={e => e.stopPropagation()}>
            <div style={modalHeader}>
              <span style={subjectTagSmall}>{selectedItem.topic || 'Saved Question'}</span>
              <button style={closeBtn} onClick={() => setSelectedItem(null)}>✕</button>
            </div>
            <div style={modalBody}>
              <h2 style={modalQText}>{selectedItem.question}</h2>
              <div style={correctAnswerBox}>Verified Correct Response: {selectedItem.answer}</div>
              <div style={explanationBoxModal}>
                <strong style={{display: 'block', marginBottom: '8px', color: '#000000'}}>Conceptual Solution Framework:</strong>
                <p style={{fontSize: '0.95rem', color: '#334155', lineHeight: '1.6', margin: 0}}>{selectedItem.explanation || "No explanation provided."}</p>
              </div>
            </div>
            <div style={modalFooter}>
              <p style={{fontSize: '0.75rem', color: '#94a3b8', margin: 0}}>Vault Resource ID: {selectedItem.id}</p>
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
        {['documents', 'questions', 'tests'].map(tab => (
           <button key={tab} onClick={() => { setActiveSubTab(tab); setSearchQuery(''); setCurrentFolderId(null); }} style={{...tabStyle, color: activeSubTab === tab ? '#000000' : '#94a3b8', borderBottom: activeSubTab === tab ? '3px solid #000000' : 'none'}}>{tab.toUpperCase()}</button>
        ))}
      </div>

      <div style={contentArea}>
        {activeSubTab === 'documents' && (
          <div style={verticalList}>
            
            {/* NAVIGATION HEADER FOR INTERNAL VIEWING LEVELS */}
            {currentFolderId !== null ? (
              <div style={folderBreadcrumbContainerRow}>
                <button type="button" onClick={() => setCurrentFolderId(null)} style={monochromeBackDirectoryBtn}>
                  ← Back to Folders List
                </button>
                <span style={activeFolderTitleBadge}>
                  Active Folder: {folders.find(f => f.id === currentFolderId)?.name || 'Subject Stream'}
                </span>
              </div>
            ) : (
              <div style={folderActionsHeaderMenuBar}>
                <button type="button" onClick={() => setShowFolderModal(true)} style={monochromeSolidDarkActionBtn}>
                  ➕ Create Subject Folder
                </button>
              </div>
            )}

            {/* RENDER LIST OF MAIN SYSTEM SUBJECT FOLDERS AT ROOT LEVEL VIEW */}
            {currentFolderId === null && (
              <div style={foldersFlexGridLayout}>
                {folders.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase())).map(folder => {
                  const itemsCount = documents.filter(d => d.folderId === folder.id).length;
                  return (
                    <div key={folder.id} onClick={() => setCurrentFolderId(folder.id)} style={folderDirectoryCardWidget}>
                      <button type="button" onClick={(e) => handleDeleteFolder(e, folder.id)} style={deleteFolderXWidget} title="Delete Subject Folder">✕</button>
                      <div style={folderIconGraphicCapsule}>📁</div>
                      <h4 style={folderTitleTextText}>{folder.name}</h4>
                      <p style={folderMetaCounterSummaryText}>{itemsCount} files compiled inside</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* SEGMENT TRACK RENDERER FOR MATCHING DOCUMENTS LIST */}
            {filteredDocuments.map(doc => (
              <div key={doc.id} style={itemCard}>
                <div style={iconBox}>📄</div>
                <div style={{flex: 1}}><h4 style={itemTitle}>{doc.title}</h4><p style={itemSubText}>PDF Module • Saved inside device offline memory storage</p></div>
                <div style={{display: 'flex', gap: '10px'}}>
                   <button style={actionBtn} onClick={() => openDocument(doc)}>View File</button>
                   <button onClick={() => handleRemove(doc.id, 'documents', null, doc.title)} style={{...actionBtn, color: '#ef4444', borderColor: '#fee2e2'}}>Delete</button>
                </div>
              </div>
            ))}

            {/* ACTION BLOCK FOR LOADING NEW ASSETS */}
            {currentFolderId !== null ? (
              <div style={{...itemCard, border: '1px dashed #000000', background: 'none', justifyContent: 'center', cursor: 'pointer'}} onClick={() => fileInputRef.current.click()}>
                <span style={{color: '#000000', fontWeight: 'bold'}}>+ Upload PDF to this Folder</span>
                <input type="file" ref={fileInputRef} style={{display: 'none'}} accept=".pdf" onChange={handleAddDocument} />
              </div>
            ) : (
              folders.length === 0 && (
                <p style={{...emptyStateText, textAlign: 'center', margin: '20px 0'}}>No subject folder indexes compiled. Create a folder above to organize your reference sheets!</p>
              )
            )}
          </div>
        )}

        {activeSubTab === 'questions' && (
          <div style={verticalList}>
            {savedQuestions.filter(q => q.question.toLowerCase().includes(searchQuery.toLowerCase())).map(q => (
              <div key={q.id} style={{...itemCard, borderLeft: '5px solid #000000', cursor: 'pointer'}} onClick={() => setSelectedItem(q)}>
                <div style={{flex: 1}}><h4 style={{...itemTitle, fontSize: '0.95rem'}}>{q.question}</h4></div>
                <button onClick={(e) => { e.stopPropagation(); handleRemove(q.id, 'questions', null, q.question); }} style={{...actionBtn, color: '#ef4444', borderColor: '#fee2e2'}}>Remove</button>
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
                                  <button onClick={() => handleRemove(null, 'history', attempt.attemptId, attempt.title)} style={{ ...actionBtn, color: '#ef4444', borderColor: '#fee2e2' }}>Wipe Record</button>
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
                savedTests.map(draft => (
                  <div key={draft.id} style={{...itemCard, borderLeft: '5px solid #000000'}}>
                    <div style={{...iconBox, background: '#f1f5f9'}}>⏳</div>
                    <div style={{flex: 1}}><h4 style={itemTitle}>{draft.title}</h4><p style={itemSubText}>Suspended at assessment index parameter position: Q{draft.lastIndex + 1} ({draft.timeLeft} mins left)</p></div>
                    <div style={{display: 'flex', gap: '10px'}}>
                       <button onClick={() => onResumeTest?.(draft)} style={{...actionBtn, background: '#000000', color: '#fff', border: 'none'}}>Resume Session</button>
                       <button onClick={() => handleRemove(draft.id, 'drafts', null, draft.title)} style={{...actionBtn, color: '#ef4444', borderColor: '#fee2e2'}}>Discard Draft</button>
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

      {/* --- IN-APP WORKSPACE FOLDER MODAL OVERLAY --- */}
      {showFolderModal && (
        <div style={modalOverlay} onClick={() => setShowFolderModal(false)}>
          <div style={{...modalContent, maxWidth: '400px', borderRadius: '20px'}} onClick={e => e.stopPropagation()}>
            <div style={{...modalHeader, paddingBottom: '10px'}}>
              <h3 style={{margin: 0, fontWeight: '900', color: '#0f172a'}}>Create New Subject Folder</h3>
              <button onClick={() => setShowFolderModal(false)} style={{background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#94a3b8', fontWeight: 'bold'}}>✕</button>
            </div>
            <div style={{padding: '20px 0'}}>
              <label style={{display:'block', fontSize:'0.72rem', fontWeight:'bold', color:'#475569', marginBottom:'6px', textTransform:'uppercase'}}>Folder Name</label>
              <input 
                type="text" 
                style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #cbd5e1', fontSize:'0.95rem', outline:'none', fontWeight:'600'}}
                placeholder="e.g. History, Mathematics, Science" 
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
              />
            </div>
            <div style={{display: 'flex', gap: '12px'}}>
              <button onClick={() => setShowFolderModal(false)} style={{...actionBtn, flex: 1, background: '#f1f5f9', color: '#475569', border: 'none'}}>Cancel</button>
              <button onClick={handleCreateFolder} style={{...actionBtn, flex: 1.3, background: '#000000', color: '#ffffff', border: 'none'}}>Create Now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- HIGH-FIDELITY MONOCHROME UI SPECIFICATIONS ---
const libContainer = { padding: '40px', maxWidth: '950px', margin: '0 auto' }; const libHeader = { marginBottom: '40px' }; const searchWrapper = { width: '300px' }; const searchField = { width: '100%', padding: '12px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', outline: 'none', background: '#fff', fontSize: '0.9rem', fontWeight: '600' }; const tabRow = { display: 'flex', gap: '30px', borderBottom: '1px solid #e2e8f0', marginBottom: '30px' }; const tabStyle = { background: 'none', border: 'none', padding: '15px 10px', fontWeight: '800', cursor: 'pointer', fontSize: '0.95rem', textTransform: 'uppercase' }; const testToggleRow = { display: 'flex', gap: '15px', marginBottom: '20px' }; const testToggleBtn = { padding: '10px 20px', borderRadius: '10px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer' }; const contentArea = { minHeight: '400px' }; const verticalList = { display: 'flex', flexDirection: 'column', gap: '15px' }; const itemCard = { background: 'white', padding: '20px 25px', borderRadius: '20px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.01)' }; const iconBox = { width: '50px', height: '50px', background: '#f8fafc', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }; const itemTitle = { margin: 0, fontSize: '1.05rem', color: '#1e293b', fontWeight: '800' }; const itemSubText = { margin: '6px 0 0 0', fontSize: '0.85rem', color: '#64748b', fontWeight: '600' }; const actionBtn = { padding: '9px 18px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontWeight: '800', fontSize: '0.8rem' }; const subjectTagSmall = { background: '#f1f5f9', color: '#000000', padding: '4px 12px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '900', border: '1px solid #e2e8f0' }; const modalOverlay = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }; const modalContent = { background: 'white', width: '90%', maxWidth: '650px', padding: '35px', borderRadius: '30px', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }; const closeBtn = { background: '#f1f5f9', border: 'none', width: '35px', height: '35px', borderRadius: '50%', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' }; const modalQText = { fontSize: '1.4rem', color: '#1e293b', padding: '15px 0 25px 0', fontWeight: '800', lineHeight: '1.4' }; const correctAnswerBox = { background: '#f8fafc', padding: '18px', borderRadius: '15px', color: '#000000', fontWeight: '900', marginBottom: '20px', border: '1px solid #e2e8f0' }; const explanationBoxModal = { padding: '22px', background: '#f8fafc', borderRadius: '20px', borderLeft: '5px solid #000000', border: '1px solid #e2e8f0' }; const modalHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '15px' }; const modalBody = { padding: '10px 0' }; const modalFooter = { borderTop: '1px solid #f1f5f9', paddingTop: '15px', marginTop: '15px' }; const emptyStateText = { textAlign: 'center', color: '#94a3b8', padding: '40px 0', fontSize: '0.9rem', fontWeight: '600', fontStyle: 'italic' }; const aiBadge = { fontSize: '0.72rem', background: '#f1f5f9', color: '#000000', padding: '3px 10px', borderRadius: '6px', fontWeight: '800', border: '1px solid #cbd5e1' }; const secBadge = { fontSize: '0.72rem', background: '#000000', color: '#ffffff', padding: '3px 10px', borderRadius: '6px', fontWeight: '800' };

// Foldering Architecture Dynamic Styles Layout Nodes
const folderActionsHeaderMenuBar = { display: 'flex', justifyContent: 'flex-start', width: '100%', marginBottom: '10px' };
const monochromeSolidDarkActionBtn = { background: '#000000', color: '#ffffff', border: 'none', padding: '10px 20px', borderRadius: '10px', fontWeight: '700', fontSize: '0.85rem', cursor: 'pointer' };
const foldersFlexGridLayout = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', width: '100%', marginBottom: '15px' };
const folderDirectoryCardWidget = { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', textAlign: 'center', position: 'relative', cursor: 'pointer', transition: 'all 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.01)' };
const deleteFolderXWidget = { position: 'absolute', top: '10px', right: '12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 'bold' };
const folderIconGraphicCapsule = { fontSize: '2.5rem', marginBottom: '8px' };
const folderTitleTextText = { margin: '0 0 4px 0', fontWeight: '800', color: '#0f172a', fontSize: '1rem' };
const folderMetaCounterSummaryText = { margin: 0, fontSize: '0.78rem', color: '#64748b', fontWeight: '600' };

const folderBreadcrumbContainerRow = { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '10px', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' };
const monochromeBackDirectoryBtn = { background: '#ffffff', border: '1px solid #000000', color: '#000000', padding: '8px 16px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: '700', cursor: 'pointer' };
const activeFolderTitleBadge = { fontSize: '1.05rem', fontWeight: '800', color: '#0f172a' };

export default Library;