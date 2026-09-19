// --- 🔙 SHARED BACK STACK ---
// One back press must close exactly ONE thing: the topmost open popup /
// drawer / sub-screen if there is one, otherwise normal page navigation.
//
// How it works: every overlay that opens pushes a marker history entry
// (same URL, state = { infinityBackClose: <id> }) and remembers its close
// callback here. A real back press therefore lands on the entry *below* the
// topmost marker, and the popstate handler closes that one overlay instead
// of letting the router navigate away.
//
// Two complications this handles:
//  * An overlay closed by its own ✕ / cancel button leaves its marker sitting
//    on top of the history stack. If that marker is still the current entry we
//    quietly consume it with history.back() (counted in `pendingBacks` so the
//    resulting popstate is ignored). If the same click also navigated, the
//    marker is buried and is skipped later by rule 2 instead.
//  * Landing on a marker whose overlay is already gone (a stale marker) would
//    otherwise cost the user a second back press, so we immediately go back
//    once more (`skipping`), and that skip landing never closes an overlay.
//
// Plain JS on purpose — no React — so a future Capacitor Android back-button
// listener can call closeTopOverlay() directly.

const MARKER_KEY = 'infinityBackClose';

let stack = [];
let nextId = 1;
let pendingBacks = 0;
let skipping = false;
let listenerAttached = false;

const handlePopState = () => {
  const wasSkipping = skipping;
  skipping = false;

  // 1. Our own programmatic back (an overlay closed itself via the UI).
  if (pendingBacks > 0) {
    pendingBacks--;
    return;
  }

  // 2. Stale marker: its overlay is already closed, so skip straight past it
  //    rather than making the user press back twice.
  const landed = window.history.state?.[MARKER_KEY];
  if (landed != null && !stack.some(o => o.id === landed)) {
    skipping = true;
    window.history.back();
    return;
  }

  // 3. A landing caused by our own skip is never a user back press.
  if (wasSkipping) return;

  // 4. Real back press: close exactly the topmost overlay.
  const top = stack[stack.length - 1];
  if (top && landed !== top.id) {
    stack.pop();
    top.close();
  }
};

// Registers an open overlay and pushes its marker history entry.
export const registerOverlay = (close) => {
  const id = nextId++;
  stack.push({ id, close });

  // Attached lazily on first use and never removed — stale markers can still
  // arrive while the stack is empty, and rule 2 needs to see them.
  if (!listenerAttached) {
    window.addEventListener('popstate', handlePopState);
    listenerAttached = true;
  }

  // No URL argument: same URL, marker entry only.
  window.history.pushState({ [MARKER_KEY]: id }, '');
  return id;
};

// The overlay was closed by the UI (or unmounted) rather than by a back press.
export const unregisterOverlay = (id) => {
  const index = stack.findIndex(o => o.id === id);
  // Already removed — a real back press closed it, and history is correct.
  if (index === -1) return;
  stack.splice(index, 1);

  if (window.history.state?.[MARKER_KEY] === id) {
    // The marker is the current entry — consume it so the next back press
    // goes to the previous page instead of a dead entry.
    pendingBacks++;
    window.history.back();
  }
  // Otherwise the marker is buried (the same click also navigated); leave it
  // alone, rule 2 skips it when the user eventually lands on it.
};

// Exported for a future Capacitor Android hardware-back listener.
// Not wired anywhere yet.
export const closeTopOverlay = () => {
  if (stack.length === 0) return false;
  window.history.back();
  return true;
};
