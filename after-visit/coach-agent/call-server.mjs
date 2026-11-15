// "Call my iPhone": a small local server the patient page calls. It keeps every key on this computer.
//
//   POST /api/call-me     { "video": true }  ->  { callId, message }
//   GET  /api/calls/<id>                     ->  { state, status, message }
//   GET  /api/coach/progress                 ->  where the coach is in the session right now (rep counts only; works through a tunnel too)
//   GET  /api/coach/last                     ->  the last finished coach session
//   GET  /api/health                         ->  { ready, missing? }   (the page hides the button when not ready)
//
// Run: npm run call-server   (with npm start running the agent in another terminal)
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import { bridgeReadyMetadata, buildCallRequest, callState, corsOrigin, findAgent, patientMessage, readConfig } from './outbound.mjs';

const { config, missing } = readConfig();
const calls = new Map(); // callId -> { room, state, status }
let busy = false;

// The coach speaks with Gemini. If Google rejects its key, the coach is silent, Chert's Mac hangs up after 10 s, and the
// patient gets a call that fails. So "ready" includes a quick key check (cached for a minute). If we can't tell
// (offline), we don't block.
const UNAVAILABLE = "Mend isn't available right now. You can still do today's session on your own.";
let keyCheck = { at: 0, ok: true };
async function modelKeyOk() {
  if (Date.now() - keyCheck.at < 60_000) return keyCheck.ok;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
      { headers: { 'x-goog-api-key': process.env.GOOGLE_API_KEY ?? '' }, signal: AbortSignal.timeout(5000) });
    const ok = ![400, 401, 403].includes(r.status);
    if (!ok && keyCheck.ok) console.error(`[call] Google rejected the coach's Gemini key (HTTP ${r.status}). Make a new key at https://aistudio.google.com/apikey, put it in .env.local as GOOGLE_API_KEY, then restart the coach (npm start) and this service.`);
    keyCheck = { at: Date.now(), ok };
  } catch { keyCheck = { at: Date.now(), ok: true }; }
  return keyCheck.ok;
}

const rooms = config && new RoomServiceClient(config.livekitHost, config.livekitKey, config.livekitSecret);
const dispatch = config && new AgentDispatchClient(config.livekitHost, config.livekitKey, config.livekitSecret);

