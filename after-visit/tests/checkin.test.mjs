// The check-in briefing: what the agent gets, and what it must never get. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionLog } from '../js/sessionLog.js';
import { planExercises, DEMO_PLAN } from '../js/plan.js';
import { buildBrief, needsHuman, mockAgent, MAX_NOTE_CHARS, MAX_QUESTIONS } from '../js/checkin.js';

function record({ pain = 3, note = '', startedAt = '2026-11-14T15:00:00.000Z', badArm = false } = {}) {
  const log = new SessionLog({ plan: DEMO_PLAN, now: new Date(startedAt) });
  const [arm, squat] = planExercises();
  const a = log.beginExercise(arm);
  a.addFrame(0, { side: 'right', angle: 20, landmarks: Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 })) });
  a.addRep({ n: 1, quality: 'good', peakAngle: 142, issues: [], formFlags: [] });
  a.addRep({ n: 2, quality: badArm ? 'poor' : 'fair', peakAngle: 90, issues: ['Raise your arm a little higher'], formFlags: [] });
  a.end({ durationMs: 5000, side: 'right', summary: { bestPeakAngle: 142 } });
  const s = log.beginExercise(squat);
  s.end({ durationMs: 0, skipped: true, summary: null });
  log.setCheckIn({ pain, note });
  log.finish(new Date(new Date(startedAt).getTime() + 300000));
  return log.toRecord();
}

test('brief has the summary the agent needs, and nothing else from the record', () => {
  const rec = record({ pain: 4, note: '  Shoulder felt tight  ' });
  const brief = buildBrief(rec, { openQuestions: ['Is ice ok?'] });
  assert.equal(brief.lastSession.date, '2026-11-14');
  assert.equal(brief.lastSession.goodReps, 1);
  assert.equal(brief.lastSession.totalReps, 2);
  assert.deepEqual(brief.lastSession.skipped, ['Mini squat']);
  assert.equal(brief.pain, 4);
  assert.equal(brief.patientNote, 'Shoulder felt tight');
  assert.equal(brief.flagged[0].issue, 'Raise your arm a little higher');
  assert.deepEqual(brief.openQuestions, ['Is ice ok?']);
  // never sent: video, landmarks, frames, angles per frame
  const json = JSON.stringify(brief);
  assert.ok(!json.includes('"lm"'));
  assert.ok(!json.includes('frames'));
  assert.ok(!json.includes('video'));
});

test('rules forbid form judgement and plan changes, and always offer a human', () => {
  const brief = buildBrief(record());
  assert.equal(brief.rules.mayJudgeForm, false);
  assert.equal(brief.rules.mayChangePlan, false);
  assert.equal(brief.rules.mustOfferHuman, true);
});

test('long notes and too many questions are trimmed', () => {
  const brief = buildBrief(record({ note: 'x'.repeat(500) }), {
    openQuestions: Array.from({ length: 12 }, (_, i) => `Question ${i}`),
  });
  assert.ok(brief.patientNote.length <= MAX_NOTE_CHARS);
  assert.ok(brief.patientNote.endsWith('…'));
  assert.equal(brief.openQuestions.length, MAX_QUESTIONS);
});

test('a missing note or pain score is null, not an error', () => {
  const log = new SessionLog({ plan: DEMO_PLAN });
  log.finish(new Date('2026-11-14T15:05:00Z'));
  const brief = buildBrief(log.toRecord());
  assert.equal(brief.pain, null);
  assert.equal(brief.patientNote, null);
  assert.equal(needsHuman(brief), false);
});

test('high pain or a poor rep means the therapist should see it first', () => {
  assert.equal(needsHuman(buildBrief(record({ pain: 7 }))), true);
  assert.equal(needsHuman(buildBrief(record({ pain: 6 }))), false);
  assert.equal(needsHuman(buildBrief(record({ pain: 2, badArm: true }))), true);
});

test('progress against the previous session is included when there is one', () => {
  const now = record({ pain: 1 });
  const before = [record({ startedAt: '2026-11-10T15:00:00.000Z' })];
  const brief = buildBrief(now, { previous: before });
  assert.equal(brief.progress.length, 1);
  assert.equal(brief.progress[0].exercise, 'Side arm raise');
  assert.equal(brief.progress[0].change, 0);
  assert.equal(brief.progress[0].direction, 'more');
});

test('mock agent completes a call and returns a transcript with the new question', async () => {
  const agent = mockAgent();
  const brief = buildBrief(record());
  const { callId, status } = await agent.startCall(brief, { at: new Date('2026-11-15T18:00:00Z') });
  assert.equal(status, 'completed');
  const t = await agent.transcriptOf(callId);
  assert.ok(t.lines.length >= 3);
  assert.deepEqual(t.newQuestions, ['My knee clicks when I go downstairs.']);
  await assert.rejects(() => agent.transcriptOf('nope'));
});
