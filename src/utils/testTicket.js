// --- 🎟️ TEST ENTRY TICKET ---
// The /test-portal/:testId route may only render the test screen if the user
// explicitly started or resumed a test. Without this, a finished test's route
// entry stays in history (finishTestHandler navigates with { replace: true },
// which only replaces the entry currently on top) and a later Back press lands
// on it and starts the test again by itself.
//
// Two layers on purpose:
//  * a module-level memory flag, which covers the whole in-app flow, and
//  * sessionStorage, which SURVIVES a reload of the same tab — so a mid-test
//    F5 still resumes as before — and is EMPTY in a new tab, so pasting or
//    typing /test-portal/... into a fresh tab never starts a test.
//
// Plain JS, no React, so router-level code and plain handlers can both use it.

const KEY = 'infinity_test_ticket';

let memoryTicket = false;

export const grantTestTicket = () => {
  memoryTicket = true;
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // Storage unavailable (private mode, blocked site data) — the memory flag
    // still covers the in-app flow; only reload-resume loses its ticket.
  }
};

export const revokeTestTicket = () => {
  memoryTicket = false;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable — the memory flag above is already cleared.
  }
};

export const hasTestTicket = () => {
  if (memoryTicket) return true;
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
