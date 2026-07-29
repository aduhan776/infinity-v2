import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

function Login() {
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🍎');
  const [isSignUpMode, setIsSignUpMode] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState({ type: '', message: '' });

  const fruitAvatars = ['🍎', '🥭', '🍉', '🍓', '🍊', '🥑'];

  const handleGoogleSignIn = async () => {
    setNotification({ type: '', message: '' });
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (error) throw error;
    } catch (err) {
      setNotification({ type: 'error', message: err.message });
    }
  };

  const handleAuthSubmission = async (e) => {
    e.preventDefault();
    setNotification({ type: '', message: '' });

    if (!authEmail.trim() || !authPassword.trim()) {
      return setNotification({ type: 'error', message: 'Please fill in all fields.' });
    }

    setIsSubmitting(true);

    try {
      if (isSignUpMode) {
        if (!fullName.trim() || !username.trim()) {
          setIsSubmitting(false);
          return setNotification({ type: 'error', message: 'Please fill in all fields.' });
        }

        const { error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
          options: {
            data: {
              full_name: fullName.trim(),
              username: username.trim().toLowerCase(),
              avatar: selectedAvatar,
            }
          }
        });
        
        if (error) throw error;
        setNotification({ type: 'success', message: 'Account created successfully! You can now sign in.' });
        setFullName('');
        setUsername('');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
      }
    } catch (err) {
      setNotification({ type: 'error', message: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleMode = () => {
    setIsSignUpMode(!isSignUpMode);
    setFullName('');
    setUsername('');
    setSelectedAvatar('🍎');
    setNotification({ type: '', message: '' });
  };

  return (
    <div style={fullScreenContainer} className="login-container">
      <style>{`
        @media (max-width: 768px) {
          .login-container { height: 100dvh !important; }
          .login-left-panel { display: none !important; }
          .login-right-panel { flex: 1 !important; padding: 20px !important; }
          .login-form-card { max-width: 100% !important; padding: 28px 22px !important; box-shadow: none !important; border: none !important; }
        }
      `}</style>
      {/* LEFT PANEL: BRAND SHOWCASE */}
      <div style={leftShowcasePanel} className="login-left-panel">
        <div style={brandingWrapper}>
          <div style={brandLogoTarget}>
            <div style={brandLogoTargetInner}></div>
          </div>
          <h1 style={brandingTitle}>NEUXENT<span>.</span></h1>
          <p style={brandingSubtitle}>AI-powered learning and practice. <br/>Continue your preparation journey.</p>
          
          <div style={featureMatrixList}>
            <div style={featureItemRow}>
              <span style={featureIconBox}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              </span> 
              <div><h5 style={featTitle}>AI-Powered Practice</h5><p style={featSub}>Personalized questions and insights powered by AI.</p></div>
            </div>
            <div style={featureItemRow}>
              <span style={featureIconBox}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              </span> 
              <div><h5 style={featTitle}>Track Your Progress</h5><p style={featSub}>Monitor performance and improve consistently.</p></div>
            </div>
            <div style={featureItemRow}>
              <span style={featureIconBox}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span> 
              <div><h5 style={featTitle}>Secure & Private</h5><p style={featSub}>Your data is safe with enterprise-grade security.</p></div>
            </div>
          </div>
        </div>
        <div style={brandingFooter}>
          © 2026 NEUXENT. All rights reserved.
        </div>
      </div>

      {/* RIGHT PANEL: SIMPLE FORM */}
      <div style={rightAuthPanel} className="login-right-panel">
        <div style={formCardMinimal} className="login-form-card">
          
          <h2 style={formHeading}>
            {isSignUpMode ? 'Create Account' : 'Welcome Back'}
          </h2>
          <p style={formSubHeading}>
            {isSignUpMode ? 'Sign up to access your NEUXENT workspace' : 'Sign in to access your NEUXENT workspace'}
          </p>

          {notification.message && (
            <div style={{...notificationBanner, background: notification.type === 'error' ? '#fee2e2' : '#dcfce7', color: notification.type === 'error' ? '#ef4444' : '#15803d', border: notification.type === 'error' ? '1px solid #fca5a5' : '1px solid #86efac'}}>
              {notification.message}
            </div>
          )}

          <button type="button" onClick={handleGoogleSignIn} style={googleBtnCardStyle}>
            <svg width="18" height="18" viewBox="0 0 24 24" style={{ display: 'block' }}>
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.53-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-8.72z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.11 0-5.74-2.11-6.68-4.96H1.21v3.15C3.18 21.88 7.31 24 12 24z"/>
              <path fill="#FBBC05" d="M5.32 14.24A7.16 7.16 0 0 1 5 12c0-.79.13-1.57.32-2.34V6.51H1.21A11.94 11.94 0 0 0 0 12c0 1.92.45 3.74 1.21 5.39l4.11-3.15z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.18 2.12 1.21 5.65l4.11 3.15c.94-2.85 3.57-4.96 6.68-4.96z"/>
            </svg>
            Continue with Google
          </button>

          <div style={orDividerMinimalRow}>
            <div style={orDividerMinimalLine}></div>
            <span style={orDividerMinimalText}>OR</span>
            <div style={orDividerMinimalLine}></div>
          </div>

          <form onSubmit={handleAuthSubmission} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {isSignUpMode && (
              <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                <div style={{ position: 'relative' }}>
                  <span style={inputIconLeftStyle}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </span>
                  <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full name" style={inputCardStyle} />
                </div>
                <div style={{ position: 'relative' }}>
                  <span style={inputIconLeftStyle}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                  </span>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" style={inputCardStyle} />
                </div>
                <div>
                  <label style={minimalLabelStyle}>Select avatar 🍎</label>
                  <div style={fruitSelectorMatrixGrid}>
                    {fruitAvatars.map((fruit) => (
                      <button
                        key={fruit}
                        type="button"
                        onClick={() => setSelectedAvatar(fruit)}
                        style={{...fruitSelectorWidget, background: selectedAvatar === fruit ? '#f1f5f9' : 'none', border: selectedAvatar === fruit ? '2px solid #1e293b' : '2px solid #e2e8f0'}}
                      >
                        {fruit}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div style={{ position: 'relative' }}>
              <span style={inputIconLeftStyle}>
                {/* Clean Vector Outline Envelope */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </span>
              <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="Email address" style={inputCardStyle} />
            </div>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={inputIconLeftStyle}>
                {/* Clean Vector Outline Padlock */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </span>
              <input type={showPassword ? "text" : "password"} value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="Password" style={{ ...inputCardStyle, paddingRight: '45px' }} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} style={eyeToggleIconBtnStyle}>
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>

            {!isSignUpMode && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" id="rememberMe" style={{ accentColor: '#000', width: '15px', height: '15px', cursor: 'pointer' }} />
                  <label htmlFor="rememberMe" style={{ color: '#475569', cursor: 'pointer', fontWeight: '500' }}>Remember me</label>
                </div>
                <a href="#" style={{ color: '#000', fontWeight: '600', textDecoration: 'underline' }}>Forgot password?</a>
              </div>
            )}
            
            <button type="submit" disabled={isSubmitting} style={{ ...actionBtnSolidDark, background: isSubmitting ? '#94a3b8' : '#000' }}>
              {isSubmitting ? 'Please wait...' : (isSignUpMode ? 'Create Account' : 'Sign In')}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '25px', color: '#64748b', fontSize: '0.88rem' }}>
            {isSignUpMode ? 'Already have an account?' : "Don't have an account?"} 
            <button type="button" onClick={handleToggleMode} style={{ background: 'none', border: 'none', color: '#000', fontWeight: '700', marginLeft: '5px', fontSize: 'inherit', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
              {isSignUpMode ? 'Sign in' : 'Create one'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

const fullScreenContainer = { display: 'flex', height: '100vh', background: '#fff', fontFamily: 'Inter, sans-serif' };
const leftShowcasePanel = { flex: 1, background: '#f8fafc', padding: '60px', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', borderRight: '1px solid #e2e8f0' };
const rightAuthPanel = { flex: 1.1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' };
const brandingWrapper = { maxWidth: '450px', margin: '0 auto', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' };
const brandLogoTarget = { width: '70px', height: '70px', border: '7px solid #1e293b', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '25px' };
const brandLogoTargetInner = { width: '22px', height: '22px', background: '#1e293b', borderRadius: '50%' };
const brandingTitle = { fontSize: '2.5rem', fontWeight: '900', color: '#000', margin: 0, letterSpacing: '-1px', marginBottom: '10px' };
const brandingSubtitle = { fontSize: '0.95rem', color: '#64748b', margin: 0, fontWeight: '500', lineHeight: '1.6' };
const brandingFooter = { position: 'absolute', bottom: '30px', left: '30px', fontSize: '0.8rem', color: '#94a3b8' };
const featureMatrixList = { textAlign: 'left', marginTop: '40px', display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' };
const featureItemRow = { display: 'flex', gap: '15px', alignItems: 'center' };
const featureIconBox = { fontSize: '1.4rem', display: 'flex', alignItems: 'center' };
const featTitle = { margin: 0, color: '#1e293b', fontWeight: '700', fontSize: '0.95rem' };
const featSub = { margin: '2px 0 0 0', color: '#64748b', fontSize: '0.85rem', fontWeight: '500' };
const formCardMinimal = { background: '#fff', padding: '40px', borderRadius: '24px', width: '100%', maxWidth: '400px', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.02)' };
const formHeading = { fontSize: '1.8rem', fontWeight: '800', color: '#000', margin: 0 };
const formSubHeading = { fontSize: '0.88rem', color: '#64748b', marginTop: '6px', marginBottom: '25px', fontWeight: '500' };
const notificationBanner = { padding: '12px', borderRadius: '10px', fontSize: '0.85rem', fontWeight: '600', textAlign: 'left', marginBottom: '20px' };
const googleBtnCardStyle = { width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontWeight: '600', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', cursor: 'pointer' };
const orDividerMinimalRow = { display: 'flex', alignItems: 'center', margin: '20px 0', color: '#e2e8f0' };
const orDividerMinimalLine = { flex: 1, height: '1px', background: '#e2e8f0' };
const orDividerMinimalText = { padding: '0 10px', fontSize: '0.75rem', fontWeight: '700', color: '#94a3b8' };
const minimalLabelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: '700', color: '#475569', marginBottom: '6px' };
const inputCardStyle = { width: '100%', padding: '12px 16px 12px 48px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '1rem', outline: 'none', background: '#fff', fontWeight: '500' };
const inputIconLeftStyle = { position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' };
const eyeToggleIconBtnStyle = { position: 'absolute', right: '14px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' };
const fruitSelectorMatrixGrid = { display: 'flex', gap: '5px', marginTop: '5px', background: '#f8fafc', padding: '6px', borderRadius: '12px', border: '1px solid #e2e8f0', justifyContent: 'space-between' };
const fruitSelectorWidget = { fontSize: '1.4rem', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const actionBtnSolidDark = { width: '100%', border: 'none', color: '#fff', padding: '14px', borderRadius: '12px', fontWeight: '700', fontSize: '0.95rem', marginTop: '10px', cursor: 'pointer' };

export default Login;