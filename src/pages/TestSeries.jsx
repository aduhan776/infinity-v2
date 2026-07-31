import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; 
import useAdmin from '../hooks/useAdmin'; // 🎯 Custom Hook Linked

const TestSeries = ({ onStartTest, selectedFolder, setSelectedFolder, onViewAnalysis, session }) => {
  // 🎯 PASSING DOWN REGISTERED SESSION MATRIX TO PREVENT ADMIN VALUE DRIFTS
  const { isAdmin, loading: adminLoading } = useAdmin(session); 
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  
  // --- VIEWS STATE CONTROL ---
  const [view, setView] = useState('categories'); // categories, series-detail
  const [activeCategory, setActiveCategory] = useState('');
  const [activeSeries, setActiveSeries] = useState('');
  const [activeSubSection, setActiveSubSection] = useState('');

  // --- SINGLE TABLE CORE DATA REPOSITORIES ---
  const [allMockTests, setAllMockTests] = useState([]);
  const [testHistory, setTestHistory] = useState([]);
  const [expandedTestAttempts, setExpandedTestAttempts] = useState({}); 
  const [subscribedExams, setSubscribedExams] = useState([]);

  // --- MODALS SNAPSHOT CONTEXT STATES ---
  const [showAddSectionModal, setShowAddSectionModal] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');

  const loadTestSeriesCloudData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Key mapped dynamically with user UUID token to prevent storage intersection leakages
      const userKey = user ? `infinity_subscribed_exams_${user.id}` : 'infinity_subscribed_exams';
      const loadedSubs = JSON.parse(localStorage.getItem(userKey)) || [];
      setSubscribedExams(loadedSubs);

      // 1. Fetch the browsing tree (metadata only — NEVER question content)
      // via the backend, since mock_tests direct client access is locked down.
      const browseRes = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/tests/browse`);
      const browseData = await browseRes.json();
      const tests = browseData.success ? browseData.tests : [];
      setAllMockTests(tests);

      // 2. Fetch User Performance Evaluation History logs
      if (user) {
        const { data: sData, error: sError } = await supabase
          .from('test_sessions')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'submitted')
          .order('created_at', { ascending: false });

        if (!sError && sData) {
          const cloudTestsMap = {};
          const activeTestsPool = tests || [];
          activeTestsPool.forEach(m => {
            cloudTestsMap[m.id] = m;
          });

          const mappedHistory = sData.map(row => {
            const cloudMatch = cloudTestsMap[row.test_id] || {};
            return {
              id: row.test_id,
              attemptId: row.id,
              title: row.title,
              score: row.score || "0.00",
              accuracy: row.accuracy || "0%",
              date: new Date(row.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
              timeLeft: row.time_left,
              rawSeconds: row.raw_seconds,
              answers: row.answers || {},
              uploads: row.uploads || {},
              timeTracker: row.time_tracker || {},
              // 🔒 Question content is intentionally NOT embedded here anymore —
              // it's fetched on-demand (with answers revealed) only when
              // "Detailed Review" is actually clicked, via handleViewDetailedReview.
              hasSectionalTiming: cloudMatch.has_sectional_timing || false,
              mode: cloudMatch.category_name || "Standard",
              time: cloudMatch.time || 180
            };
          });
          setTestHistory(mappedHistory);
        }
      }
    } catch (err) {
      console.error("Cloud single table fetch breakdown:", err);
    }
  };

  useEffect(() => {
    loadTestSeriesCloudData();
  }, [view]);

  // Intercept and handle Dashboard redirection clicks via the selectedFolder prop row filter
  useEffect(() => {
    if (selectedFolder && allMockTests.length > 0) {
      const matchingTest = allMockTests.find(t => t.series_name === selectedFolder);
      if (matchingTest) {
        setActiveCategory(matchingTest.category_name);
        setActiveSeries(selectedFolder);
        const currentSections = Array.from(new Set(allMockTests
          .filter(t => t.category_name === matchingTest.category_name && t.series_name === selectedFolder && t.sub_section)
          .map(t => t.sub_section)
        ));
        setActiveSubSection(currentSections.length > 0 ? currentSections[0] : '');
        setView('series-detail');
      } else {
        setActiveCategory(selectedFolder);
        setView('categories');
      }
    }
  }, [selectedFolder, allMockTests]);

  // --- DYNAMIC FRONTEND BRANCHING CALCULATORS (OPTION B MATH) ---
  const getUniqueCategories = () => {
    return Array.from(new Set(allMockTests.map(t => t.category_name)))
      .filter(name => name && name !== 'AI Lab Generated');
  };

  const getSeriesForCategory = (catName) => {
    return Array.from(new Set(allMockTests
      .filter(t => t.category_name === catName && t.series_name)
      .map(t => t.series_name)
    ));
  };

  const getSectionsForSeries = (catName, seriesName) => {
    const sections = Array.from(new Set(allMockTests
      .filter(t => t.category_name === catName && t.series_name === seriesName && t.sub_section)
      .map(t => t.sub_section)
    ));
    if (activeSubSection && activeCategory === catName && activeSeries === seriesName && !sections.includes(activeSubSection)) {
      sections.push(activeSubSection);
    }
    return sections;
  };

  const getTestsForActiveSection = () => {
    return allMockTests.filter(t => 
      t.category_name === activeCategory && 
      t.series_name === activeSeries && 
      t.sub_section === activeSubSection && 
      t.title
    );
  };

  // --- ADMINISTRATIVE WRITE HOOKS INTO THE FLAT TREE ---
  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    try {
      const { error } = await supabase
        .from('mock_tests')
        .insert([{ 
          id: "CAT-" + Date.now(), 
          category_name: newCatName.trim() 
        }]);

      if (error) throw error;
      setNewCatName('');
      setIsModalOpen(false);
      loadTestSeriesCloudData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddTestSeries = async (catName) => {
    const seriesName = prompt("Enter New Test Series Title (e.g., 2026 Test Series, 2027 Batch):");
    if (!seriesName || !seriesName.trim()) return;

    try {
      const { error } = await supabase
        .from('mock_tests')
        .insert([{ 
          id: "SERIES-" + Date.now(), 
          category_name: catName, 
          series_name: seriesName.trim() 
        }]);

      if (error) throw error;
      loadTestSeriesCloudData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddNewSectionTab = async () => {
    if (!newSectionName.trim()) return;
    try {
      const { error } = await supabase
        .from('mock_tests')
        .insert([{
          id: "SEC-" + Date.now(), 
          category_name: activeCategory,
          series_name: activeSeries,
          sub_section: newSectionName.trim()
        }]);

      if (error) throw error;
      setActiveSubSection(newSectionName.trim());
      setNewSectionName('');
      setShowAddSectionModal(false);
      loadTestSeriesCloudData();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleEnrollSeries = async (seriesName) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userKey = user ? `infinity_subscribed_exams_${user.id}` : 'infinity_subscribed_exams';
      
      let updatedSubs = [...subscribedExams];
      if (updatedSubs.includes(seriesName)) {
        updatedSubs = updatedSubs.filter(s => s !== seriesName);
        alert(`Removed "${seriesName}" from Dashboard pinning.`);
      } else {
        updatedSubs.push(seriesName);
        alert(`Bhai, Awesome! "${seriesName}" is now pinned on your Dashboard. 🚀`);
      }
      setSubscribedExams(updatedSubs);
      localStorage.setItem(userKey, JSON.stringify(updatedSubs));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteCategoryPath = async (e, catName) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${catName}" track entirely from the unified table?`)) {
      await supabase.from('mock_tests').delete().eq('category_name', catName);
      loadTestSeriesCloudData();
    }
  };

  const toggleAttemptsDropdown = (testId) => {
    setExpandedTestAttempts(prev => ({ ...prev, [testId] : !prev[testId] }));
  };

  // 🔒 Flattens sectional (sections[].questions) or flat (questions_list)
  // shape into one array — same flattening TestPortal/AnalysisPortal expect.
  const flattenTestQuestions = (test) => {
    if (Array.isArray(test.sections) && test.sections.length > 0) {
      let flat = [];
      test.sections.forEach((sec, secIdx) => {
        if (Array.isArray(sec.questions)) {
          sec.questions.forEach(q => flat.push({ ...q, sectionIndex: secIdx, sectionName: sec.name, sectionTime: sec.time }));
        }
      });
      return flat;
    }
    return test.questions_list || [];
  };

  // 🔒 "Secure Test Delivery": fetches the test WITHOUT answers, right
  // before actually starting/reattempting it.
  const handleStartTest = async (test) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/tests/load?testId=${encodeURIComponent(test.id)}&reveal=false`);
      const data = await res.json();
      if (!data.success) {
        alert(data.error || "Could not load this test right now. Please try again.");
        return;
      }
      onStartTest({ ...data.test, hasSectionalTiming: data.test.has_sectional_timing || false });
    } catch (err) {
      console.error("Failed to load test for attempt:", err);
      alert("Network error — could not load the test. Please check your connection.");
    }
  };

  // 🔒 Post-hoc review of an ALREADY-completed attempt — full answers are
  // fine to reveal here, the student already finished this attempt.
  const handleViewDetailedReview = async (attempt) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/tests/load?testId=${encodeURIComponent(attempt.id)}&reveal=true`);
      const data = await res.json();
      if (!data.success) {
        alert(data.error || "Could not load this attempt's review right now.");
        return;
      }
      onViewAnalysis({
        ...attempt,
        questions: flattenTestQuestions(data.test),
        questions_list: flattenTestQuestions(data.test),
        sections: data.test.sections || null
      });
    } catch (err) {
      console.error("Failed to load test for review:", err);
      alert("Network error — could not load the review. Please check your connection.");
    }
  };

  // --- VIEW RENDER 1: HORIZONTAL BRANCHING ALLOCATIONS REEL ---
  if (view === 'categories') {
    const renderCategories = getUniqueCategories();

    return (
      <div style={containerStyle} className="ts-container">
        <style>{`
          @media (max-width: 768px) {
            .content-view { padding-left: 0 !important; padding-right: 0 !important; }
            .ts-container { padding: 10px 6px !important; overflow-x: hidden !important; }
            .ts-header h1 { font-size: 1.3rem !important; }
            .ts-header p { font-size: 0.72rem !important; margin-top: 2px !important; }
            .ts-category-row { flex-direction: column !important; padding: 12px !important; border-radius: 16px !important; gap: 12px !important; }
            .ts-descriptor-block { width: 100% !important; border-right: none !important; border-bottom: 1px solid #f1f5f9 !important; padding-right: 0 !important; padding-bottom: 10px !important; margin-bottom: 2px !important; }
            .ts-descriptor-block h3 { font-size: 1.05rem !important; }
            .ts-descriptor-block p { font-size: 0.66rem !important; margin-bottom: 8px !important; }
            .ts-series-card { width: 160px !important; padding: 12px !important; border-radius: 14px !important; }
            .ts-series-card h4 { font-size: 0.92rem !important; margin-bottom: 3px !important; }
            .ts-series-card p { font-size: 0.68rem !important; margin-bottom: 10px !important; }
            .ts-series-card button { padding: 7px !important; font-size: 0.68rem !important; }
          }
        `}</style>
        <header style={headerPanelRow} className="ts-header">
          <div>
            <h1 style={{ fontSize: '2.4rem', fontWeight: '900', color: '#0f172a', margin: 0, letterSpacing: '-0.5px' }}>Test Series Hub</h1>
            <p style={{ color: '#64748b', marginTop: '4px', fontWeight: '500' }}>Explore custom testing frameworks and enroll to track progress.</p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            {/* 🛡️ Admin Verification Wrapper */}
            {isAdmin && (
              <button onClick={() => setIsModalOpen(true)} style={monochromeSolidDarkActionBtn}>
                + Add Main Category
              </button>
            )}
          </div>
        </header>

        <div style={horizontalStackColumnLayout}>
          {renderCategories.map((catName) => {
            const seriesList = getSeriesForCategory(catName);
            return (
              <div key={catName} style={horizontalCategorySpaceRow} className="ts-category-row">
                
                {/* Branch Anchor Left Node Box */}
                <div style={categoryLeftDescriptorBlock} className="ts-descriptor-block">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <h3 style={categoryHeadingText}>{catName}</h3>
                    {/* 🛡️ Admin Verification Wrapper */}
                    {isAdmin && <button onClick={(e) => handleDeleteCategoryPath(e, catName)} style={deleteMinimalCrossLink}>✕</button>}
                  </div>
                  <p style={subLabelMetaDataText}>{seriesList.length} Series Total</p>
                  {/* 🛡️ Admin Verification Wrapper */}
                  {isAdmin && (
                    <button onClick={() => handleAddTestSeries(catName)} style={smallMonochromeOutlineWidgetBtn}>
                      + Add Test Series
                    </button>
                  )}
                </div>

                {/* Branch Horizontal Scroller Split Tracks Panel */}
                <div style={seriesHorizontalFlexScroller}>
                  {seriesList.length > 0 ? (
                    seriesList.map((seriesName) => {
                      const totalTestCount = allMockTests.filter(t => t.category_name === catName && t.series_name === seriesName && t.title).length;
                      const isEnrolled = subscribedExams.includes(seriesName);

                      return (
                        <div key={seriesName} style={seriesChronologicalCardBox} className="ts-series-card">
                          <h4 style={seriesThemeTitleCardHeader}>{seriesName}</h4>
                          <p style={totalTestCountFooterText}>{totalTestCount} Mock Tests</p>
                          
                          {/* DUAL MONOCHROME MANAGEMENT BUTTON MATRIX */}
                          <div style={seriesCardActionContainerLayout}>
                            <button 
                              type="button" 
                              onClick={() => toggleEnrollSeries(seriesName)} 
                              style={{ 
                                ...seriesActionBtnStyle, 
                                background: isEnrolled ? '#475569' : '#000000', 
                                color: '#ffffff',
                                border: 'none'
                              }}
                            >
                              {isEnrolled ? "Enrolled ✓" : "Enroll in Series"}
                            </button>
                            <button 
                              type="button" 
                              onClick={() => {
                                setActiveCategory(catName);
                                setActiveSeries(seriesName);
                                const currentSections = getSectionsForSeries(catName, seriesName);
                                setActiveSubSection(currentSections.length > 0 ? currentSections[0] : '');
                                setView('series-detail');
                              }} 
                              style={{ 
                                ...seriesActionBtnStyle, 
                                background: '#ffffff', 
                                color: '#000000', 
                                border: '1px solid #000000' 
                              }}
                            >
                              Explore Test Series
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={emptySeriesHorizontalPlaceholder}>
                      No test series branches deployed yet.
                    </div>
                  )}
                </div>

              </div>
            );
          })}
          {renderCategories.length === 0 && <p style={emptyStateTextPlaceholder}>No category path clusters found in the database grid.</p>}
        </div>

        {isModalOpen && (
          <div style={modalOverlayStyle} onClick={() => setIsModalOpen(false)}>
            <div style={modalContentCardStyle} onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: '0 0 15px 0', fontWeight: '900', color: '#0f172a' }}>Create Core Category Path</h3>
              <input style={inputStyle} placeholder="e.g. UPSC, SSC, Boards" value={newCatName} onChange={e => setNewCatName(e.target.value)} />
              <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                <button onClick={() => setIsModalOpen(false)} style={modalCancelBtn}>Cancel</button>
                <button onClick={handleAddCategory} style={modalConfirmBtn}>Add Path</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- VIEW RENDER 2: CUSTOM NESTED SECTIONS TAB VIEW EXPLORER ---
  if (view === 'series-detail') {
    const tabsList = getSectionsForSeries(activeCategory, activeSeries);
    const renderActiveTests = getTestsForActiveSection();

    return (
      <div style={containerStyle} className="ts-container">
        <style>{`
          @media (max-width: 768px) {
            .content-view { padding-left: 0 !important; padding-right: 0 !important; }
            .ts-container { padding: 10px 6px !important; overflow-x: hidden !important; }
            .ts-breadcrumb { font-size: 0.62rem !important; }
            .ts-workspace-title { font-size: 1.15rem !important; }
            .ts-back-btn { padding: 6px 10px !important; font-size: 0.68rem !important; }
            .ts-tab-row { gap: 14px !important; margin-bottom: 14px !important; }
            .ts-tab-btn { padding: 8px 2px !important; font-size: 0.7rem !important; }
            .ts-item-row { padding: 12px !important; border-radius: 14px !important; }
            .ts-item-header-row { flex-direction: column !important; align-items: flex-start !important; gap: 10px !important; }
            .ts-item-header-row > div:last-child { width: 100% !important; }
            .ts-item-header-row > div:last-child button { flex: 1 !important; padding: 8px 4px !important; font-size: 0.68rem !important; }
            .ts-item-title { font-size: 0.92rem !important; }
            .ts-stat-badge { font-size: 0.62rem !important; padding: 3px 6px !important; }
            .ts-attempt-row { flex-direction: column !important; align-items: stretch !important; gap: 8px !important; padding: 8px 10px !important; }
            .ts-attempt-top { display: flex !important; justify-content: space-between !important; font-size: 0.7rem !important; }
            .ts-attempt-row button { width: 100% !important; text-align: center !important; }
          }
        `}</style>
        <header style={{ marginBottom: '30px' }}>
          <button className="ts-back-btn" onClick={() => { setSelectedFolder(null); setView('categories'); }} style={backDirectoryLinkBtn}>
            ← Back to Test Series Hub
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '15px' }}>
            <div>
              <div className="ts-breadcrumb" style={breadcrumbTrailRow}>
                <span>{activeCategory}</span> / <span style={{ color: '#000000' }}>{activeSeries}</span>
              </div>
              <h2 className="ts-workspace-title" style={{ fontSize: '1.8rem', fontWeight: '900', color: '#0f172a', margin: '4px 0 0 0' }}>
                {activeSeries} Workspace
              </h2>
            </div>
            {/* 🛡️ Admin Verification Wrapper */}
            {isAdmin && (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setShowAddSectionModal(true)} style={secondaryActionBtn}>+ Add Section Tab</button>
              </div>
            )}
          </div>
        </header>

        {/* ADMIN DRIVEN SECTION TAB REEL BAR */}
        {tabsList.length > 0 && (
          <div style={tabMenuBarRow} className="ts-tab-row">
            {tabsList.map(tab => (
              <button 
                key={tab} 
                className="ts-tab-btn"
                onClick={() => setActiveSubSection(tab)} 
                style={{
                  ...tabElementBtn, 
                  color: activeSubSection === tab ? '#000000' : '#94a3b8', 
                  borderBottom: activeSubSection === tab ? '3px solid #000000' : 'none'
                }}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {/* PAPERS SCOPE DISPLAY LIST CONTAINER */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', minHeight: '300px' }}>
          {activeSubSection ? (
            renderActiveTests.length > 0 ? (
              renderActiveTests.map((test) => {
                const matchingAttempts = testHistory.filter(item => item.id === test.id);
                const isAttempted = matchingAttempts.length > 0;
                const bestScore = isAttempted ? Math.max(...matchingAttempts.map(a => parseFloat(a.score) || 0)) : 0;

                return (
                  <div key={test.id} style={testItemInstanceRow} className="ts-item-row">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }} className="ts-item-header-row">
                      <div>
                        <h4 style={testTitleHeaderStyle} className="ts-item-title">{test.title}</h4>
                        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' }}>
                          <span style={statBadge} className="ts-stat-badge">Time: {test.time} Mins</span>
                          <span style={statBadge} className="ts-stat-badge">Questions: {test.questions}</span>
                          {isAttempted && (
                            <span style={{ ...statBadge, background: '#f8fafc', color: '#000000', fontWeight: '800' }} className="ts-stat-badge">
                              Best Score: {bestScore.toFixed(2)} M
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        {isAttempted && (
                          <button onClick={() => toggleAttemptsDropdown(test.id)} style={secondaryActionBtn}>
                            {expandedTestAttempts[test.id] ? "Hide Attempts" : `View Attempts (${matchingAttempts.length})`}
                          </button>
                        )}
                        <button onClick={() => handleStartTest(test)} style={monochromeLaunchTestBtn}>
                          {isAttempted ? "Reattempt Test" : "Start Test"}
                        </button>
                      </div>
                    </div>

                    {expandedTestAttempts[test.id] && isAttempted && (
                      <div style={nestedAttemptsScrollerContainer}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {matchingAttempts.map((attempt, index) => (
                            <div key={attempt.attemptId || index} style={attemptHistoryItemLine} className="ts-attempt-row">
                              <div className="ts-attempt-top" style={{ display: 'contents' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#475569' }}>
                                  Run #{matchingAttempts.length - index} — Completed {attempt.date}
                                </span>
                                <span style={{ fontSize: '0.88rem', fontWeight: '800', color: '#0f172a' }}>
                                  Score: {parseFloat(attempt.score).toFixed(2)} M ({attempt.accuracy})
                                </span>
                              </div>
                              <button 
                                type="button"
                                onClick={() => handleViewDetailedReview(attempt)} 
                                style={{
                                  background: '#000000',
                                  color: '#ffffff',
                                  border: 'none',
                                  padding: '6px 12px',
                                  borderRadius: '6px',
                                  fontWeight: '700',
                                  fontSize: '0.78rem',
                                  cursor: 'pointer',
                                  display: 'inline-block'
                                }}
                              >
                                Detailed Review
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <p style={emptyStateTextPlaceholder}>No mock test packets loaded into this path layer yet.</p>
            )
          ) : (
            <p style={emptyStateTextPlaceholder}>No sections added to this test series yet.</p>
          )}
        </div>

        {/* MODAL: INJECT NEW SUB SECTION TAB ROW */}
        {showAddSectionModal && (
          <div style={modalOverlayStyle} onClick={() => setShowAddSectionModal(false)}>
            <div style={modalContentCardStyle} onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: '0 0 15px 0', fontWeight: '900', color: '#0f172a' }}>Add Custom Section Tab</h3>
              <input style={inputStyle} placeholder="e.g. Full Length Tests, Subject Wise Drills" value={newSectionName} onChange={e => setNewSectionName(e.target.value)} />
              <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                <button onClick={() => setShowAddSectionModal(false)} style={modalCancelBtn}>Cancel</button>
                <button onClick={handleAddNewSectionTab} style={modalConfirmBtn}>Create Tab</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
};

// --- STYLES ARCHITECTURE SCHEMAS MAP ---
const containerStyle = { padding: '20px 10px', maxWidth: '1200px', margin: '0 auto' }; const headerPanelRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }; const monochromeSolidDarkActionBtn = { background: '#000000', color: '#ffffff', border: 'none', padding: '12px 24px', borderRadius: '12px', fontWeight: '700', fontSize: '0.88rem', cursor: 'pointer' }; const horizontalStackColumnLayout = { display: 'flex', flexDirection: 'column', gap: '28px' }; const horizontalCategorySpaceRow = { display: 'flex', flexDirection: 'row', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '24px', padding: '24px', alignItems: 'stretch', gap: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.005)' }; const categoryLeftDescriptorBlock = { width: '220px', flexShrink: 0, borderRight: '1px solid #f1f5f9', paddingRight: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }; const categoryHeadingText = { margin: '0 0 2px 0', fontSize: '1.4rem', fontWeight: '900', color: '#0f172a', letterSpacing: '-0.3px' }; const deleteMinimalCrossLink = { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }; const subLabelMetaDataText = { margin: '0 0 16px 0', fontSize: '0.8rem', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }; const smallMonochromeOutlineWidgetBtn = { background: '#ffffff', border: '1px solid #000000', color: '#000000', padding: '8px 12px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: '700', cursor: 'pointer', textAlign: 'center' }; const seriesHorizontalFlexScroller = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'row', gap: '16px', overflowX: 'auto', paddingBottom: '4px', alignItems: 'center', WebkitOverflowScrolling: 'touch' }; const seriesChronologicalCardBox = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '20px', padding: '22px', width: '210px', flexShrink: 0, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }; const seriesThemeTitleCardHeader = { margin: '0 0 6px 0', fontSize: '1.15rem', fontWeight: '900', color: '#0f172a', lineHeight: '1.3' }; const totalTestCountFooterText = { margin: '0 0 20px 0', fontSize: '0.85rem', color: '#64748b', fontWeight: '600' }; const seriesCardActionContainerLayout = { display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: 'auto' }; const seriesActionBtnStyle = { width: '100%', padding: '10px', borderRadius: '10px', fontSize: '0.8rem', fontWeight: '800', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s ease', boxSizing: 'border-box' }; const backDirectoryLinkBtn = { background: '#ffffff', border: '1px solid #000000', color: '#000000', padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }; const breadcrumbTrailRow = { fontSize: '0.8rem', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }; const tabMenuBarRow = { display: 'flex', gap: '30px', borderBottom: '1px solid #e2e8f0', marginBottom: '25px' }; const tabElementBtn = { background: 'none', border: 'none', padding: '12px 6px', fontWeight: '800', cursor: 'pointer', fontSize: '0.88rem', letterSpacing: '0.3px' }; const testItemInstanceRow = { background: '#ffffff', padding: '20px 24px', borderRadius: '20px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }; const testTitleHeaderStyle = { margin: 0, fontSize: '1.1rem', color: '#0f172a', fontWeight: '800' }; const statBadge = { fontSize: '0.8rem', color: '#475569', background: '#f1f5f9', padding: '4px 10px', borderRadius: '6px', fontWeight: '700' }; const secondaryActionBtn = { background: '#ffffff', border: '1px solid #cbd5e1', padding: '10px 18px', borderRadius: '10px', color: '#475569', fontWeight: '700', cursor: 'pointer', fontSize: '0.82rem' }; const monochromeLaunchTestBtn = { background: '#000000', color: '#ffffff', border: 'none', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: '800', fontSize: '0.82rem' }; const nestedAttemptsScrollerContainer = { background: '#f8fafc', padding: '16px', borderRadius: '14px', border: '1px dashed #000000', marginTop: '16px' }; const attemptHistoryItemLine = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }; const emptyStateTextPlaceholder = { textAlign: 'center', color: '#94a3b8', padding: '40px 0', fontSize: '0.88rem', fontWeight: '600', fontStyle: 'italic' }; const modalOverlayStyle = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }; const modalContentCardStyle = { background: '#ffffff', padding: '30px', borderRadius: '24px', width: '90%', maxWidth: '400px', border: '1px solid #e2e8f0' }; const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '1rem', outline: 'none', boxSizing: 'border-box', marginBottom: '14px', fontWeight: '600' }; const modalConfirmBtn = { flex: 1.3, padding: '12px', background: '#000000', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }; const modalCancelBtn = { flex: 1, padding: '12px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }; const emptySeriesHorizontalPlaceholder = { color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic', fontWeight: '500', paddingLeft: '10px' };

export default TestSeries;