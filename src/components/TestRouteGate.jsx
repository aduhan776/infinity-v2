import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { grantTestTicket, hasTestTicket, isPageUnloading, revokeTestTicket } from '../utils/testTicket';

// --- 🎟️ TEST ROUTE GATE ---
// Renders the test screen only for an entry the user actually arrived at by
// starting or resuming a test. A finished test leaves its /test-portal/:id
// entry behind in history, and landing back on it used to restart the test.
//
// The decision is made ONCE, at mount, and never re-checked on later renders:
// finishTestHandler revokes the ticket while TestPortal is still mounted
// (submitting), so a per-render check would wrongly bounce the very test that
// is being submitted.
//
// The gate also HOLDS the ticket for as long as the test screen is shown and
// takes it back when the screen is left in-app, so leaving by Back (which never
// reaches finishTestHandler) cannot be undone with Forward.
const TestRouteGate = ({ children }) => {
  const [allowed] = useState(() => hasTestTicket());
  const navigate = useNavigate();
  const location = useLocation();
  const handledKeyRef = useRef(null);

  // react-router stores each entry's position in window.history.state.idx
  // (0 = first entry). idx > 0 means an earlier entry of this app exists.
  const canStepBack = (window.history.state?.idx ?? 0) > 0;

  useEffect(() => {
    if (allowed || !canStepBack) return;
    if (handledKeyRef.current === location.key) return; // StrictMode / re-render guard: one step per entry
    handledKeyRef.current = location.key;
    navigate(-1);
  }, [allowed, canStepBack, location.key, navigate]);

  // While the test screen is shown, hold the ticket; when it is left in-app (Back-exit,
  // sidebar, anything that is not finishTestHandler) take it back, so Forward onto this
  // entry cannot reopen the test. Re-granting in setup keeps StrictMode's dev
  // setup -> cleanup -> setup ending in "granted". A real reload/close never revokes,
  // so F5 mid-test still resumes.
  useEffect(() => {
    if (!allowed) return;
    grantTestTicket();
    return () => { if (!isPageUnloading()) revokeTestTicket(); };
  }, [allowed]);

  if (allowed) return children;
  if (!canStepBack) return <Navigate to="/dashboard" replace />;
  return null;
};

export default TestRouteGate;
