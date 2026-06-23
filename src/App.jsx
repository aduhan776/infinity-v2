import React, { useState, useEffect } from 'react'; 
import BrainFeed from './pages/BrainFeed';
import Dashboard from './pages/Dashboard';
import TestSeries from './pages/TestSeries';
import AiTests from './pages/AiTests'; 
import Profile from './pages/Profile';
import Library from './pages/Library'; 
import TestPortal from './pages/TestPortal'; 
import AnalysisPortal from './pages/AnalysisPortal';
import Statistics from './pages/Statistics';
import CustomBuilder from './pages/CustomBuilder';
import Login from './pages/Login'; 
import './App.css';
import { supabase } from './supabaseClient'; 
import useAdmin from './hooks/useAdmin'; // 🎯 REUSABLE CUSTOM HOOK LINKED

function App() {
  // --- 🛰️ GLOBAL AUTH STATES ---
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // --- 🛡️ GLOBAL ADMIN ACCESS PRIVILEGES TRACKER ---
  const { isAdmin, loading: adminHookLoading } = useAdmin(); // Live system role state

  // --- CORE SYSTEM APPLICATION STATES ---
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isTestActive, setIsTestActive] = useState(false);
  const [currentTestData, setCurrentTestData] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const [sharedTestInvite, setSharedTestInvite] = useState(null); 
  const [testSeriesFolder, setTestSeriesFolder] = useState(null);
  
  // --- LIVE IN-APP WINDOW NOTIFICATION DROPDOWN STATE ---
  const [showNotifications, setShowNotifications] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // --- REACTIVE HEADER PROFILE STATE ---
  const [headerUser, setHeaderUser] = useState({
    name: "Student"
  });

  // --- 🔄 SUPABASE AUTH LIFECYCLE LISTENER ---
  useEffect(() => {
    const validateActiveSession = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      
      if (currentSession) {
        const { error } = await supabase.auth.getUser();
        if (error) {
          await supabase.auth.signOut();
          setSession(null);
        } else {
          setSession(currentSession);
        }
      } else {
        setSession(null);
      }
      setAuthLoading(false);
    };

    validateActiveSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        const { error } = await supabase.auth.getUser();
        if (error) {
          await supabase.auth.signOut();
          setSession(null);
          setAuthLoading(false);
          return;
        }
      }
      setSession(currentSession);
      setAuthLoading(false);
    });

    window.addEventListener('focus', validateActiveSession);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('focus', validateActiveSession);
    };
  }, []);

  const handleSignOutAction = async () => {
    await supabase.auth.signOut();
    setActiveTab('dashboard');
    setShowLogoutModal(false);
  };

  const handleGoBack = () => {
    if (activeTab === 'dashboard') return; 
    if (activeTab === 'tests' && testSeriesFolder) {
      setTestSeriesFolder(null);
    } else {
      setActiveTab('dashboard');
    }
  };

  // --- DEEP LINK URL HANDLER ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedAttemptId = params.get('attemptId');
    const sharedTestId = params.get('testId');
    if (sharedAttemptId) {
      const history = JSON.parse(localStorage.getItem('infinity_test_history')) || [];
      const sharedTest = history.find(t => t.attemptId === sharedAttemptId);
      if (sharedTest) {
        setTestResults(sharedTest);
        setActiveTab('analysis-portal');
        window.history.replaceState({}, document.title, "/");
      }
    } 
    else if (sharedTestId) {
      setSharedTestInvite({ id: sharedTestId, title: "Shared Mock Test" });
      window.history.replaceState({}, document.title, "/");
    }
  }, []);

  // --- LIVE HEADER PROFILE SYNCHRONIZATION LOOP ---
  useEffect(() => {
    const syncHeaderProfile = async () => {
      if (!session?.user) {
        setHeaderUser({ name: "Student" });
        return;
      }

      try {
        const { data: profileRow } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', session.user.id)
          .single();

        if (profileRow) {
          setHeaderUser({
            name: profileRow.full_name || session.user.user_metadata?.full_name || session.user.email.split('@')[0]
          });
        } else {
          setHeaderUser({
            name: session.user.user_metadata?.full_name || session.user.email.split('@')[0]
          });
        }
      } catch (err) {
        setHeaderUser({
          name: session.user.user_metadata?.full_name || session.user.email.split('@')[0]
        });
      }
    };
    
    syncHeaderProfile();
    window.addEventListener('focus', syncHeaderProfile);
    return () => {
      window.removeEventListener('focus', syncHeaderProfile);
    };
  }, [session, activeTab]);

  const startTestHandler = (test) => {
    setCurrentTestData(test);
    setIsTestActive(true);
    setTestResults(null);
  };

  const handleResumeTest = (savedSnapshot) => {
    setCurrentTestData(savedSnapshot); 
    setIsTestActive(true);
    setTestResults(null);
  };

  const handleViewAnalysis = (oldReport) => {
    setTestResults(oldReport);
    setActiveTab('analysis-portal');
    setIsTestActive(false);
  };

  const finishTestHandler = (finalReport) => {
    setIsTestActive(false);
    if (finalReport) {
      setTestResults(finalReport);
      setActiveTab('analysis-portal');
    } else {
      setActiveTab('dashboard');
    }
  };

  const getNameInitials = (nameString) => {
    if (!nameString || nameString === "Student") return "ST";
    const blocks = nameString.trim().split(' ');
    if (blocks.length >= 2) {
      return (blocks[0][0] + blocks[1][0]).toUpperCase();
    }
    return blocks[0].substring(0, 2).toUpperCase();
  };

  if (authLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ fontSize: '3rem', marginBottom: '15px' }}>⚡</div>
        <h3 style={{ color: '#1e293b', fontWeight: '900', fontSize: '1.3rem' }}>Initializing NEUXENT...</h3>
        <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '5px', fontWeight: '500' }}>Securing cloud gateway database layer authentication hooks</p>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <div className="app-container" style={{ background: '#ffffff' }}>
      <style>{`
        :root {
          --primary: #000000 !important;
          --bg-dark: #ffffff !important;
          --bg-light: #ffffff !important;
        }
        .app-container {
          background-color: #ffffff !important;
        }
        .sidebar {
          background-color: #ffffff !important;
          border-right: 1px solid #e2e8f0 !important;
          padding: 24px 16px !important;
          width: 260px !important;
        }
        .logo h1 {
          color: #000000 !important;
          font-weight: 900 !important;
          letter-spacing: -0.8px !important;
        }
        .logo span {
          color: #000000 !important;
        }
        .menu {
          gap: 4px !important;
          margin-top: 15px !important;
        }
        .menu button {
          color: #475569 !important;
          font-weight: 500 !important;
          font-size: 0.92rem !important;
          padding: 10px 14px !important;
          border-radius: 8px !important;
          display: flex !important;
          align-items: center !important;
          gap: 12px !important;
          transition: all 0.15s ease !important;
          background: none !important;
        }
        .menu button svg {
          stroke: #475569 !important;
          transition: all 0.15s ease !important;
        }
        .menu button:hover {
          background-color: #f1f5f9 !important;
          color: #000000 !important;
        }
        .menu button:hover svg {
          stroke: #000000 !important;
        }
        .menu button.active {
          background-color: #000000 !important;
          color: #ffffff !important;
          font-weight: 600 !important;
        }
        .menu button.active svg {
          stroke: #ffffff !important;
        }
        .main-content {
          background-color: #ffffff !important;
        }
        .top-bar {
          height: 65px !important;
          background-color: #ffffff !important;
          border-bottom: 1px solid #e2e8f0 !important;
          padding: 0 32px !important;
        }
        .content-view {
          padding: 32px !important;
          background-color: #ffffff !important;
        }
      `}</style>

      {/* 🎁 IN-APP TEST INVITATION MODAL */}
      {sharedTestInvite && (
        <div style={modalOverlay}>
          <div style={inviteModal}>
            <h2 style={{color: '#000000', margin: '0 0 10px 0'}}>🎁 Test Invitation!</h2>
            <p style={{fontWeight: '600', color: '#475569', fontSize: '0.9rem'}}>Bhai, tere dost ne tere liye ek mock test share kiya hai.</p>
            <div style={inviteCard}>
               <div style={{fontSize: '0.75rem', color: '#94a3b8', fontWeight: '700'}}>TEST TITLE</div>
               <div style={{fontWeight: '800', color: '#000', marginTop: '4px'}}>{sharedTestInvite.title}</div>
            </div>
            <div style={{display: 'flex', gap: '10px', marginTop: '20px'}}>
              <button style={cancelBtn} onClick={() => setSharedTestInvite(null)}>Maybe Later</button>
              <button style={confirmBtn} onClick={() => {
                startTestHandler({ ...sharedTestInvite, time: 180, questions: 100 });
                setSharedTestInvite(null);
              }}>Start Test Now 🚀</button>
            </div>
          </div>
        </div>
      )}

      {/* 🛑 IN-APP SESSION SIGNOUT CONFIRMATION MODAL */}
      {showLogoutModal && (
        <div style={modalOverlay}>
          <div style={inviteModal}>
            <h2 style={{color: '#000000', margin: '0 0 10px 0'}}>🛑 Sign Out Session</h2>
            <p style={{fontWeight: '600', color: '#475569', fontSize: '0.9rem'}}>Bhai, kya tu sach mein apna active practice session close karna chahta hai?</p>
            <div style={{display: 'flex', gap: '10px', marginTop: '25px'}}>
              <button style={cancelBtn} onClick={() => setShowLogoutModal(false)}>Nahi, Ruuk</button>
              <button style={confirmBtn} onClick={handleSignOutAction}>Sign Out Securely</button>
            </div>
          </div>
        </div>
      )}

      {!isTestActive && activeTab !== 'analysis-portal' && (
        <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="logo" style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingLeft: '8px', marginBottom: '24px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="6"/>
              <circle cx="12" cy="12" r="2"/>
            </svg>
            <h1 style={{ margin: 0, fontSize: '1.35rem' }}>NEUXENT<span>.</span></h1>
          </div>
          
          <nav className="menu" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <button className={activeTab === 'dashboard' ? 'active' : ''} onClick={() => setActiveTab('dashboard')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
              </svg>
              Dashboard
            </button>
            <button className={activeTab === 'BrainFeed' ? 'active' : ''} onClick={() => setActiveTab('BrainFeed')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v12"/><path d="M6 12h12"/></svg>
              BrainFeed
            </button>
            <button className={activeTab === 'aitests' ? 'active' : ''} onClick={() => setActiveTab('aitests')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 2h4M12 2v7M5 21h14M5 21l6-12h2l6 12M7 17h10"/>
              </svg>
              AI Lab
            </button>
            <button className={activeTab === 'tests' ? 'active' : ''} onClick={() => { setActiveTab('tests'); setTestSeriesFolder(null); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              Test Series
            </button>
            <button className={activeTab === 'library' ? 'active' : ''} onClick={() => setActiveTab('library')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Library
            </button>
            <button className={activeTab === 'statistics' ? 'active' : ''} onClick={() => setActiveTab('statistics')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              Statistics
            </button>
            
            {/* 🛡️ TAREQE 1 SECURITY INTERFACE: Custom Builder Tab strictly hidden from normal students */}
            {isAdmin && (
              <button className={activeTab === 'custom-builder' ? 'active' : ''} onClick={() => setActiveTab('custom-builder')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
                Custom Builder
              </button>
            )}
            
            <button onClick={() => setShowLogoutModal(true)} style={{ color: '#64748b', padding: '10px 14px', marginTop: '12px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Log Out Session
            </button>

            <div style={upgradeSectionCard}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', fontSize: '0.82rem', color: '#0f172a' }}>
                <span style={{ color: '#f59e0b' }}>👑</span> NEUXENT Pro
              </div>
              <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '6px 0 12px 0', lineHeight: '1.4', fontWeight: '500' }}>
                Unlock advanced analytics, AI insights and more.
              </p>
              <button type="button" style={upgradeCardActionBtn}>
                Upgrade Now
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>
            </div>

            <div style={helpLinkActionRow}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Help & Support
            </div>
          </nav>
        </aside>
      )}

      <main className="main-content" style={{ padding: (isTestActive || activeTab === 'analysis-portal') ? '0' : '20px' }}>
        {!isTestActive && activeTab !== 'analysis-portal' && (
          <header className="top-bar" style={{ display: 'flex', alignItems: 'center', gap: '20px', background: 'none', border: 'none', boxShadow: 'none' }}>
            <button 
              onClick={handleGoBack} 
              disabled={activeTab === 'dashboard'} 
              style={{
                ...globalBackBtnStyle,
                opacity: activeTab === 'dashboard' ? 0.3 : 1,
                cursor: activeTab === 'dashboard' ? 'not-allowed' : 'pointer',
                backgroundColor: '#fff'
              }} 
              title={activeTab === 'dashboard' ? "You are on home page" : "Go Back"}
            >
              ↩ Back
            </button>

            <div className="search-box" style={searchEngineWrapperContainer}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="text" placeholder="Search for exams, topics, tests..." style={searchFieldInputBoxInputBoxOverride} />
              <span style={searchShortCutBadgeKeyboard}>Ctrl /</span>
            </div>
            
            <div className="top-bar-actions" style={{ gap: '20px', display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <button type="button" onClick={() => setShowNotifications(!showNotifications)} style={utilityHeaderIconButton}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                </button>
                
                {showNotifications && (
                  <div style={notificationDropdownCardOverlay}>
                    No new notifications for now
                  </div>
                )}
              </div>

              <div className={`user-profile-btn ${activeTab === 'profile' ? 'active-profile' : ''}`} onClick={() => setActiveTab('profile')} style={cleanHeaderProfileContainerNoAvatar}>
                <div style={initialsProfileCapsuleCircular}>
                  {getNameInitials(headerUser.name)}
                </div>
                <div className="profile-info" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                  <span className="user-name" style={{ fontSize: '0.88rem', fontWeight: '600', color: '#0f172a' }}>{headerUser.name}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
              </div>
            </div>
          </header>
        )}

        <section className="content-view" style={{ height: (isTestActive || activeTab === 'analysis-portal') ? '100vh' : 'auto' }}>
          {isTestActive ? (
            <TestPortal testData={currentTestData} onExit={finishTestHandler} />
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <Dashboard setActiveTab={setActiveTab} setTestSeriesFolder={setTestSeriesFolder} onStartTest={startTestHandler} />
              )}
              {activeTab === 'statistics' && <Statistics />}
              {activeTab === 'BrainFeed' && <BrainFeed />}
              {activeTab === 'aitests' && <AiTests onStartTest={startTestHandler} />}
              {activeTab === 'tests' && (
                <TestSeries 
                  onStartTest={startTestHandler}
                  selectedFolder={testSeriesFolder}
                  setSelectedFolder={setTestSeriesFolder}
                  onViewAnalysis={handleViewAnalysis}
                />
              )}
              {activeTab === 'library' && (
                <Library onResumeTest={handleResumeTest} onViewAnalysis={handleViewAnalysis} onStartTest={startTestHandler} />
              )}
              {activeTab === 'analysis-portal' && testResults && (
                <AnalysisPortal results={testResults} onBackToDashboard={() => setActiveTab('dashboard')} />
              )}
              {/* 🛡️ TAREQE 1 GATEWAY GUARD: Double checking admin permissions before rendering component */}
              {activeTab === 'custom-builder' && (
                isAdmin ? (
                  <CustomBuilder onStartTest={startTestHandler} />
                ) : (
                  <Dashboard setActiveTab={setActiveTab} setTestSeriesFolder={setTestSeriesFolder} onStartTest={startTestHandler} />
                )
              )}
              {activeTab === 'profile' && <Profile />}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

// --- HOUSING STYLE OBJECT ARCHITECTURES ---
const globalBackBtnStyle = { background: '#fff', border: '1px solid #e2e8f0', padding: '8px 14px', borderRadius: '10px', fontWeight: '700', color: '#475569', display: 'flex', alignItems: 'center', fontSize: '0.82rem', transition: 'all 0.2s ease' };
const modalOverlay = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' };
const inviteModal = { background: '#fff', padding: '30px', borderRadius: '20px', width: '380px', textAlign: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.12)', border: '1px solid #e2e8f0', fontFamily: 'Inter, sans-serif' };
const inviteCard = { background: '#f8fafc', padding: '15px', borderRadius: '12px', margin: '15px 0', border: '1px solid #e2e8f0' };
const cancelBtn = { flex: 1, padding: '12px', background: '#f1f5f9', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', color: '#475569', fontSize: '0.85rem' };
const confirmBtn = { flex: 1.5, padding: '12px', background: '#000000', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' };
const searchEngineWrapperContainer = { flex: 1, maxWidth: '440px', position: 'relative', display: 'flex', alignItems: 'center' };
const searchFieldInputBoxInputBoxOverride = { width: '100%', padding: '10px 80px 10px 42px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '0.88rem', fontWeight: '500', outline: 'none', color: '#0f172a' };
const searchShortCutBadgeKeyboard = { position: 'absolute', right: '12px', background: '#ffffff', border: '1px solid #e2e8f0', padding: '3px 8px', borderRadius: '6px', fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600', pointerEvents: 'none' };
const utilityHeaderIconButton = { background: 'none', border: 'none', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const notificationDropdownCardOverlay = { position: 'absolute', top: '100%', right: 0, marginTop: '10px', background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 10px 25px rgba(0,0,0,0.06)', borderRadius: '10px', padding: '14px 20px', width: '220px', zIndex: 1000, textAlign: 'center', fontSize: '0.82rem', fontWeight: '600', color: '#64748b', whiteSpace: 'nowrap' };
const cleanHeaderProfileContainerNoAvatar = { display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' };
const initialsProfileCapsuleCircular = { width: '32px', height: '32px', background: '#f1f5f9', color: '#475569', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: '700', border: '1px solid #e2e8f0' };
const upgradeSectionCard = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginTop: 'auto', marginBottom: '16px', textAlign: 'left' };
const upgradeCardActionBtn = { width: '100%', border: 'none', background: '#ffffff', color: '#000000', padding: '8px 12px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'pointer', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' };
const helpLinkActionRow = { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.88rem', color: '#64748b', padding: '8px 12px', cursor: 'pointer', fontWeight: '500', borderTop: '1px solid #f1f5f9', paddingTop: '16px' };

export default App;