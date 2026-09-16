import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

// 📱 The page a student lands on after scanning the QR code shown on the
// subjective question panel. Deliberately tiny: pick/shoot photos, watch
// them upload, done. There is no login here — the token in the URL is the
// only authorisation, and it expires a few minutes after the desktop
// opened the window, so this page also runs the same countdown and locks
// itself when time is up.
//
// Photos never pass through our server: the backend hands out a one-shot
// signed Storage URL and the phone PUTs the file straight to Supabase.

const ACCENT = '#7065BA';

const MobileUpload = () => {
  const [status, setStatus] = useState('checking'); // checking | ready | expired | finished
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [files, setFiles] = useState([]); // { name, state: 'uploading'|'done'|'failed' }
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef(null);
  const expiresAtRef = useRef(null);

  const token = new URLSearchParams(window.location.search).get('t') || '';
  const API = import.meta.env.VITE_API_BASE_URL;

  // --- Validate the scanned token up front ---
  useEffect(() => {
    const verify = async () => {
      if (!token) {
        setStatus('expired');
        return;
      }
      try {
        const res = await fetch(`${API}/api/qr/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (!data.success) {
          setStatus('expired');
          return;
        }
        expiresAtRef.current = data.expiresAt;
        setSecondsLeft(Math.max(0, Math.round((data.expiresAt - Date.now()) / 1000)));
        setStatus('ready');
      } catch {
        setErrorMsg('Could not reach the server. Check your connection and try again.');
        setStatus('expired');
      }
    };
    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Same countdown the desktop is running ---
  useEffect(() => {
    if (status !== 'ready') return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.round((expiresAtRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setStatus('expired');
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  // --- Shrink photos before sending, exactly as the desktop does ---
  const compressImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1600;
        let { width, height } = img;
        if (width > height && width > MAX) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else if (height > MAX) {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Could not process image'))),
          'image/jpeg',
          0.7
        );
      };
      img.onerror = () => reject(new Error('Could not read image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

  const uploadOne = async (file, slotIndex) => {
    try {
      const isImage = file.type.startsWith('image/');
      const body = isImage ? await compressImage(file) : file;
      const sendName = isImage ? (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg' : file.name;
      const sendType = isImage ? 'image/jpeg' : file.type;

      const urlRes = await fetch(`${API}/api/qr/signed-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, fileName: sendName })
      });
      const urlData = await urlRes.json();
      if (!urlData.success) {
        if (urlData.expired) setStatus('expired');
        throw new Error(urlData.error || 'Upload session rejected');
      }

      // uploadToSignedUrl is the supported way to use a signed upload token —
      // a bare PUT to the signed URL gets rejected for a missing
      // authorization header. No login is needed: the token authorises it.
      const { error: upErr } = await supabase.storage
        .from('subjective-uploads')
        .uploadToSignedUrl(urlData.path, urlData.uploadToken, body, { contentType: sendType });

      if (upErr) throw upErr;

      setFiles(prev => prev.map((f, i) => (i === slotIndex ? { ...f, state: 'done' } : f)));
    } catch (err) {
      console.error('QR upload failed:', err);
      setFiles(prev => prev.map((f, i) => (i === slotIndex ? { ...f, state: 'failed' } : f)));
    }
  };

  const handlePick = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length === 0) return;

    setFiles(prev => {
      const startIndex = prev.length;
      picked.forEach((file, i) => uploadOne(file, startIndex + i));
      return [...prev, ...picked.map(f => ({ name: f.name || 'photo.jpg', state: 'uploading' }))];
    });

    e.target.value = null;
  };

  const doneCount = files.filter(f => f.state === 'done').length;
  const stillUploading = files.some(f => f.state === 'uploading');
  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={title}>Upload your answer</h1>

        {status === 'checking' && <p style={muted}>Checking your session...</p>}

        {status === 'expired' && (
          <>
            <div style={expiredBox}>
              <p style={{ ...expiredText, margin: 0 }}>
                {errorMsg || 'This upload session has expired.'}
              </p>
            </div>
            <p style={muted}>
              Reopen the QR code on your computer and scan it again to continue uploading.
            </p>
            {doneCount > 0 && (
              <p style={{ ...muted, marginTop: '10px' }}>
                {doneCount} photo{doneCount === 1 ? '' : 's'} already sent before the session ended — those are safe on your computer.
              </p>
            )}
          </>
        )}

        {status === 'finished' && (
          <>
            <div style={doneBox}>
              <p style={{ ...doneText, margin: 0 }}>All done</p>
            </div>
            <p style={muted}>
              {doneCount} photo{doneCount === 1 ? '' : 's'} sent. You can close this page and go back to your computer.
            </p>
          </>
        )}

        {status === 'ready' && (
          <>
            <div style={timerRow}>
              <span style={muted}>Session closes in</span>
              <span style={{ ...timerValue, color: secondsLeft <= 30 ? '#dc2626' : ACCENT }}>{mmss}</span>
            </div>

            <button style={pickBtn} onClick={() => fileInputRef.current.click()}>
              Take Photo / Choose File
            </button>
            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept="image/*,.pdf"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handlePick}
            />

            {files.length > 0 && (
              <div style={list}>
                {files.map((f, i) => (
                  <div key={i} style={listRow}>
                    <span style={listName}>{f.name}</span>
                    <span style={{
                      ...listState,
                      color: f.state === 'done' ? '#059669' : f.state === 'failed' ? '#dc2626' : '#64748b'
                    }}>
                      {f.state === 'done' ? 'Sent' : f.state === 'failed' ? 'Failed' : 'Sending...'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button
              style={{ ...finishBtn, opacity: stillUploading ? 0.5 : 1 }}
              disabled={stillUploading}
              onClick={() => setStatus('finished')}
            >
              {stillUploading ? 'Sending photos...' : 'Finish Uploading'}
            </button>

            <p style={{ ...muted, marginTop: '14px', fontSize: '0.76rem' }}>
              Photos appear on your computer within a few seconds of sending.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

const wrap = { minHeight: '100dvh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'Inter, system-ui, sans-serif', boxSizing: 'border-box' };
const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '18px', padding: '26px 22px', width: '100%', maxWidth: '420px', boxShadow: '0 4px 20px rgba(0,0,0,0.04)', boxSizing: 'border-box' };
const title = { color: '#0f172a', fontSize: '1.25rem', fontWeight: '900', margin: '0 0 16px 0' };
const muted = { color: '#64748b', fontSize: '0.85rem', fontWeight: '500', lineHeight: '1.55', margin: 0 };
const timerRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f1f5f9', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px' };
const timerValue = { fontSize: '1.05rem', fontWeight: '800', fontVariantNumeric: 'tabular-nums' };
const pickBtn = { width: '100%', background: ACCENT, color: '#fff', border: 'none', borderRadius: '12px', padding: '16px', fontSize: '0.95rem', fontWeight: '700', cursor: 'pointer' };
const finishBtn = { width: '100%', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '0.9rem', fontWeight: '700', cursor: 'pointer', marginTop: '14px' };
const list = { marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' };
const listRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '9px', padding: '10px 12px' };
const listName = { color: '#334155', fontSize: '0.8rem', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const listState = { fontSize: '0.76rem', fontWeight: '700', whiteSpace: 'nowrap' };
const expiredBox = { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px' };
const expiredText = { color: '#b91c1c', fontSize: '0.86rem', fontWeight: '700' };
const doneBox = { background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px' };
const doneText = { color: '#065f46', fontSize: '0.86rem', fontWeight: '700' };

export default MobileUpload;
