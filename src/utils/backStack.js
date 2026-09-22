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
// A third complication — the "swap": one click closes overlay A and opens
// overlay B in the same React commit (AI Labs config -> confirm, for example).
// history.back() is ASYNCHRONOUS but the browser resolves its target entry at
// call time, so a pushState issued before that traversal lands inserts B's
// marker after A's while the traversal still goes to the entry *before* A.
// The user would end up on the base page with B's marker stranded ahead of
// them, and the next real back press would leave the page a press early.
// So while one of our own programmatic backs is in flight we do NOT push the
// new marker yet: it is queued in `deferredIds` and pushed once that back has
// landed. `failsafeTimer` releases the queue if the popstate never arrives, so
// a lost traversal can never leave registration permanently stuck.
//
// A fourth complication — page loads: history.state SURVIVES a reload, but our
// ids restart at 1 on every load. A marker written before a reload can end up
// being this load's own base entry (or simply sit below it), and its id can
// collide with a live overlay's id. Both would be misread — the first as a dead
// marker to skip past, the second as the live overlay itself. So every marker
// also carries `infinityBackSession`, a value minted once per page load: only
// markers from THIS load count, and a foreign marker on the entry we are about
// to push from is stripped back to an ordinary entry first.
//
// Never push a marker in response to a Back press. Chromium skips (on its Back
// button) any entry from which a page pushed without user activation, and a
// Back press is not user activation. So a screen that goes back to a previous
// screen must NOT re-register it; nest overlays instead (the lower one stays
// registered while the upper one is open).
//
// Plain JS on purpose — no React — so a future Capacitor Android back-button
// listener can call closeTopOverlay() directly.

const MARKER_KEY = 'infinityBackClose';
const SESSION_KEY = 'infinityBackSession';
const SESSION = Math.random().toString(36).slice(2) + Date.now().toString(36);
const FAILSAFE_MS = 1000;

let stack = [];
let nextId = 1;
let pendingBacks = 0;
let skipping = false;
let listenerAttached = false;
let deferredIds = [];
let failsafeTimer = null;

// One of our own programmatic backs is still travelling.
const isBackInFlight = () => pendingBacks > 0 || skipping;

const hasMarker = (s) => s?.[MARKER_KEY] != null;

// Attached lazily on first use and never removed — stale markers can still
// arrive while the stack is empty, and rule 2 needs to see them.
const ensureListener = () => {
  if (!listenerAttached) {
    window.addEventListener('popstate', handlePopState);
    listenerAttached = true;
  }
};

// The marker id only if it belongs to THIS page load; otherwise null.
const liveMarkerId = (s) => (hasMarker(s) && s[SESSION_KEY] === SESSION ? s[MARKER_KEY] : null);

const pushMarker = (id) => {
  const s = window.history.state;
  // A marker left by an earlier page load can be this page's own base entry:
  // make it an ordinary entry again so it is never skipped as a dead marker.
  if (hasMarker(s) && s[SESSION_KEY] !== SESSION) {
    const rest = { ...s };
    delete rest[MARKER_KEY];
    delete rest[SESSION_KEY];
    window.history.replaceState(rest, '');
  }
  window.history.pushState({ [MARKER_KEY]: id, [SESSION_KEY]: SESSION }, '');
};

const clearFailsafe = () => {
  if (failsafeTimer !== null) {
    clearTimeout(failsafeTimer);
    failsafeTimer = null;
  }
};

// Push the markers that were queued while a programmatic back was in flight.
const flushDeferred = () => {
  clearFailsafe();
  while (deferredIds.length > 0) {
    const id = deferredIds.shift();
    // Skip overlays that were closed again before their marker was pushed.
    if (stack.some(o => o.id === id)) {
      pushMarker(id);
    }
  }
};

// The popstate we are waiting for may never arrive (a dropped or swallowed
// traversal). Release the queue rather than deferring registrations forever.
const armFailsafe = () => {
  clearFailsafe();
  failsafeTimer = setTimeout(() => {
    failsafeTimer = null;
    pendingBacks = 0;
    skipping = false;
    flushDeferred();
  }, FAILSAFE_MS);
};

const handlePopState = () => {
  const wasSkipping = skipping;
  skipping = false;

  // 1. Our own programmatic back (an overlay closed itself via the UI).
  if (pendingBacks > 0) {
    pendingBacks--;
    if (pendingBacks === 0) flushDeferred();
    return;
  }

  // 2. Stale marker: its overlay is already closed (or it belongs to an earlier
  //    page load), so skip straight past it rather than making the user press
  //    back twice.
  const s = window.history.state;
  const live = liveMarkerId(s);
  if (hasMarker(s) && !(live != null && stack.some(o => o.id === live))) {
    skipping = true;
    armFailsafe();
    window.history.back();
    return;
  }

  // 3. A landing caused by our own skip is never a user back press.
  if (wasSkipping) {
    flushDeferred();
    return;
  }

  // 4. Real back press: close exactly the topmost overlay.
  //    A foreign marker never matches, so it can never suppress the close.
  const landed = liveMarkerId(s);
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

  ensureListener();

  if (isBackInFlight()) {
    // A swap: pushing now would be overtaken by the in-flight traversal.
    deferredIds.push(id);
  } else {
    // No URL argument: same URL, marker entry only.
    pushMarker(id);
  }
  return id;
};

// The overlay was closed by the UI (or unmounted) rather than by a back press.
export const unregisterOverlay = (id) => {
  const index = stack.findIndex(o => o.id === id);
  // Already removed — a real back press closed it, and history is correct.
  if (index === -1) return;
  stack.splice(index, 1);

  const deferredIndex = deferredIds.indexOf(id);
  if (deferredIndex !== -1) {
    // Its marker was never pushed, so there is nothing to consume.
    deferredIds.splice(deferredIndex, 1);
    return;
  }

  if (liveMarkerId(window.history.state) === id) {
    // The marker is the current entry — consume it so the next back press
    // goes to the previous page instead of a dead entry.
    pendingBacks++;
    armFailsafe();
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
