import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; 

const Dashboard = ({ setActiveTab, setTestSeriesFolder, onStartTest }) => {
  const [subscribedExams, setSubscribedExams] = useState([]);
  const [userName, setUserName] = useState("Student");
  const [folderToUnpin, setFolderToUnpin] = useState(null);
  
  // --- IN-APP WINDOW OVERLAY STATES ---
  const [showViewAllModal, setShowViewAllModal] = useState(false);
  const [showAiFolderModal, setShowAiFolderModal] = useState(false);

  // --- LIVE STATISTICS OVERVIEW STATES ---
  const [totalTests, setTotalTests] = useState(0);
  const [brainFeedCount, setBrainFeedCount] = useState(0);
  const [streakCount, setStreakCount] = useState(0);
  
  // --- PRIVATE PERSONAL AI LAB TESTS CONTAINER ---
  const [aiLabTests, setAiLabTests] = useState([]);

  useEffect(() => {
    const syncDashboardLiveParameters = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // 🎯 FIXED: Key mapped dynamically with user UUID token to prevent storage intersection leakages
          const userKey = `infinity_subscribed_exams_${user.id}`;
          const loadedSubs = JSON.parse(localStorage.getItem(userKey)) || [];
          const filteredSubs = loadedSubs.filter(s => s !== 'AI Lab Generated');
          setSubscribedExams(filteredSubs);

          // Fetch real profile name
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, brainfeed_count')
            .eq('id', user.id)
            .single();

          if (profile) {
            if (profile.full_name) setUserName(profile.full_name);
            setBrainFeedCount(profile.brainfeed_count || 0);
          }

          // Fetch mock exam logs
          const { data: sessions, error: sError } = await supabase
            .from('test_sessions')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

          if (!sError && sessions) {
            const submittedSessions = sessions.filter(s => s.status === 'submitted');
            setTotalTests(submittedSessions.length);

            // Sort pinned list based on recent velocity
            const sortedExams = [...filteredSubs].sort((a, b) => {
              const lastSessionA = submittedSessions.find(s => 
                s.folder_name === a || s.category === a || String(s.title || '').toLowerCase().includes(a.toLowerCase())
              );
              const lastSessionB = submittedSessions.find(s => 
                s.folder_name === b || s.category === b || String(s.title || '').toLowerCase().includes(b.toLowerCase())
              );
              const timeA = lastSessionA ? new Date(lastSessionA.created_at).getTime() : 0;
              const timeB = lastSessionB ? new Date(lastSessionB.created_at).getTime() : 0;
              return timeB - timeA; 
            });
            setSubscribedExams(sortedExams);

            // Streak Engine
            const uniqueDates = Array.from(new Set(submittedSessions.map(s => {
              const d = new Date(s.created_at);
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }))).sort((a, b) => b.localeCompare(a));

            let streak = 0;
            if (uniqueDates.length > 0) {
              const now = new Date();
              const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
              
              const yesterdayObj = new Date();
              yesterdayObj.setDate(yesterdayObj.getDate() - 1);
              const yesterdayStr = `${yesterdayObj.getFullYear()}-${String(yesterdayObj.getMonth() + 1).padStart(2, '0')}-${String(yesterdayObj.getDate()).padStart(2, '0')}`;

              if (uniqueDates[0] === todayStr || uniqueDates[0] === yesterdayStr) {
                streak = 1;
                let lastDate = new Date(uniqueDates[0]);
                for (let i = 1; i < uniqueDates.length; i++) {
                  const nextDate = new Date(uniqueDates[i]);
                  const diffDays = Math.round((lastDate - nextDate) / (1000 * 60 * 60 * 24));
                  if (diffDays === 1) {
                    streak++;
                    lastDate = nextDate;
                  } else if (diffDays > 1) {
                    break; 
                  }
                }
              }
            }
            setStreakCount(streak);

            // FETCH PRIVATE USER-SPECIFIC DYNAMIC AI TESTS Snapshots
            const userTestIds = Array.from(new Set(sessions.map(s => s.test_id)))
              .filter(id => id && (id.startsWith('AI-') || id.startsWith('AI_')));

            if (userTestIds.length > 0) {
              const { data: mtData } = await supabase
                .from('mock_tests')
                .select('*')
                .in('id', userTestIds);
              if (mtData) setAiLabTests(mtData);
            }
          }
        }
      } catch (err) {
        console.error("Dashboard database initialization alert:", err);
      }
    };

    syncDashboardLiveParameters();
  }, []);

  const handleUnpinClick = (e, folderName) => {
    e.stopPropagation(); 
    setFolderToUnpin(folderName);
  };

  const handleConfirmUnpin = async () => {
    if (!folderToUnpin) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userKey = user ? `infinity_subscribed_exams_${user.id}` : 'infinity_subscribed_exams';
      const updatedSubs = subscribedExams.filter(s => s !== folderToUnpin);
      setSubscribedExams(updatedSubs);
      localStorage.setItem(userKey, JSON.stringify(updatedSubs));
      setFolderToUnpin(null); 
    } catch (err) {
      console.error(err);
    }
  };

  const handleExploreRedirect = (folderName) => {
    setShowViewAllModal(false);
    setTestSeriesFolder(folderName); 
    setActiveTab('tests'); 
  };

  return (
    <div className="dashboard-wrapper" style={dashboardLayoutWrapper}>
      <style>{`
        .content-view {
          overflow-y: hidden !important;
          height: calc(100vh - 65px) !important;
          display: flex !important;
          flex-direction: column !important;
          padding: 24px 32px !important;
        }
      `}</style>

      <div style={mainSplitFlexLayoutContainer}>
        <div style={leftMainScrollableColumn}>
          <h2 style={{ color: '#0f172a', fontWeight: '900', fontSize: '1.8rem', margin: 0, letterSpacing: '-0.5px' }}>
            Welcome back, {userName}!
          </h2>
          <p style={{ color: '#64748b', marginTop: '4px', fontSize: '0.92rem', fontWeight: '500' }}>
            Bhai, ye raha tera pinned and tracking workspace area:
          </p>
                  
          <div style={{ marginTop: '30px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ color: '#0f172a', margin: 0, fontWeight: '800', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                Pinned Exam Series
              </h3>
              <button type="button" onClick={() => setShowViewAllModal(true)} style={headerSectionViewAllLink}>View All</button>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '20px', paddingBottom: '20px' }}>
              
              {/* INDEPENDENT PRIVATE AI LAB GENERATED FOLDER snaps into Dashboard grid */}
              <div style={{ ...folderCardStyle, border: '1px solid #000000', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }} onClick={() => setShowAiFolderModal(true)}>
                <div style={{ ...folderIconWrapperFrame, background: '#000000' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 2h4M12 2v7M5 21h14M5 21l6-12h2l6 12M7 17h10"/>
                  </svg>
                </div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '1.15rem', fontWeight: '900', color: '#000000' }}>AI Lab Generated</h3>
                <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 20px 0', fontWeight: '600' }}>{aiLabTests.length} custom tests compiled.</p>
                <button type="button" onClick={(e) => { e.stopPropagation(); setShowAiFolderModal(true); }} style={exploreSeriesSolidActionBtn}>Explore Series →</button>
              </div>

              {subscribedExams.map((folder) => (
                <div key={folder} style={folderCardStyle}>
                  <button type="button" onClick={(e) => handleUnpinClick(e, folder)} style={unpinIconCloseWidget}>✕</button>
                  <div style={folderIconWrapperFrame}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2.5"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                  </div>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '1.15rem', fontWeight: '800', color: '#0f172a' }}>{folder}</h3>
                  <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 20px 0', fontWeight: '500' }}>Tracked inside dashboard stream.</p>
                  <button type="button" onClick={() => handleExploreRedirect(folder)} style={exploreSeriesSolidActionBtn}>Explore Series →</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={rightSidebarMetricsFixedArea}>
          <h3 style={{ color: '#0f172a', margin: '0 0 4px 0', fontWeight: '800', fontSize: '1rem' }}>Your Progress Overview</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.7rem', margin: '0 0 16px 0', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Live Platform Index</p>

          <div style={verticalMetricsStackGapLayout}>
            <div style={glanceStatMetricCard}>
              <div style={glanceCardHeaderLineRow}>
                <span style={glanceCardTitleLabel}>BrainFeed Practice</span>
                <div style={glanceIconWrapperCircle}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v12"/><path d="M6 12h12"/></svg>
                </div>
              </div>
              <div style={glanceCardLargeMetricNumber}>{brainFeedCount}</div>
              <div style={glanceCardBottomTrendingIndicatorLine}><span style={{ color: '#10b981', marginRight: '4px' }}>Live</span> metrics track active</div>
            </div>

            <div style={glanceStatMetricCard}>
              <div style={glanceCardHeaderLineRow}>
                <span style={glanceCardTitleLabel}>Tests Attempted</span>
                <div style={glanceIconWrapperCircle}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
              </div>
              <div style={glanceCardLargeMetricNumber}>{totalTests}</div>
              <div style={glanceCardBottomTrendingIndicatorLine}><span style={{ color: '#10b981', marginRight: '4px' }}>Sync</span> database node connected</div>
            </div>

            <div style={glanceStatMetricCard}>
              <div style={glanceCardHeaderLineRow}>
                <span style={glanceCardTitleLabel}>Current Streak</span>
                <div style={glanceIconWrapperCircle}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                </div>
              </div>
              <div style={glanceCardLargeMetricNumber}>{streakCount}</div>
              <div style={glanceCardBottomTrendingIndicatorLine}><span style={{ color: '#f59e0b', fontWeight: '700' }}>{streakCount > 0 ? 'Keep it up!' : 'Start a test today!'}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* 🗂️ DEDICATED IN-APP WORKSPACE WINDOW MODAL FOR PRIVATE AI TESTS */}
      {showAiFolderModal && (
        <div style={modalOverlayStyle} onClick={() => setShowAiFolderModal(false)}>
          <div style={{ ...modalCardStyle, maxWidth: '480px', textAlign: 'left' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontWeight: '900', color: '#0f172a', fontSize: '1.15rem' }}>AI Lab Generated Tests ({aiLabTests.length})</h3>
              <button onClick={() => setShowAiFolderModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer', color: '#94a3b8', fontWeight: 'bold' }}>✕</button>
            </div>
            <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px' }}>
              {aiLabTests.length > 0 ? (
                aiLabTests.map((test) => (
                  <div key={test.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: '#f8fafc', borderRadius: '14px', border: '1px solid #e2e8f0', gap: '15px' }}>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ margin: 0, fontWeight: '800', color: '#0f172a', fontSize: '0.95rem', lineHeight: '1.4' }}>{test.title.replace('🤖 ', '')}</h4>
                      <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: '#64748b', fontWeight: '600' }}>⏱️ {test.time} Mins | 📋 {test.questions} Questions</p>
                    </div>
                    <button 
                      type="button" 
                      onClick={() => {
                        setShowAiFolderModal(false);
                        onStartTest?.({
                          id: test.id,
                          title: test.title,
                          time: test.time,
                          questions: test.questions,
                          questions_list: test.questions_list || [],
                          sections: test.sections || null,
                          hasSectionalTiming: test.has_sectional_timing || false
                        });
                      }} 
                      style={{ background: '#000000', color: '#ffffff', border: 'none', padding: '8px 14px', borderRadius: '8px', fontWeight: '700', fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      Start Test →
                    </button>
                  </div>
                ))
              ) : (
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center', margin: '20px 0', fontWeight: '600', fontStyle: 'italic' }}>No compiled AI tests found. Create one inside AI Lab!</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showViewAllModal && (
        <div style={modalOverlayStyle} onClick={() => setShowViewAllModal(false)}>
          <div style={{ ...modalCardStyle, maxWidth: '420px', textAlign: 'left' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontWeight: '900', color: '#0f172a', fontSize: '1.15rem' }}>All Pinned Series ({subscribedExams.length})</h3>
              <button onClick={() => setShowViewAllModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer', color: '#94a3b8', fontWeight: 'bold' }}>✕</button>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {subscribedExams.map((folder, idx) => (
                <div key={folder} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: '800' }}>#{idx + 1}</span>
                    <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '0.92rem' }}>{folder}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={(e) => handleUnpinClick(e, folder)} style={{ background: '#fee2e2', color: '#ef4444', border: 'none', padding: '6px 12px', borderRadius: '8px', fontWeight: '700', fontSize: '0.78rem', cursor: 'pointer' }}>Unpin</button>
                    <button onClick={() => handleExploreRedirect(folder)} style={{ background: '#000000', color: '#ffffff', border: 'none', padding: '6px 12px', borderRadius: '8px', fontWeight: '700', fontSize: '0.78rem', cursor: 'pointer' }}>Explore</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {folderToUnpin && (
        <div style={modalOverlayStyle} onClick={() => setFolderToUnpin(null)}>
          <div style={modalCardStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px 0', color: '#1e293b', fontWeight: '900', fontSize: '1.35rem' }}>Unpin Exam Series?</h3>
            <p style={{ margin: '0 0 25px 0', color: '#64748b', fontSize: '0.9rem', fontWeight: '500' }}>Bhai, kya tu sach mein "{folderToUnpin}" series ko Dashboard se unpin karna chahta hai?</p>
            <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
              <button onClick={() => setFolderToUnpin(null)} style={cancelBtnStyle}>Cancel</button>
              <button onClick={handleConfirmUnpin} style={confirmUnpinBtnStyle}>Unpin Now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Styles Configuration Map
const dashboardLayoutWrapper = { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' }; const mainSplitFlexLayoutContainer = { display: 'flex', flex: 1, gap: '24px', width: '100%', height: '100%', overflow: 'hidden' }; const leftMainScrollableColumn = { flex: 1, overflowY: 'auto', paddingRight: '4px', height: '100%' }; const headerSectionViewAllLink = { background: 'none', border: 'none', color: '#64748b', fontWeight: '700', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }; const folderCardStyle = { background: '#fff', padding: '20px', borderRadius: '14px', border: '1px solid #e2e8f0', textAlign: 'center', position: 'relative' }; const folderIconWrapperFrame = { width: '48px', height: '48px', borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px auto' }; const exploreSeriesSolidActionBtn = { width: '100%', border: 'none', color: '#fff', background: '#000000', padding: '10px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '0.82rem' }; const unpinIconCloseWidget = { position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.82rem', color: '#94a3b8', fontWeight: 'bold' }; const rightSidebarMetricsFixedArea = { width: '240px', flexShrink: 0, borderLeft: '1px solid #e2e8f0', paddingLeft: '20px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }; const verticalMetricsStackGapLayout = { display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }; const glanceStatMetricCard = { background: '#ffffff', border: '1px solid #e2e8f0', padding: '14px 16px', borderRadius: '12px', textAlign: 'left', width: '100%', boxSizing: 'border-box' }; const glanceCardHeaderLineRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }; const glanceCardTitleLabel = { fontSize: '0.78rem', color: '#475569', fontWeight: '600' }; const glanceIconWrapperCircle = { width: '24px', height: '24px', borderRadius: '50%', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #f1f5f9' }; const glanceCardLargeMetricNumber = { fontSize: '1.75rem', fontWeight: '800', color: '#0f172a', margin: '2px 0', letterSpacing: '-0.5px' }; const glanceCardBottomTrendingIndicatorLine = { fontSize: '0.68rem', color: '#64748b', fontWeight: '500' }; const modalOverlayStyle = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }; const modalCardStyle = { background: '#fff', padding: '28px', borderRadius: '20px', width: '90%', border: '1px solid #e2e8f0', fontFamily: 'Inter, sans-serif' }; const cancelBtnStyle = { flex: 1, padding: '11px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }; const confirmUnpinBtnStyle = { flex: 1.3, padding: '11px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '0.85rem' };

export default Dashboard;