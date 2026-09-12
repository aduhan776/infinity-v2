import { supabase } from '../supabaseClient';

// 🛡️ authFetch — use this instead of raw fetch() for ANY call to our backend
// (Render-hosted index.js). It automatically attaches the current user's
// Supabase session token as an Authorization header, so the backend can
// verify who is really making the request — no more sending studentId in
// the request body, and no more trusting whatever the client claims.
//
// Usage (before):
//   fetch(`${BACKEND_URL}/api/pool/serve-questions`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ studentId: user.id, subject, topic, ... })
//   })
//
// Usage (after):
//   authFetch(`${BACKEND_URL}/api/pool/serve-questions`, {
//     method: 'POST',
//     body: JSON.stringify({ subject, topic, ... }) // no studentId needed anymore
//   })

export async function authFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    // No logged-in session — fail early with a clear error instead of
    // letting the backend reject it with a less obvious 401.
    throw new Error('Not logged in. Please log in again.');
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    Authorization: `Bearer ${session.access_token}`,
  };

  return fetch(url, { ...options, headers });
}