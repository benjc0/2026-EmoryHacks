// The dashboard's link to the AI coach's call service (after-visit/coach-agent/call-server.mjs).
// That service keeps every key on the coach's own computer; this page only asks it to place a FaceTime call
// to the patient's phone (the number lives in its .env.local, so the page can't choose who gets called).
//
// Where the service is: open the dashboard as  index.html?coach=https://<address>  (remembered on this device),
// otherwise it's assumed to run on this computer (http://127.0.0.1:8787, for local testing).
// No DOM here, so it can be tested in Node.

export const COACH_URL_KEY = 'mend.coachUrl';
export const DEFAULT_COACH_URL = 'http://127.0.0.1:8787';
export const UNAVAILABLE = "Your coach isn't available right now. You can still do today's session on your own.";

/** "https://x.trycloudflare.com/anything" -> "https://x.trycloudflare.com". Empty string if it isn't an http(s) address. */
export function cleanUrl(value) {
  try {
    const u = new URL(String(value));
    return /^https?:$/.test(u.protocol) ? u.origin : '';
  } catch { return ''; }
}

/** The coach service address: ?coach=... (and remember it), else the saved one, else this computer. */
export function coachUrl(href, storage) {
  const fromLink = new URL(href).searchParams.get('coach');
  let saved = null;
  try { saved = storage?.getItem(COACH_URL_KEY); } catch { /* storage blocked */ }
  const picked = cleanUrl(fromLink ?? saved ?? '') || DEFAULT_COACH_URL;
  if (fromLink && cleanUrl(fromLink)) { try { storage?.setItem(COACH_URL_KEY, picked); } catch { /* storage blocked */ } }
  return picked;
}

/** Is the coach's call service up and set up? */
export async function coachHealth(base, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${base}/api/health`, { signal: AbortSignal.timeout(4000) });
    return Boolean((await r.json().catch(() => ({}))).ready);
  } catch { return false; }
}

/** Ask the coach to FaceTime the patient. Resolves { ok, callId?, message } with plain-language text. */
export async function startCall(base, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${base}/api/call-me`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ video: true }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 201 && j.callId) return { ok: true, callId: j.callId, message: j.message };
    return { ok: false, message: j.message || UNAVAILABLE };
  } catch { return { ok: false, message: UNAVAILABLE }; }
}

/**
 * Follow a call until it ends (or maxMs passes), calling onUpdate({ state, message }) as it changes.
 * state: 'waiting' (ringing), 'ready' (coach is on the line), 'terminal' (ended or failed).
 */
export async function watchCall(base, callId, onUpdate, {
  fetchImpl = fetch, intervalMs = 3000, maxMs = 20 * 60_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    await sleep(intervalMs);
    try {
      const r = await fetchImpl(`${base}/api/calls/${callId}`);
      const j = await r.json().catch(() => ({}));
      if (j.message) onUpdate(j);
      if (j.state === 'terminal' || r.status === 404) return j;
    } catch { /* a dropped request: keep following */ }
  }
  return null;
}
