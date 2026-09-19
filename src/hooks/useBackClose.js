import { useEffect, useRef } from 'react';
import { registerOverlay, unregisterOverlay } from '../utils/backStack';

// --- 🔙 BACK-CLOSES-THIS-OVERLAY HOOK ---
// Pass the overlay's own open flag and its own close handler. While the
// overlay is open a marker history entry is held for it, so one back press
// closes exactly this overlay (if it is the topmost one) instead of
// navigating the page. Closing it from the UI cleans the marker up again.
//
// `onClose` must do exactly what the overlay's own ✕ / cancel button does —
// this hook never invents behaviour of its own.
const useBackClose = (isOpen, onClose) => {
  // The latest close handler, kept in a ref so re-created inline arrow
  // functions don't re-register the overlay on every render. Updated inside
  // an effect (never during render) to satisfy the react-hooks rules.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const id = registerOverlay(() => closeRef.current());
    return () => unregisterOverlay(id);
  }, [isOpen]);
};

export default useBackClose;
