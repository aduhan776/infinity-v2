import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { hasTestTicket } from '../utils/testTicket';

// --- 🎟️ TEST ROUTE GATE ---
// Renders the test screen only for an entry the user actually arrived at by
// starting or resuming a test. A finished test leaves its /test-portal/:id
// entry behind in history, and landing back on it used to restart the test.
//
// The decision is made ONCE, at mount, and never re-checked on later renders:
// finishTestHandler revokes the ticket while TestPortal is still mounted
// (submitting), so a per-render check would wrongly bounce the very test that
// is being submitted.
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

  if (allowed) return children;
  if (!canStepBack) return <Navigate to="/dashboard" replace />;
  return null;
};

export default TestRouteGate;
