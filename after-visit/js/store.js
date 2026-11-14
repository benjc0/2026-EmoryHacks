// Saves sessions on this device (IndexedDB), so nothing leaves the phone until the patient shares it.
// Later this is where a sync to the backend would hook in (see pushToServer at the bottom).
//
// Three object stores:
//   sessions  – the session record (meta, reps, scores, check-in). Small, so lists are fast.
//   frames    – key "<sessionId>:<exerciseIdx>" -> logged landmark frames for that exercise
//   blobs     – key "<sessionId>:video:<idx>" or "<sessionId>:note" -> video / voice-note Blob
//
// If IndexedDB isn't available (some private-browsing modes), it falls back to memory for this tab.

const DB_NAME = 'after-visit';
const DB_VERSION = 1;

export const videoKey = (sessionId, idx) => `${sessionId}:video:${idx}`;
export const noteKey = (sessionId) => `${sessionId}:note`;
export const framesKey = (sessionId, idx) => `${sessionId}:${idx}`;

const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });

class IdbStore {
  constructor(idb) { this.idb = idb; this.dbP = null; }

  db() {
    this.dbP ??= new Promise((res, rej) => {
      const open = this.idb.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
        if (!db.objectStoreNames.contains('frames')) db.createObjectStore('frames');
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    return this.dbP;
  }

  async put({ record, frames = {}, blobs = {} }) {
    const db = await this.db();
    const tx = db.transaction(['sessions', 'frames', 'blobs'], 'readwrite');
    tx.objectStore('sessions').put(record);
    for (const [idx, fr] of Object.entries(frames)) tx.objectStore('frames').put(fr, framesKey(record.id, idx));
    for (const [key, blob] of Object.entries(blobs)) if (blob) tx.objectStore('blobs').put(blob, key);
    await txDone(tx);
  }

  async get(store, key) {
    const db = await this.db();
    return reqP(db.transaction(store).objectStore(store).get(key));
  }

  async all(store) {
    const db = await this.db();
    return reqP(db.transaction(store).objectStore(store).getAll());
  }

  async patch(id, fn) {
    const db = await this.db();
    const tx = db.transaction('sessions', 'readwrite');
    const os = tx.objectStore('sessions');
    const rec = await reqP(os.get(id));
    if (!rec) throw new Error(`No session ${id}`);
    const next = fn(rec) || rec;
    os.put(next);
    await txDone(tx);
    return next;
  }

  async remove(id) {
    const db = await this.db();
    const tx = db.transaction(['sessions', 'frames', 'blobs'], 'readwrite');
    tx.objectStore('sessions').delete(id);
    const range = IDBKeyRangeFor(this.idb, `${id}:`);
    tx.objectStore('frames').delete(range);
    tx.objectStore('blobs').delete(range);
    await txDone(tx);
  }

  async clear() {
    const db = await this.db();
    const tx = db.transaction(['sessions', 'frames', 'blobs'], 'readwrite');
    for (const s of ['sessions', 'frames', 'blobs']) tx.objectStore(s).clear();
    await txDone(tx);
  }
}

// All keys that start with `prefix`. IDBKeyRange lives on the global in browsers; fake-indexeddb exports it.
function IDBKeyRangeFor(idb, prefix) {
  const KR = idb.IDBKeyRange || globalThis.IDBKeyRange;
  return KR.bound(prefix, `${prefix}￿`);
}

class MemoryStore {
  constructor() { this.s = { sessions: new Map(), frames: new Map(), blobs: new Map() }; }
  async put({ record, frames = {}, blobs = {} }) {
    this.s.sessions.set(record.id, structuredClone(record));
    for (const [idx, fr] of Object.entries(frames)) this.s.frames.set(framesKey(record.id, idx), fr);
    for (const [k, b] of Object.entries(blobs)) if (b) this.s.blobs.set(k, b);
  }
  async get(store, key) { const v = this.s[store].get(key); return store === 'sessions' && v ? structuredClone(v) : v; }
  async all(store) { return [...this.s[store].values()].map((v) => (store === 'sessions' ? structuredClone(v) : v)); }
  async patch(id, fn) {
    const rec = this.s.sessions.get(id);
    if (!rec) throw new Error(`No session ${id}`);
    const draft = structuredClone(rec);
    const next = fn(draft) || draft;
    this.s.sessions.set(id, next);
    return structuredClone(next);
  }
  async remove(id) {
    this.s.sessions.delete(id);
    for (const m of [this.s.frames, this.s.blobs]) for (const k of [...m.keys()]) if (k.startsWith(`${id}:`)) m.delete(k);
  }
  async clear() { for (const m of Object.values(this.s)) m.clear(); }
}

/**
 * Create the store. Pass `indexedDB` to use a specific implementation (tests use fake-indexeddb);
 * pass `memory: true` to force the in-memory fallback.
 */
export function createStore({ indexedDB = globalThis.indexedDB, memory = false } = {}) {
  const backend = !memory && indexedDB ? new IdbStore(indexedDB) : new MemoryStore();
  const persistent = backend instanceof IdbStore;

  return {
    persistent,

    /** Ask the browser not to clear our data when space is low. Safe to call more than once. */
    async keep() { try { return await navigator.storage?.persist?.(); } catch { return false; } },

    /**
     * Save a finished session.
     * @param {import('./sessionLog.js').SessionLog} log
     * @param {{ videos?: Object<number, Blob>, noteAudio?: Blob }} blobs
     */
    async saveSession(log, { videos = {}, noteAudio = null } = {}) {
      const record = log.toRecord();
      const blobs = {};
      for (const [idx, b] of Object.entries(videos)) if (b && b.size) blobs[videoKey(record.id, idx)] = b;
      if (noteAudio && noteAudio.size) blobs[noteKey(record.id)] = noteAudio;
      await backend.put({ record, frames: log.framesByExercise(), blobs });
      return record;
    },

    /** All sessions, newest first. Records only (no frames, no blobs). */
    async listSessions() {
      const all = await backend.all('sessions');
      return all.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    },

    getSession: (id) => backend.get('sessions', id),
    getFrames: async (id, idx) => (await backend.get('frames', framesKey(id, idx))) || [],
    getVideo: (id, idx) => backend.get('blobs', videoKey(id, idx)),
    getNoteAudio: (id) => backend.get('blobs', noteKey(id)),

    /** Update the check-in after saving (e.g. the patient fills in pain on the results screen). */
    updateCheckIn: (id, checkIn) => backend.patch(id, (r) => { r.checkIn = { ...r.checkIn, ...checkIn }; }),

    /** The therapist marks a session as reviewed, with an optional comment back to the patient. */
    markReviewed: (id, { by, comment = '', now = new Date() }) =>
      backend.patch(id, (r) => { r.review = { at: now.toISOString(), by, comment: comment.trim() }; }),

    deleteSession: (id) => backend.remove(id),
    clearAll: () => backend.clear(),

    /** One JSON object with the record and every exercise's frames (no video). For download / upload. */
    async exportSession(id) {
      const record = await backend.get('sessions', id);
      if (!record) return null;
      const frames = {};
      for (const e of record.exercises) frames[e.idx] = (await backend.get('frames', framesKey(id, e.idx))) || [];
      return { ...record, frames };
    },
  };
}

let shared = null;
/** The app-wide store instance. */
export const store = () => (shared ??= createStore());

/**
 * Placeholder for syncing to the team's FastAPI backend later, e.g.
 *   POST /api/pt/sessions  (JSON from exportSession)
 *   PUT  /api/pt/sessions/:id/video/:idx  (Blob)
 * Not called anywhere yet.
 */
export async function pushToServer(baseUrl, exported, videos = {}) {
  const res = await fetch(`${baseUrl}/api/pt/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exported),
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  for (const [idx, blob] of Object.entries(videos)) {
    await fetch(`${baseUrl}/api/pt/sessions/${exported.id}/video/${idx}`, { method: 'PUT', body: blob });
  }
}
