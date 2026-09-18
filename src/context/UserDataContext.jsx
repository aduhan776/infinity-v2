import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { authFetch } from '../utils/apiClient';

// --- 🌐 SHARED LIGHTWEIGHT USER DATA CONTEXT ---
// Every screen used to fetch the same few profile fields for itself (header
// name, BrainFeed counters, admin flag, credit balances), so a single
// navigation session could hit the `profiles` table four or five separate
// times for data that never changes between pages. This context fetches that
// set ONCE per authenticated user and hands it to whoever needs it.
//
// What lives here: only the small, shared, display-level fields. Anything
// that belongs to a single screen (Profile's full editable row, the username
// uniqueness check during signup, etc.) deliberately stays where it is.

const DEFAULT_USER_DATA = {
  full_name: null,
  brainfeed_count: 0,
  brainfeed_accuracy: 0,
  is_admin: false,
  brainfeed_credits: null, // null = not loaded yet (screens render "Loading...")
  ai_labs_credits: null,   // null = not loaded yet
};

const UserDataContext = createContext(null);

export function UserDataProvider({ children }) {
  const [userData, setUserData] = useState(DEFAULT_USER_DATA);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);

  // Which user id we've already fetched for. Guards against re-fetching on
  // every TOKEN_REFRESHED / re-render — the fetch should happen once, when a
  // user becomes authenticated, not on navigation and not on an interval.
  const fetchedForUserRef = useRef(null);

  // --- 🔐 TRACK WHO IS LOGGED IN ---
  useEffect(() => {
    let isMounted = true;

    const applyUser = (session) => {
      if (!isMounted) return;
      const id = session?.user?.id ?? null;
      setUserId(id);
      if (!id) {
        // Signed out — drop everything so the next user never sees stale data.
        fetchedForUserRef.current = null;
        setUserData(DEFAULT_USER_DATA);
        setLoading(false);
      }
    };

    supabase.auth.getSession()
      .then(({ data: { session } }) => applyUser(session))
      .catch(() => applyUser(null));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applyUser(session);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // --- 📥 ONE COMBINED LOAD (profile row + credits route) ---
  const loadUserData = useCallback(async (uid) => {
    setLoading(true);

    // Both sources are fetched in parallel and neither is allowed to break
    // the other — a failing credits route still leaves the profile fields
    // populated, and vice versa.
    const profilePromise = supabase
      .from('profiles')
      .select('full_name, brainfeed_count, brainfeed_accuracy, is_admin')
      .eq('id', uid)
      .single()
      .then(({ data, error }) => (error ? null : data))
      .catch(() => null);

    const creditsPromise = (async () => {
      try {
        const response = await authFetch(
          `${import.meta.env.VITE_API_BASE_URL}/api/credits`,
          { method: 'GET' }
        );
        const data = await response.json();
        return data && data.success ? data : null;
      } catch (err) {
        console.warn('Could not fetch credits for shared user data (non-blocking):', err);
        return null;
      }
    })();

    const [profile, credits] = await Promise.all([profilePromise, creditsPromise]);

    setUserData({
      full_name: profile?.full_name ?? null,
      brainfeed_count: profile?.brainfeed_count || 0,
      brainfeed_accuracy: profile?.brainfeed_accuracy || 0,
      is_admin: profile?.is_admin === true,
      brainfeed_credits: typeof credits?.brainfeedCredits === 'number' ? credits.brainfeedCredits : null,
      ai_labs_credits: typeof credits?.aiLabsCredits === 'number' ? credits.aiLabsCredits : null,
    });

    setLoading(false);
  }, []);

  useEffect(() => {
    if (!userId) return; // signed out — state is reset by the auth listener above
    if (fetchedForUserRef.current === userId) return; // already loaded for this user
    fetchedForUserRef.current = userId;
    loadUserData(userId);
  }, [userId, loadUserData]);

  // --- 🔄 MANUAL FULL REFRESH ---
  // Nothing calls this automatically; it exists so a future flow that changes
  // these fields outside the app can force a fresh read.
  const refresh = useCallback(async () => {
    if (!userId) return;
    await loadUserData(userId);
  }, [userId, loadUserData]);

  // --- ⚡ INSTANT LOCAL UPDATES (no network round-trip) ---
  // Call sites that already receive the authoritative new value back from the
  // backend push it in here, so every screen reading this context updates
  // immediately instead of waiting on a re-fetch.
  const updateCredits = useCallback(({ brainfeedCredits, aiLabsCredits } = {}) => {
    setUserData(prev => ({
      ...prev,
      ...(typeof brainfeedCredits === 'number' ? { brainfeed_credits: brainfeedCredits } : {}),
      ...(typeof aiLabsCredits === 'number' ? { ai_labs_credits: aiLabsCredits } : {}),
    }));
  }, []);

  const updateBrainfeedStats = useCallback(({ brainfeedCount, brainfeedAccuracy } = {}) => {
    setUserData(prev => ({
      ...prev,
      ...(typeof brainfeedCount === 'number' ? { brainfeed_count: brainfeedCount } : {}),
      ...(typeof brainfeedAccuracy === 'number' ? { brainfeed_accuracy: brainfeedAccuracy } : {}),
    }));
  }, []);

  const value = {
    ...userData,
    loading,
    refresh,
    refetch: refresh, // alias — both names are available to call sites
    updateCredits,
    updateBrainfeedStats,
  };

  return (
    <UserDataContext.Provider value={value}>
      {children}
    </UserDataContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUserData() {
  const context = useContext(UserDataContext);
  if (!context) {
    throw new Error('useUserData() must be used inside a <UserDataProvider>.');
  }
  return context;
}