async function chert(path, { method = 'GET', body, key } = {}) {
  const headers = { authorization: `Bearer ${config.chertKey}`, 'x-chert-project-id': config.projectId };
  if (method === 'POST') { headers['idempotency-key'] = key; headers['content-type'] = 'application/json'; }
  const response = await fetch(`${config.chertBase}/api/v1${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

async function waitForAgent(room, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const agent = findAgent(await rooms.listParticipants(room).catch(() => []));
    if (agent) return agent;
    await pause(500);
  }
  return null;
}

async function cleanup(room) {
  await rooms.deleteRoom(room).catch(() => {});
}

/** Watch one call: signal bridge_ready into the room, then release the room when the call is over. */
async function watch(callId, room) {
  const entry = calls.get(callId);
  const end = Date.now() + 15 * 60_000;
  let signalled = false;
  try {
    while (Date.now() < end) {
      const { status, json } = await chert(`/calls/${encodeURIComponent(callId)}`).catch(() => ({ status: 0, json: {} }));
      const record = json?.data ?? json;
      if (status === 200) {
        const state = callState(record);
        entry.state = state; entry.status = record.status;
        if (state === 'terminal') break;
        if (state === 'ready' && !signalled) {
          await rooms.updateRoomMetadata(room, bridgeReadyMetadata(callId));
          signalled = true;
          console.log(`[call] ${callId}: FaceTime is ready, coach greeting`);
        }
      }
      await pause(signalled ? 3000 : 500);
    }
  } finally {
    console.log(`[call] ${callId}: ${entry.status ?? 'unknown'}, cleaning up`);
    await cleanup(room);
    busy = false;
  }
}

async function callMe(video) {
  const room = `coach-out-${randomUUID()}`;
  await rooms.createRoom({ name: room, emptyTimeout: 120, maxParticipants: 4 });
  await dispatch.createDispatch(room, config.agentName, { metadata: JSON.stringify({ chert_outbound: true, media: { audio: true, video } }) });
  const agent = await waitForAgent(room);
  if (!agent) { await cleanup(room); return { http: 503, body: { message: "Mend isn't running yet. Start it and try again." } }; }

  const token = new AccessToken(config.livekitKey, config.livekitSecret, { identity: `chert-bridge-out-${randomUUID().slice(0, 8)}`, ttl: '30m' });
  token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });
  const request = buildCallRequest({ lineId: config.lineId, phone: config.phone, livekitUrl: config.livekitUrl,
    bridgeToken: await token.toJwt(), agentIdentity: agent.identity, video });

  const { status, json } = await chert('/calls', { method: 'POST', body: request, key: `call-me-${randomUUID()}` });
  const callId = json?.data?.id ?? json?.id;
  if (status !== 201 || !callId) {
    await cleanup(room);
    console.error(`[call] Chert refused the call: HTTP ${status} ${json?.error?.code ?? json?.code ?? ''}`);
    const message = status === 409 || /busy|in_use|in_call/i.test(JSON.stringify(json)) ? 'The line is busy. Try again in a few minutes.' : "The call didn't go through. Try again in a minute.";
    return { http: 502, body: { message } };
  }
  calls.set(callId, { room, state: 'waiting', status: 'allocated' });
  void watch(callId, room);
  return { http: 201, body: { callId, message: patientMessage('waiting') } };
}

// The test page is served here too, so one https tunnel (cloudflared) covers the page and its API for a phone.
// Only these files, nothing else from the folder.
const JS = 'text/javascript; charset=utf-8', CSS = 'text/css; charset=utf-8';
const PAGES = {
  '/coach-test.html': ['coach-test.html', 'text/html; charset=utf-8'],
  '/tokens.css': ['tokens.css', CSS], '/results.css': ['results.css', CSS],
  '/js/coachConnection.js': ['js/coachConnection.js', JS], '/js/results.js': ['js/results.js', JS],
  '/js/standGuide.js': ['js/standGuide.js', JS], '/js/escapeHtml.js': ['js/escapeHtml.js', JS],
};
const afterVisit = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));

// A request that came through a tunnel (or anything not this computer) is "remote". Remote requests may use the
// browser test and Call my iPhone. Call my iPhone only ever dials COACH_PATIENT_PHONE from .env.local (the request
// can't choose a number), and remote calls are limited to one every 2 minutes and 4 an hour, so a leaked tunnel
// address can at worst ring the patient's own phone a few times.
const remoteCalls = [];
function remoteCallAllowed() {
  const now = Date.now();
  while (remoteCalls.length && now - remoteCalls[0] > 60 * 60_000) remoteCalls.shift();
  if (remoteCalls.length >= 4 || (remoteCalls.length && now - remoteCalls.at(-1) < 2 * 60_000)) return false;
  remoteCalls.push(now);
  return true;
}
const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
const isRemote = (req) => Boolean(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) || !LOCAL_HOSTS.test(req.headers.host || '');
// At most 5 remote test rooms per 10 minutes, so a leaked address can't drain the Gemini quota.
const remoteStarts = [];
function remoteAllowed() {
  const now = Date.now();
  while (remoteStarts.length && now - remoteStarts[0] > 10 * 60_000) remoteStarts.shift();
  if (remoteStarts.length >= 5) return false;
  remoteStarts.push(now);
  return true;
}

// Browser test (coach-test.html): a room with the coach in it, joined from this computer's mic and camera.
// No FaceTime or Chert line involved. "ready" writes the same bridge_ready signal Chert's call would, so the
// coach greets exactly as it will on a real call.
const testRooms = new Set();
async function testRoom() {
  const room = `coach-test-${randomUUID()}`;
  await rooms.createRoom({ name: room, emptyTimeout: 60, maxParticipants: 3 });
  await dispatch.createDispatch(room, config.agentName, { metadata: JSON.stringify({ coach_test: true }) });
  const token = new AccessToken(config.livekitKey, config.livekitSecret, { identity: `patient-test-${randomUUID().slice(0, 6)}`, ttl: '30m' });
  token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });
  testRooms.add(room);
  return { livekitUrl: config.livekitUrl, token: await token.toJwt(), room };
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 1000) break; }
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': corsOrigin(config?.allowOrigins ?? [], res.req?.headers.origin),
    'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', vary: 'origin',
    // Chrome asks before a public https page (mending.fit) may reach a service on this computer.
    'access-control-allow-private-network': 'true' });
  res.end(JSON.stringify(body));
}

const SESSIONS = fileURLToPath(new URL('./sessions/', import.meta.url));
async function readJsonFile(name) { try { return JSON.parse(await readFile(SESSIONS + name, 'utf8')); } catch { return null; } }

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, 'http://localhost');
    const remote = isRemote(req);
    if (req.method === 'GET' && (url.pathname === '/' || PAGES[url.pathname])) {
      const [file, type] = PAGES[url.pathname] ?? PAGES['/coach-test.html'];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      return res.end(await readFile(afterVisit(file)));
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const keyOk = config ? await modelKeyOk() : true;
      return send(res, 200, remote ? { ready: Boolean(config) && keyOk } : config ? { ready: keyOk, ...(keyOk ? {} : { problem: 'gemini_key_rejected' }) } : { ready: false, missing });
    }
    if (!config) return send(res, 503, { message: 'The call service is not set up yet.' });
    const remoteOk = url.pathname.startsWith('/api/test-room') || url.pathname === '/api/call-me' || url.pathname.startsWith('/api/calls/') || url.pathname.startsWith('/api/coach/');
    if (remote && !remoteOk) return send(res, 403, { message: 'Not available from here.' });
    if (remote && url.pathname === '/api/test-room' && !remoteAllowed()) return send(res, 429, { message: 'Too many test calls. Wait a few minutes and try again.' });

    if (req.method === 'POST' && url.pathname === '/api/call-me') {
      if (busy) return send(res, 409, { message: "You're already on a call with Mend." });
      if (!(await modelKeyOk())) return send(res, 503, { message: UNAVAILABLE });   // a call would connect, then fail in silence
      if (remote && !remoteCallAllowed()) return send(res, 429, { message: 'Mend just called. Wait 2 minutes, then try again.' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 1000) break; }
      const video = (() => { try { return JSON.parse(body || '{}').video !== false; } catch { return true; } })();
      busy = true;
      const result = await callMe(video).catch((error) => {
        console.error('[call] could not start the call:', error?.message ?? error);
        return { http: 500, body: { message: "The call didn't go through. Try again in a minute." } };
      });
      if (result.http !== 201) busy = false;
      return send(res, result.http, result.body);
    }

    if (req.method === 'POST' && url.pathname === '/api/test-room') return send(res, 201, await testRoom());
    if (req.method === 'POST' && url.pathname === '/api/test-room/ready') {
      const { room } = await readJson(req);
      if (!testRooms.has(room)) return send(res, 404, { message: 'No such test room.' });
      await rooms.updateRoomMetadata(room, bridgeReadyMetadata(room));
      return send(res, 200, { ok: true });
    }

    // What the coach is doing right now, and the result of the last call. Reachable through your own tunnel too, so a
    // phone can see its results; the tunnel address is only known to you.
    if (req.method === 'GET' && url.pathname === '/api/coach/progress') {
      const live = await readJsonFile('live.json');
      return send(res, 200, live && Date.now() - (live.updatedAt ?? 0) < 120_000 ? live : { phase: 'none' });
    }
    if (req.method === 'GET' && url.pathname === '/api/coach/last') {
      const last = await readJsonFile('latest.json');
      return send(res, last ? 200 : 404, last ?? { message: 'No coach session yet.' });
    }

    const match = req.method === 'GET' && url.pathname.match(/^\/api\/calls\/([0-9a-f-]{36})$/);
    if (match) {
      const entry = calls.get(match[1]);
      if (!entry) return send(res, 404, { message: 'No such call.' });
      return send(res, 200, { state: entry.state, status: entry.status, message: patientMessage(entry.state, entry.status) });
    }
    send(res, 404, { message: 'Not found.' });
  } catch (error) {
    console.error('[call] request failed:', error?.message ?? error);
    send(res, 500, { message: 'Something went wrong. Try again.' });
  }
});

const port = config?.port ?? 8787;
server.listen(port, '127.0.0.1', () => {
  if (config) console.log(`[call] Call service ready on http://127.0.0.1:${port} (agent "${config.agentName}")`);
  else console.log(`[call] Not set up yet. Fill these in .env.local: ${missing.join(', ')}`);
});
