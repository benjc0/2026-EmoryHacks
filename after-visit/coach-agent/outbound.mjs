// Pure helpers for "Call my iPhone": no network, no LiveKit, so the tests can run them.
//
// Flow (see call-server.mjs): make a LiveKit room, send the coach agent into it, mint a token for Chert's
// bridge, ask Chert to FaceTime the patient, then watch the call. When Chert's Mac reports bridge_ready,
// write {"chert_bridge_ready":true} into the room metadata: greet.mjs greets on exactly that signal.

export const CHERT_API_BASE = 'https://app.trychert.com';
export const DEFAULT_ORIGINS = 'http://localhost:8000,http://127.0.0.1:8000,https://mending.fit,https://www.mending.fit';

/** The Access-Control-Allow-Origin value for a request from `origin`: that origin if it's allowed, else the first allowed one. */
export function corsOrigin(allowed, origin) {
  return allowed.includes(origin) ? origin : (allowed[0] ?? 'http://localhost:8000');
}
const TERMINAL = ['ended', 'failed', 'rejected'];
const E164 = /^\+[1-9]\d{7,14}$/;
const filled = (value) => typeof value === 'string' && value.trim() !== '' && !/YOUR_/.test(value);

/** Read the call server's settings from the environment. Returns { config } or { missing: [names] }. */
export function readConfig(env = process.env) {
  const names = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'AGENT_NAME',
    'CHERT_API_KEY', 'CHERT_PROJECT_ID', 'CHERT_LINE_ID', 'COACH_PATIENT_PHONE'];
  const missing = names.filter((name) => !filled(env[name]));
  if (filled(env.COACH_PATIENT_PHONE) && !E164.test(env.COACH_PATIENT_PHONE.trim())) missing.push('COACH_PATIENT_PHONE (use +1 and digits only)');
  if (missing.length) return { missing };
  return {
    config: {
      livekitUrl: env.LIVEKIT_URL.trim(),
      livekitHost: httpUrl(env.LIVEKIT_URL.trim()),
      livekitKey: env.LIVEKIT_API_KEY.trim(),
      livekitSecret: env.LIVEKIT_API_SECRET.trim(),
      agentName: env.AGENT_NAME.trim(),
      chertBase: (filled(env.CHERT_API_BASE) ? env.CHERT_API_BASE.trim() : CHERT_API_BASE).replace(/\/+$/, ''),
      chertKey: env.CHERT_API_KEY.trim(),
      projectId: env.CHERT_PROJECT_ID.trim(),
      lineId: env.CHERT_LINE_ID.trim(),
      phone: env.COACH_PATIENT_PHONE.trim(),
      port: Number(env.CALL_SERVER_PORT) || 8787,
      // Pages allowed to ask this service for a call (comma-separated in CALL_SERVER_ORIGIN).
      allowOrigins: (filled(env.CALL_SERVER_ORIGIN) ? env.CALL_SERVER_ORIGIN : DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean),
    },
  };
}

/** LiveKit's server API wants https:// where the agent connects with wss://. */
export function httpUrl(url) {
  return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

/** The body of Chert's POST /api/v1/calls for an outbound call into our own room. */
export function buildCallRequest({ lineId, phone, livekitUrl, bridgeToken, agentIdentity, video }) {
  return {
    direction: 'outbound',
    mode: 'customer_managed',
    line_id: lineId,
    destination: phone,
    destination_type: 'phone',
    media: { audio: true, video: Boolean(video) },
    livekit_url: livekitUrl,
    participant_token: bridgeToken,
    remote_participant_identity: agentIdentity,
  };
}

/**
 * Where a Chert call record stands, the same rule chert dev uses:
 * 'terminal' once ended/failed/rejected, 'ready' once active with the worker's bridge_ready event, else 'waiting'.
 */
export function callState(record) {
  if (!record || typeof record.status !== 'string') return 'waiting';
  if (TERMINAL.includes(record.status)) return 'terminal';
  const events = Array.isArray(record.facetime_call_events) ? record.facetime_call_events : [];
  const ready = events.some((e) => e && e.event_type === 'bridge_ready' && e.source === 'worker');
  return record.status === 'active' && ready ? 'ready' : 'waiting';
}

/** What the room metadata says at bridge_ready, so greet.mjs speaks within Chert's 10 seconds. */
export function bridgeReadyMetadata(callId, at = new Date()) {
  return JSON.stringify({ chert_call: callId, chert_bridge_ready: true, at: at.toISOString() });
}

/** The coach agent in a room's participant list: LiveKit marks agents with kind 4 (AGENT). */
export function findAgent(participants) {
  return (participants || []).find((p) => p && (p.kind === 4 || p.kind === 'AGENT')) ?? null;
}

/** Plain-language status for the patient's screen. Never says "error" or a code. */
export function patientMessage(state, status) {
  if (state === 'ready') return 'Your coach is on the line.';
  if (state === 'terminal') return status === 'ended' ? 'Call ended. Nice work today.' : "The call didn't go through. Try again in a minute.";
  return 'Calling your iPhone now. Pick up on FaceTime.';
}
