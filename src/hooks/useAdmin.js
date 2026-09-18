import { useUserData } from '../context/UserDataContext';

// --- 🛡️ ADMIN ROLE HOOK ---
// This used to run its own `profiles.select('is_admin')` query per consumer,
// which meant the same lookup happened again on every screen that cared about
// the admin flag. The flag now comes from the shared user data context (one
// combined profile fetch per authenticated user), so this hook is just a thin
// adapter — the `(session)` signature and the `{ isAdmin, loading }` shape it
// returns are unchanged, so existing call sites need no edits.
const useAdmin = (session) => {
  const { is_admin, loading } = useUserData();

  // No session means no admin rights, and nothing to wait on — same as before.
  if (!session?.user) {
    return { isAdmin: false, loading: false };
  }

  return { isAdmin: is_admin === true, loading };
};

export default useAdmin;
