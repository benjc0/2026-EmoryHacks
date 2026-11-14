import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeReadyMetadata, buildCallRequest, callState, findAgent, httpUrl, patientMessage, readConfig } from '../coach-agent/outbound.mjs';

const env = {
  LIVEKIT_URL: 'wss://demo.livekit.cloud', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's', AGENT_NAME: 'emory-pt-coach',
  CHERT_API_KEY: 'ftk_test', CHERT_PROJECT_ID: 'p', CHERT_LINE_ID: 'l', COACH_PATIENT_PHONE: '+15555550100',
};

test('readConfig lists what is missing, and treats YOUR_ placeholders as missing', () => {
  const { missing } = readConfig({ ...env, LIVEKIT_API_KEY: 'YOUR_LIVEKIT_API_KEY', CHERT_LINE_ID: '' });
  assert.deepEqual(missing, ['LIVEKIT_API_KEY', 'CHERT_LINE_ID']);
});

test('readConfig rejects a phone number that is not +country digits', () => {
  const { missing } = readConfig({ ...env, COACH_PATIENT_PHONE: '(555) 555-0100' });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /COACH_PATIENT_PHONE/);
});

test('readConfig fills defaults: Chert host, port, page origin', () => {
  const { config } = readConfig(env);
  assert.equal(config.chertBase, 'https://app.trychert.com');
  assert.equal(config.livekitHost, 'https://demo.livekit.cloud');
  assert.equal(config.port, 8787);
  assert.equal(config.allowOrigin, 'http://localhost:8000');
});

test('httpUrl turns the agent URL into the server API URL', () => {
  assert.equal(httpUrl('wss://x.livekit.cloud'), 'https://x.livekit.cloud');
  assert.equal(httpUrl('ws://localhost:7880'), 'http://localhost:7880');
});

test('buildCallRequest matches Chert outbound contract', () => {
  const body = buildCallRequest({ lineId: 'l', phone: '+15555550100', livekitUrl: 'wss://x', bridgeToken: 't', agentIdentity: 'agent-1', video: true });
  assert.deepEqual(body, {
    direction: 'outbound', mode: 'customer_managed', line_id: 'l', destination: '+15555550100', destination_type: 'phone',
    media: { audio: true, video: true }, livekit_url: 'wss://x', participant_token: 't', remote_participant_identity: 'agent-1',
  });
  assert.equal(buildCallRequest({ video: false }).media.video, false);
});

test('callState: ready only when active with the worker bridge_ready event', () => {
  const ev = (event_type, source = 'worker') => ({ event_type, source });
  assert.equal(callState({ status: 'active', facetime_call_events: [ev('bridge_ready')] }), 'ready');
  assert.equal(callState({ status: 'active', facetime_call_events: [ev('bridge_ready', 'api')] }), 'waiting');
  assert.equal(callState({ status: 'ringing', facetime_call_events: [ev('bridge_ready')] }), 'waiting');
  assert.equal(callState({ status: 'active', facetime_call_events: [] }), 'waiting');
  for (const status of ['ended', 'failed', 'rejected']) assert.equal(callState({ status }), 'terminal');
  assert.equal(callState(undefined), 'waiting');
});

test('bridgeReadyMetadata is the signal greet.mjs listens for', () => {
  const meta = JSON.parse(bridgeReadyMetadata('c1', new Date('2026-11-14T00:00:00Z')));
  assert.deepEqual(meta, { chert_call: 'c1', chert_bridge_ready: true, at: '2026-11-14T00:00:00.000Z' });
});

test('findAgent picks the agent participant, not the bridge', () => {
  assert.equal(findAgent([{ identity: 'chert-bridge-out-1', kind: 0 }, { identity: 'agent-AJ_1', kind: 4 }]).identity, 'agent-AJ_1');
  assert.equal(findAgent([{ identity: 'someone', kind: 0 }]), null);
  assert.equal(findAgent(undefined), null);
});

test('patientMessage stays plain and never shows a code', () => {
  for (const [state, status] of [['waiting'], ['ready'], ['terminal', 'ended'], ['terminal', 'failed']]) {
    const text = patientMessage(state, status);
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /error|_|\d{3}/i);
  }
});
