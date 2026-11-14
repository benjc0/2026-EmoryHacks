// The dashboard's link to the AI coach's call service.  Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, coachUrl, coachHealth, startCall, watchCall, COACH_URL_KEY, DEFAULT_COACH_URL, UNAVAILABLE } from '../js/coachConnection.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });

test('cleanUrl keeps only http(s) origins', () => {
  assert.equal(cleanUrl('https://x.trycloudflare.com/coach-test.html?a=1'), 'https://x.trycloudflare.com');
  assert.equal(cleanUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url', '', undefined]) assert.equal(cleanUrl(bad), '', String(bad));
});

test('coachUrl: link wins and is remembered; saved is used next; this computer is the default; junk is ignored', () => {
  const s = memory();
  assert.equal(coachUrl('https://mending.fit/', s), DEFAULT_COACH_URL);
  assert.equal(coachUrl('https://mending.fit/?coach=https://a.example/x', s), 'https://a.example');
  assert.equal(s.m.get(COACH_URL_KEY), 'https://a.example');
  assert.equal(coachUrl('https://mending.fit/', s), 'https://a.example');                  // remembered
  assert.equal(coachUrl('https://mending.fit/?coach=javascript:alert(1)', s), DEFAULT_COACH_URL);
  assert.equal(s.m.get(COACH_URL_KEY), 'https://a.example');                                // junk not saved
  assert.equal(coachUrl('https://mending.fit/', { getItem() { throw new Error('blocked'); } }), DEFAULT_COACH_URL);
});

test('coachHealth is true only when the service says it is ready, and never throws', async () => {
  assert.equal(await coachHealth('http://x', reply(200, { ready: true })), true);
  assert.equal(await coachHealth('http://x', reply(200, { ready: false, missing: ['CHERT_API_KEY'] })), false);
  assert.equal(await coachHealth('http://x', async () => { throw new TypeError('Failed to fetch'); }), false);
});

test('startCall: a placed call returns its id; every failure becomes plain words, never a code', async () => {
  const ok = await startCall('http://x', reply(201, { callId: 'c1', message: 'Calling your iPhone now. Pick up on FaceTime.' }));
  assert.deepEqual(ok, { ok: true, callId: 'c1', message: 'Calling your iPhone now. Pick up on FaceTime.' });
  const busy = await startCall('http://x', reply(409, { message: 'The line is busy. Try again in a few minutes.' }));
  assert.deepEqual(busy, { ok: false, message: 'The line is busy. Try again in a few minutes.' });
  const down = await startCall('http://x', async () => { throw new TypeError('Failed to fetch'); });
  assert.deepEqual(down, { ok: false, message: UNAVAILABLE });
  assert.doesNotMatch(UNAVAILABLE, /error|\d{3}|failed/i);
});

test('startCall posts to /api/call-me and asks for video', async () => {
  let seen;
  await startCall('http://coach.test', async (url, opts) => { seen = { url, ...opts }; return new Response('{}', { status: 500 }); });
  assert.equal(seen.url, 'http://coach.test/api/call-me');
  assert.equal(seen.method, 'POST');
  assert.deepEqual(JSON.parse(seen.body), { video: true });
});

test('watchCall reports each change until the call ends, and survives a dropped request', async () => {
  const steps = [
    { state: 'waiting', message: 'Calling your iPhone now. Pick up on FaceTime.' },
    'drop',
    { state: 'ready', message: 'Your coach is on the line.' },
    { state: 'terminal', message: 'Call ended. Nice work today.' },
  ];
  let i = 0;
  const fetchImpl = async () => { const s = steps[i++]; if (s === 'drop') throw new TypeError('Failed to fetch'); return new Response(JSON.stringify(s), { status: 200 }); };
  const heard = [];
  const end = await watchCall('http://x', 'c1', (u) => heard.push(u.state), { fetchImpl, sleep: async () => {} });
  assert.deepEqual(heard, ['waiting', 'ready', 'terminal']);
  assert.equal(end.state, 'terminal');
});

test('watchCall stops when the call is unknown, and gives up after maxMs', async () => {
  const gone = await watchCall('http://x', 'c1', () => {}, { fetchImpl: reply(404, { message: 'No such call.' }), sleep: async () => {} });
  assert.equal(gone.message, 'No such call.');
  const never = await watchCall('http://x', 'c1', () => {}, { fetchImpl: reply(200, { state: 'waiting', message: 'Ringing' }), sleep: async () => {}, maxMs: 0 });
  assert.equal(never, null);
});
