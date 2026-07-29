import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; // ⚡ Linked cloud connection gateway

const Profile = () => {
  const [loading, setLoading] = useState(true);
  const [savingTarget, setSavingTarget] = useState(false);
  
  // --- USER CORE DATA STATES ---
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [targetExam, setTargetExam] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  
  // --- DYNAMIC PERFORMANCE STATS STATES ---
  const [totalTestsGiven, setTotalTestsGiven] = useState(0);

  // --- 🎯 LOAD AUTHENTICATED PROFILE CORE ENGINE ---
  const loadUserProfileData = async () => {
    setLoading(true);
    try {
      // 1. Fetch current active session from Supabase Auth
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError) throw authError;

      if (user) {
        setEmail(user.email || '');
        // Auto-fill metadata parameters mapped during signup
        setFullName(user.user_metadata?.full_name || '');
        setUsername(user.user_metadata?.username || '');

        // 2. Fetch extended profile options from custom table
        const { data: profileRow, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (!profileError && profileRow) {
          if (profileRow.full_name) setFullName(profileRow.full_name);
          if (profileRow.username) setUsername(profileRow.username);
          setTargetExam(profileRow.target_exam || '');
          setIsAdmin(profileRow.is_admin || false);
        }

        // 3. Dynamic Stats Query: Calculate real tests count from test_sessions
        const { count, error: statsError } = await supabase
          .from('test_sessions')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('status', 'submitted');

        if (!statsError && count !== null) {
          setTotalTestsGiven(count);
        }
      }
    } catch (err) {
      console.error("Profile execution layer synchronization fault:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserProfileData();
  }, []);

  // --- 💾 AUTO-SAVE TARGET EXAM ON BLUR (FIELD FOCUS OUT) ---
  const handleAutoSaveTargetExam = async (value) => {
    setSavingTarget(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error } = await supabase
          .from('profiles')
          .update({
            target_exam: value.trim(),
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id);

        if (error) throw error;
      }
    } catch (err) {
      console.error("Target Exam synchronization fault:", err);
      alert("Error saving Target Exam change.");
    } finally {
      setSavingTarget(false);
    }
  };

  if (loading) {
    return (
      <div style={loadingWrapper}>
        <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🛰️</div>
        <h3 style={{ color: '#1e293b', fontWeight: '900' }}>Loading Secured Profile Vault...</h3>
        <p style={{ color: '#64748b', fontSize: '0.85rem' }}>Fetching live student allocation parameters from cloud database</p>
      </div>
    );
  }

  return (
    <div style={profileContainer} className="pf-container">
      <style>{`
        @media (max-width: 768px) {
          .pf-container { padding: 16px !important; }
          .pf-grid { grid-template-columns: 1fr !important; gap: 20px !important; }
          .pf-form-row { flex-direction: column !important; gap: 0 !important; }
        }
      `}</style>
      <header style={{ marginBottom: '35px' }}>
        <h1 style={{ fontSize: '2.4rem', fontWeight: '900', color: '#1e293b', margin: 0 }}>Student Profile</h1>
        <p style={{ color: '#64748b', marginTop: '5px', fontWeight: '600' }}>View your verified parameters and platform identity details.</p>
      </header>

      <div style={profileWorkspaceGrid} className="pf-grid">
        {/* LEFT CARD: ACCOUNT BADGE SUMMARY */}
        <div style={badgeCard}>
          <div style={avatarCircle}>
            {fullName ? fullName.charAt(0).toUpperCase() : 'S'}
          </div>
          <h2 style={{ color: '#1e293b', fontWeight: '900', margin: '15px 0 5px 0', fontSize: '1.4rem' }}>{fullName || 'Anonymous Student'}</h2>
          <p style={{ color: '#6366f1', fontWeight: '800', margin: '0 0 25px 0', fontSize: '0.9rem' }}>@{username || 'username'}</p>
          
          {/* DYNAMIC PERFORMANCE MILESTONES COUNTER CONTAINER */}
          <div style={statsDashboardRow}>
            <div style={statWidget}>
              <span style={statCountText}>{totalTestsGiven}</span>
              <span style={statLabelText}>Tests Submitted</span>
            </div>
            <div style={statWidget}>
              <span style={{...statCountText, color: isAdmin ? '#6366f1' : '#10b981'}}>
                {isAdmin ? 'Admin' : 'Student'}
              </span>
              <span style={statLabelText}>System Role</span>
            </div>
          </div>
        </div>

        {/* RIGHT CARD: CORE CONFIGURATION SETTINGS FORM */}
        <div style={settingsCard}>
          <h3 style={{ margin: '0 0 25px 0', color: '#1e293b', fontWeight: '800', fontSize: '1.2rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '15px' }}>
             ⚙️ Verified Parameters Vault
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={formFlexRow} className="pf-form-row">
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Full Name <span style={lockBadge}>Fixed</span></label>
                <input type="text" style={{ ...inputStyle, background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }} value={fullName} readOnly />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Unique System Username <span style={lockBadge}>Fixed</span></label>
                <input type="text" style={{ ...inputStyle, background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }} value={username} readOnly />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Authenticated Email Address <span style={lockBadge}>Fixed</span></label>
              <input type="email" style={{ ...inputStyle, background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' }} value={email} readOnly />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={labelStyle}>Target Competitive Exam / Class Goal</label>
                {savingTarget && <span style={{ fontSize: '0.7rem', color: '#6366f1', fontWeight: 'bold' }}>Auto-saving...</span>}
              </div>
              <input 
                type="text" 
                style={{ ...inputStyle, border: '1px solid #6366f1', background: '#fff' }} 
                value={targetExam} 
                onChange={e => setTargetExam(e.target.value)} 
                onBlur={(e) => handleAutoSaveTargetExam(e.target.value)}
                placeholder="e.g. UPSC CSE, NEET 2026, IIT-JEE" 
              />
              <span style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '4px', display: 'block', fontWeight: '500' }}>
                💡 Tip: This field updates automatically in the database when you click outside.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- CSS-IN-JS EXPERT PROFILE UI STYLES SCHEMAS ---
const profileContainer = { padding: '30px', maxWidth: '1100px', margin: '0 auto', animation: 'fadeIn 0.25s ease' };
const profileWorkspaceGrid = { display: 'grid', gridTemplateColumns: '1fr 1.7fr', gap: '35px', alignItems: 'start' };
const badgeCard = { background: '#fff', padding: '40px 30px', borderRadius: '24px', border: '1px solid #e2e8f0', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.015)', display: 'flex', flexDirection: 'column', alignItems: 'center' };
const settingsCard = { background: '#fff', padding: '35px', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.015)' };
const avatarCircle = { width: '90px', height: '90px', background: '#e0e7ff', color: '#6366f1', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.5rem', fontWeight: '900', boxShadow: '0 4px 10px rgba(99,102,241,0.15)' };
const statsDashboardRow = { display: 'flex', gap: '15px', width: '100%', marginTop: '5px' };
const statWidget = { flex: 1, background: '#fcfdfe', border: '1px solid #e2e8f0', padding: '14px 10px', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '4px' };
const statCountText = { fontSize: '1.4rem', fontWeight: '900', color: '#1e293b' };
const statLabelText = { fontSize: '0.7rem', color: '#94a3b8', fontWeight: 'bold', textTransform: 'uppercase' };
const labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: 'bold', color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const inputStyle = { width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '1rem', outline: 'none', background: '#f8fafc', fontWeight: '500', boxSizing: 'border-box' };
const formFlexRow = { display: 'flex', gap: '20px', width: '100%' };
const lockBadge = { fontSize: '0.62rem', background: '#fee2e2', color: '#ef4444', padding: '2px 8px', borderRadius: '4px', marginLeft: '8px', fontWeight: 'bold' };
const loadingWrapper = { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '80vh', background: '#fff' };

export default Profile;