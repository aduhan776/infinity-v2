// --- 🌐 INFINITY LOCAL STORAGE ENGINE — SINGLE SOURCE OF TRUTH ---
//
// Every page that touches IndexedDB imports from this file and ONLY this file.
//
// WHY THIS EXISTS (do not re-inline this logic into pages):
// IndexedDB fires `onupgradeneeded` exactly once per version bump, and whichever
// page happens to open the database FIRST on a given device is the one whose
// upgrade handler runs. Previously AiTests, TestPortal, Library and AnalysisPortal
// each carried their own copy of this logic, and the copies had drifted:
// Library and AnalysisPortal never created the `ai_mock_tests` store. So on any
// device where a user happened to land on Library or AnalysisPortal first, that
// store was never created — and every later `ai_mock_tests` transaction threw
// `NotFoundError: One of the specified object stores was not found` forever,
// because the version number never changed so the upgrade never re-ran.
//
// With one shared module the store list cannot drift again.
//
// 🚨 CHANGING THE SCHEMA:
// - Adding a store: add it to STORES AND bump DB_VERSION. Bumping is what
//   re-runs the upgrade on devices that already have an older database on
//   disk — without it, existing devices never get the new store.
// - Removing a store (like ai_mock_tests below): just remove it from
//   STORES. No bump needed for a plain removal — nothing here actively
//   deletes the old object store from devices that already have it (it's
//   simply never opened/written again), so leaving DB_VERSION alone is
//   safe and avoids an unnecessary upgrade cycle for everyone else.

const DB_NAME = 'InfinityLocalDB';

// ENGINE VERSION 4 — bumped from 3 to repair devices that were left with an
// incomplete store set by the old per-page upgrade handlers. AI Labs tests
// no longer live here at all (moved to Supabase's ai_generated_tests table),
// so the ai_mock_tests store was removed from STORES below — this did not
// require a further bump (see the schema-change note above).
const DB_VERSION = 4;

// The complete store list. Anything not in here does not exist.
export const STORES = {
  TEST_SESSIONS: 'test_sessions',
  SAVED_QUESTIONS: 'saved_questions',
};

const ALL_STORES = Object.values(STORES);

// Cached connection so we don't reopen the database on every single call
// (autosave in TestPortal runs on a timer — reopening each tick is wasteful).
let dbPromise = null;

/**
 * Open (and if needed upgrade) the local database.
 * Resolves with an IDBDatabase. All stores in STORES are guaranteed to exist.
 */
export const initLocalDB = () => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('IndexedDB is not available in this browser context'));
      return;
    }

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Create every store in one place. `contains` guard keeps this safe to
      // re-run on devices at any prior version.
      ALL_STORES.forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      });
    };

    request.onsuccess = (e) => {
      const db = e.target.result;

      // If another tab later opens this DB at a higher version, our held
      // connection would block that upgrade. Close ours and drop the cache so
      // the next call reopens cleanly.
      db.onversionchange = () => {
        try { db.close(); } catch { /* already closed */ }
        dbPromise = null;
      };

      resolve(db);
    };

    request.onerror = (e) => {
      dbPromise = null; // let a later call retry rather than caching a failure
      reject(e.target.error);
    };

    // Fires when another tab holds an older connection open and is preventing
    // our upgrade. Surfacing it beats hanging silently forever.
    request.onblocked = () => {
      console.warn(
        'Local storage upgrade is blocked by another open tab of this app. ' +
        'Close other tabs and reload to finish the upgrade.'
      );
    };
  });

  return dbPromise;
};

/** Read a single record by id. Resolves null when the record does not exist. */
export const getFromLocalStore = async (storeName, id) => {
  const db = await initLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
};

/** Read every record in a store. Resolves [] when the store is empty. */
export const getAllFromLocalStore = async (storeName) => {
  const db = await initLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
};

/** Insert or overwrite a record. The payload must carry an `id` field. */
export const saveToLocalStore = async (storeName, payload) => {
  const db = await initLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(payload);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

/** Delete a record by id. Resolves even when the id was not present. */
export const deleteFromLocalStore = async (storeName, id) => {
  const db = await initLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};