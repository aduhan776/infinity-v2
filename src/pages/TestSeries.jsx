import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient'; 
import useAdmin from '../hooks/useAdmin'; // 🎯 Custom Hook Linked

const TestSeries = ({ onStartTest, selectedFolder, setSelectedFolder, onViewAnalysis, session }) => {
  // 🎯 PASSING DOWN REGISTERED SESSION MATRIX TO PREVENT ADMIN VALUE DRIFTS
  const { isAdmin, loading: adminLoading } = useAdmin(session); 
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  // 📱 "View All" overlay — shows every series in a category as a modal grid,
  // for when the horizontal scroller only shows 2-3 cards on small screens.
  const [viewAllCategory, setViewAllCategory] = useState(null);

  // 📱 MOBILE DETECTION — same window.innerWidth-based approach used on
  // Dashboard/BrainFeed/AiTests, so layout doesn't depend on CSS media-query
  // matching at all (avoids any inconsistency between pages).
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 📱 One scroll-container ref per category, so left/right arrow buttons can
  // reliably drive the scroll directly — no dependence on touch-gesture detection.
  const categoryScrollRefs = useRef({});
  const scrollCategoryBy = (catName, amount) => {
    const el = categoryScrollRefs.current[catName];
    if (el) el.scrollBy({ left: amount, behavior: 'smooth' });
  };
  
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
      <div style={{ ...containerStyle, ...(isMobile ? { padding: '10px 0' } : {}) }} className="ts-container">
        <style>{`
          @media (max-width: 768px) {
            .content-view { padding-left: 0 !important; padding-right: 0 !important; }
            .ts-container { width: 100% !important; max-width: 100vw !important; box-sizing: border-box !important; padding-left: 6px !important; padding-right: 6px !important; }
            .ts-header { flex-direction: column !important; align-items: flex-start !important; gap: 10px !important; margin-bottom: 22px !important; }
            .ts-category-row { width: 100% !important; max-width: 100% !important; min-width: 0 !important; box-sizing: border-box !important; margin: 0 !important; padding: 10px !important; overflow: hidden !important; }
            .ts-descriptor-block {
              width: 100% !important;
              padding-top: 0 !important;
              padding-bottom: 8px !important;
              justify-content: flex-start !important;
            }
            .ts-descriptor-top-row { display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 8px !important; }
            .ts-descriptor-meta-line { margin-bottom: 0 !important; }
            .ts-view-all-btn {
              display: inline-flex !important;
              align-items: center !important;
              justify-content: center !important;
              font-size: 0.78rem !important;
              padding: 8px 16px !important;
            }
            .ts-series-scroller-wrap {
              flex: 1 1 0% !important;
              min-width: 0 !important;
              width: 100% !important;
              max-width: 100% !important;
              overflow-x: auto !important;
              -webkit-overflow-scrolling: touch !important;
              scroll-snap-type: x proximity !important;
              box-sizing: border-box !important;
            }
            .ts-series-scroller { gap: 8px !important; padding-bottom: 4px !important; }
            .ts-series-card {
              /* Width comes from the inline 148px set on this element (see
                 seriesChronologicalCardBox override below) — fixed px avoids
                 the layout blowout a vw-based calc caused here, since vw
                 ignores this row's own padding/parent .content-view overrides
                 and can size the card wider than the space actually available. */
              flex-shrink: 0 !important;
              scroll-snap-align: start !important;
              padding: 10px !important;
              border-radius: 14px !important;
              box-sizing: border-box !important;
            }
            .ts-viewall-overlay { padding: 16px 10px !important; align-items: flex-start !important; }
            .ts-viewall-card { width: 100% !important; max-width: 480px !important; max-height: 82vh !important; padding: 18px !important; border-radius: 20px !important; }
            .ts-viewall-grid { grid-template-columns: 1fr 1fr !important; gap: 10px !important; }
          }
        `}</style>
        <header style={headerPanelRow} className="ts-header">
          <div>
            <h1 style={{ fontSize: isMobile ? '1.3rem' : '2.4rem', fontWeight: '900', color: '#0f172a', margin: 0, letterSpacing: '-0.5px' }}>Test Series Hub</h1>
            <p style={{ color: '#64748b', marginTop: '4px', fontWeight: '500', fontSize: isMobile ? '0.72rem' : '1rem' }}>Explore custom testing frameworks and enroll to track progress.</p>
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
              <div
                key={catName}
                className="ts-category-row"
                style={{
                  ...horizontalCategorySpaceRow,
                  flexDirection: isMobile ? 'column' : 'row',
                  width: '100%',
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                  padding: isMobile ? '12px' : horizontalCategorySpaceRow.padding,
                  gap: isMobile ? '10px' : horizontalCategorySpaceRow.gap
                }}
              >
                
                {/* Branch Anchor Left Node Box */}
                <div
                  className="ts-descriptor-block"
                  style={{
                    ...categoryLeftDescriptorBlock,
                    width: isMobile ? '100%' : categoryLeftDescriptorBlock.width,
                    borderRight: isMobile ? 'none' : categoryLeftDescriptorBlock.borderRight,
                    borderBottom: isMobile ? '1px solid #f1f5f9' : 'none',
                    paddingRight: isMobile ? 0 : categoryLeftDescriptorBlock.paddingRight,
                    paddingBottom: isMobile ? '10px' : 0
                  }}
                >
                  <div className="ts-descriptor-top-row" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h3 style={{ ...categoryHeadingText, fontSize: isMobile ? '1.05rem' : categoryHeadingText.fontSize, margin: isMobile ? 0 : categoryHeadingText.margin }}>{catName}</h3>
                      {/* 🛡️ Admin Verification Wrapper */}
                      {isAdmin && <button onClick={(e) => handleDeleteCategoryPath(e, catName)} style={deleteMinimalCrossLink}>✕</button>}
                    </div>
                    {/* 📱 "View All" — only rendered on mobile, opens the modal grid of every series in this category */}
                    {isMobile && seriesList.length > 0 && (
                      <button
                        type="button"
                        className="ts-view-all-btn"
                        onClick={() => setViewAllCategory(catName)}
                        style={viewAllTriggerBtn}
                      >
                        View All →
                      </button>
                    )}
                  </div>
                  <p className="ts-descriptor-meta-line" style={{ ...subLabelMetaDataText, fontSize: isMobile ? '0.66rem' : subLabelMetaDataText.fontSize, marginBottom: isMobile ? '8px' : subLabelMetaDataText.marginBottom, marginTop: isMobile ? '4px' : subLabelMetaDataText.marginTop }}>{seriesList.length} Series Total</p>
                  {/* 🛡️ Admin Verification Wrapper */}
                  {isAdmin && (
                    <button onClick={() => handleAddTestSeries(catName)} style={smallMonochromeOutlineWidgetBtn}>
                      + Add Test Series
                    </button>
                  )}
                </div>

                {/* Branch Horizontal Scroller Split Tracks Panel */}
                <div
                  className="ts-series-scroller-wrap"
                  ref={(el) => { categoryScrollRefs.current[catName] = el; }}
                  style={{ flex: 1, minWidth: 0, width: '100%', maxWidth: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch', boxSizing: 'border-box' }}
                >
                  <div style={{ ...seriesHorizontalFlexScroller, width: 'max-content' }} className="ts-series-scroller">
                  {seriesList.length > 0 ? (
                    seriesList.map((seriesName) => {
                      const totalTestCount = allMockTests.filter(t => t.category_name === catName && t.series_name === seriesName && t.title).length;
                      const isEnrolled = subscribedExams.includes(seriesName);

                      return (
                        <div
                          key={seriesName}
                          className="ts-series-card"
                          style={{
                            ...seriesChronologicalCardBox,
                            width: isMobile ? '120px' : seriesChronologicalCardBox.width,
                            padding: isMobile ? '12px' : seriesChronologicalCardBox.padding
                          }}
                        >
                          <h4 style={{ ...seriesThemeTitleCardHeader, fontSize: isMobile ? '0.85rem' : seriesThemeTitleCardHeader.fontSize, marginBottom: isMobile ? '2px' : seriesThemeTitleCardHeader.marginBottom }}>{seriesName}</h4>
                          <p style={{ ...totalTestCountFooterText, fontSize: isMobile ? '0.64rem' : totalTestCountFooterText.fontSize, marginBottom: isMobile ? '8px' : totalTestCountFooterText.marginBottom }}>{totalTestCount} Mock Tests</p>
                          
                          {/* DUAL MONOCHROME MANAGEMENT BUTTON MATRIX */}
                          <div style={{ ...seriesCardActionContainerLayout, gap: isMobile ? '6px' : seriesCardActionContainerLayout.gap }}>
                            <button 
                              type="button" 
                              onClick={() => toggleEnrollSeries(seriesName)} 
                              style={{ 
                                ...seriesActionBtnStyle, 
                                background: isEnrolled ? '#475569' : '#000000', 
                                color: '#ffffff',
                                border: 'none',
                                padding: isMobile ? '7px 4px' : seriesActionBtnStyle.padding,
                                fontSize: isMobile ? '0.66rem' : seriesActionBtnStyle.fontSize
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
                                border: '1px solid #000000',
                                padding: isMobile ? '7px 4px' : seriesActionBtnStyle.padding,
                                fontSize: isMobile ? '0.66rem' : seriesActionBtnStyle.fontSize
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

        {/* 📱 VIEW ALL OVERLAY — full list of series in a category, for mobile
            where the horizontal scroller can only show 2-3 cards at a time. */}
        {viewAllCategory && (
          <div className="ts-viewall-overlay" style={modalOverlayStyle} onClick={() => setViewAllCategory(null)}>
            <div className="ts-viewall-card" style={viewAllCardStyle} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontWeight: '900', color: '#0f172a', fontSize: '1.15rem' }}>{viewAllCategory} — All Series</h3>
                <button onClick={() => setViewAllCategory(null)} style={{ background: 'none', border: 'none', fontSize: '1.3rem', fontWeight: '700', color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>✕</button>
              </div>
              <div className="ts-viewall-grid" style={viewAllGridStyle}>
                {getSeriesForCategory(viewAllCategory).map((seriesName) => {
                  const totalTestCount = allMockTests.filter(t => t.category_name === viewAllCategory && t.series_name === seriesName && t.title).length;
                  const isEnrolled = subscribedExams.includes(seriesName);
                  return (
                    <div key={seriesName} style={{ ...seriesChronologicalCardBox, width: '100%' }}>
                      <h4 style={seriesThemeTitleCardHeader}>{seriesName}</h4>
                      <p style={totalTestCountFooterText}>{totalTestCount} Mock Tests</p>
                      <div style={seriesCardActionContainerLayout}>
                        <button
                          type="button"
                          onClick={() => toggleEnrollSeries(seriesName)}
                          style={{ ...seriesActionBtnStyle, background: isEnrolled ? '#475569' : '#000000', color: '#ffffff', border: 'none' }}
                        >
                          {isEnrolled ? "Enrolled ✓" : "Enroll in Series"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveCategory(viewAllCategory);
                            setActiveSeries(seriesName);
                            const currentSections = getSectionsForSeries(viewAllCategory, seriesName);
                            setActiveSubSection(currentSections.length > 0 ? currentSections[0] : '');
                            setViewAllCategory(null);
                            setView('series-detail');
                          }}
                          style={{ ...seriesActionBtnStyle, background: '#ffffff', color: '#000000', border: '1px solid #000000' }}
                        >
                          Explore Test Series
                        </button>
                      </div>
                    </div>
                  );
                })}
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
            .ts-container { padding: 10px 6px !important; }
            .ts-breadcrumb { font-size: 0.62rem !important; }
            .ts-workspace-title { font-size: 1.15rem !important; }
            .ts-back-btn { padding: 6px 10px !important; font-size: 0.68rem !important; }
            .ts-workspace-actions { width: 100% !important; }
            .ts-workspace-actions button { flex: 1 !important; padding: 9px 6px !important; font-size: 0.72rem !important; }
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
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }} className="ts-workspace-actions">
              {/* 📱 Enroll button available right inside the series workspace too,
                  so the student doesn't have to leave and re-find the card on the hub. */}
              <button
                type="button"
                onClick={() => toggleEnrollSeries(activeSeries)}
                style={{
                  ...secondaryActionBtn,
                  background: subscribedExams.includes(activeSeries) ? '#475569' : '#000000',
                  color: '#ffffff',
                  border: 'none'
                }}
              >
                {subscribedExams.includes(activeSeries) ? "Enrolled ✓" : "Enroll in Series"}
              </button>
              {/* 🛡️ Admin Verification Wrapper */}
              {isAdmin && (
                <button onClick={() => setShowAddSectionModal(true)} style={secondaryActionBtn}>+ Add Section Tab</button>
              )}
            </div>
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
const containerStyle = { padding: '20px 10px', maxWidth: '1200px', margin: '0 auto' }; const headerPanelRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }; const monochromeSolidDarkActionBtn = { background: '#000000', color: '#ffffff', border: 'none', padding: '12px 24px', borderRadius: '12px', fontWeight: '700', fontSize: '0.88rem', cursor: 'pointer' }; const horizontalStackColumnLayout = { display: 'flex', flexDirection: 'column', gap: '28px' }; const horizontalCategorySpaceRow = { display: 'flex', flexDirection: 'row', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '24px', padding: '24px', alignItems: 'stretch', gap: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.005)' }; const categoryLeftDescriptorBlock = { width: '220px', flexShrink: 0, borderRight: '1px solid #f1f5f9', paddingRight: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }; const categoryHeadingText = { margin: '0 0 2px 0', fontSize: '1.4rem', fontWeight: '900', color: '#0f172a', letterSpacing: '-0.3px' }; const deleteMinimalCrossLink = { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }; const subLabelMetaDataText = { margin: '0 0 16px 0', fontSize: '0.8rem', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }; const smallMonochromeOutlineWidgetBtn = { background: '#ffffff', border: '1px solid #000000', color: '#000000', padding: '8px 12px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: '700', cursor: 'pointer', textAlign: 'center' }; const seriesHorizontalFlexScroller = { display: 'flex', flexDirection: 'row', gap: '16px', width: 'max-content', alignItems: 'center' }; const seriesChronologicalCardBox = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '20px', padding: '22px', width: '210px', flexShrink: 0, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }; const seriesThemeTitleCardHeader = { margin: '0 0 6px 0', fontSize: '1.15rem', fontWeight: '900', color: '#0f172a', lineHeight: '1.3' }; const totalTestCountFooterText = { margin: '0 0 20px 0', fontSize: '0.85rem', color: '#64748b', fontWeight: '600' }; const seriesCardActionContainerLayout = { display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: 'auto' }; const seriesActionBtnStyle = { width: '100%', padding: '10px', borderRadius: '10px', fontSize: '0.8rem', fontWeight: '800', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s ease', boxSizing: 'border-box' }; const backDirectoryLinkBtn = { background: '#ffffff', border: '1px solid #000000', color: '#000000', padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }; const breadcrumbTrailRow = { fontSize: '0.8rem', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }; const tabMenuBarRow = { display: 'flex', gap: '30px', borderBottom: '1px solid #e2e8f0', marginBottom: '25px' }; const tabElementBtn = { background: 'none', border: 'none', padding: '12px 6px', fontWeight: '800', cursor: 'pointer', fontSize: '0.88rem', letterSpacing: '0.3px' }; const testItemInstanceRow = { background: '#ffffff', padding: '20px 24px', borderRadius: '20px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }; const testTitleHeaderStyle = { margin: 0, fontSize: '1.1rem', color: '#0f172a', fontWeight: '800' }; const statBadge = { fontSize: '0.8rem', color: '#475569', background: '#f1f5f9', padding: '4px 10px', borderRadius: '6px', fontWeight: '700' }; const secondaryActionBtn = { background: '#ffffff', border: '1px solid #cbd5e1', padding: '10px 18px', borderRadius: '10px', color: '#475569', fontWeight: '700', cursor: 'pointer', fontSize: '0.82rem' }; const monochromeLaunchTestBtn = { background: '#000000', color: '#ffffff', border: 'none', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: '800', fontSize: '0.82rem' }; const nestedAttemptsScrollerContainer = { background: '#f8fafc', padding: '16px', borderRadius: '14px', border: '1px dashed #000000', marginTop: '16px' }; const attemptHistoryItemLine = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }; const emptyStateTextPlaceholder = { textAlign: 'center', color: '#94a3b8', padding: '40px 0', fontSize: '0.88rem', fontWeight: '600', fontStyle: 'italic' }; const modalOverlayStyle = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }; const modalContentCardStyle = { background: '#ffffff', padding: '30px', borderRadius: '24px', width: '90%', maxWidth: '400px', border: '1px solid #e2e8f0' }; const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '1rem', outline: 'none', boxSizing: 'border-box', marginBottom: '14px', fontWeight: '600' }; const modalConfirmBtn = { flex: 1.3, padding: '12px', background: '#000000', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }; const modalCancelBtn = { flex: 1, padding: '12px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }; const emptySeriesHorizontalPlaceholder = { color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic', fontWeight: '500', paddingLeft: '10px' };
const scrollArrowBtnStyle = { flexShrink: 0, width: '28px', height: '28px', borderRadius: '50%', border: '1px solid #e2e8f0', background: '#ffffff', color: '#0f172a', fontSize: '1.1rem', fontWeight: '900', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0 };
const viewAllTriggerBtn = { background: 'none', border: '1px solid #000000', color: '#000000', padding: '8px 16px', borderRadius: '20px', fontSize: '0.78rem', fontWeight: '800', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
const viewAllCardStyle = { background: '#ffffff', borderRadius: '24px', padding: '24px', width: '90%', maxWidth: '600px', maxHeight: '80vh', overflowY: 'auto', border: '1px solid #e2e8f0', boxSizing: 'border-box' };
const viewAllGridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' };

export default TestSeries;
