// Session logging + on-device storage.  Run from the after-visit folder:  npm install && npm test
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PLAN, planExercises, planExercise } from '../js/plan.js';
import { SessionLog, FRAME_INTERVAL_MS, flaggedReps, needsAttention, progressVsPrevious } from '../js/sessionLog.js';
import { createStore } from '../js/store.js';
import { RepCounter } from '../js/repCounter.js';

const lms = () => Array.from({ length: 33 }, (_, i) => ({ x: i / 33, y: 0.5, z: 0, visibility: 0.9 }));

// Feed a counter [ms, angle] keyframes at 30 fps; return the reps it scored.
function feed(counter, keyframes, checks = {}) {
  const out = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const [t0, a0] = keyframes[i], [t1, a1] = keyframes[i + 1];
    for (let t = t0; t < t1; t += 33) {
      const ev = counter.update({ t, angle: a0 + (a1 - a0) * (t - t0) / (t1 - t0), visible: true, checks });
      if (ev?.type === 'rep') out.push(ev.rep);
    }
  }
  const ev = counter.update({ t: keyframes.at(-1)[0], angle: keyframes.at(-1)[1], visible: true, checks });
  if (ev?.type === 'rep') out.push(ev.rep);
  return out;
}

// A realistic session: arm raise with 1 good + 1 short rep, squat with 1 good rep, pain 6.
function demoSession() {
  const [arm, squat] = planExercises();
  const log = new SessionLog({ plan: DEMO_PLAN, now: new Date('2026-11-14T15:00:00Z') });

  const a = log.beginExercise(arm);
  const ca = new RepCounter(arm, { targetAngle: arm.target });
  for (let t = 0; t < 2000; t += 33) a.addFrame(t, { side: 'right', angle: 30, landmarks: lms(), checks: { 'elbow-straight': { violated: t > 1000 } } });
  for (const r of feed(ca, [[0, 20], [500, 20], [2500, 150], [4500, 20], [5000, 20], [7000, 95], [9000, 20], [9500, 20]])) a.addRep(r);
  a.end({ durationMs: 9500, side: 'right', summary: ca.summary(), video: { mime: 'video/webm', width: 640, height: 480, bytes: 3 } });

  const s = log.beginExercise(squat);
  const cs = new RepCounter(squat, { targetAngle: squat.target });
  for (const r of feed(cs, [[0, 170], [500, 170], [2500, 100], [4500, 170], [5000, 170]])) s.addRep(r);
  s.end({ durationMs: 5000, side: 'left', summary: cs.summary() });

  log.setCheckIn({ pain: 6, note: '  Shoulder felt tight on the last one ' });
  log.finish(new Date('2026-11-14T15:05:00Z'));
  return log;
}

test('plan values override the exercise library', () => {
  const ex = planExercise({ id: 'shoulder-abduction', target: 120, reps: 3, mode: 'simple' });
  assert.equal(ex.target, 120);
  assert.equal(ex.reps, 3);
  assert.equal(ex.mode, 'simple');
  assert.equal(ex.joint.join(), 'hip,shoulder,elbow');
  assert.throws(() => planExercise({ id: 'nope' }));
  const [arm, squat] = planExercises();
  assert.equal(arm.mode, 'precise');
  assert.equal(squat.mode, 'simple');
});

test('frames are throttled to ~15 fps and keep broken form rules', () => {
  const log = demoSession();
  const frames = log.exercises[0].frames;
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].t - frames[i - 1].t >= FRAME_INTERVAL_MS);
  assert.ok(frames.length >= 25 && frames.length <= 31, `got ${frames.length}`);
  assert.equal(frames[0].lm.length, 33);
  assert.equal(frames[0].lm[0].length, 4);
  assert.equal(frames[0].c, undefined);
  assert.deepEqual(frames.at(-1).c, ['elbow-straight']);
});

test('the session record has totals, flagged reps and attention items', () => {
  const rec = demoSession().toRecord();
  assert.equal(rec.schema, 2);
  assert.equal(rec.exercises.length, 2);
  assert.equal(rec.exercises[0].side, 'right');
  assert.equal(rec.exercises[0].frames, undefined, 'frames are stored separately');
  assert.equal(rec.durationMs, 14500);
  assert.deepEqual(
    { reps: rec.totals.reps, good: rec.totals.good, done: rec.totals.exercisesDone },
    { reps: 3, good: 2, done: 2 },
  );
  assert.equal(rec.checkIn.pain, 6);
  assert.equal(rec.checkIn.note, 'Shoulder felt tight on the last one');

  assert.equal(rec.flagged.length, 1);
  assert.equal(rec.flagged[0].exercise, 0);
  assert.equal(rec.flagged[0].rep, 2);
  assert.equal(rec.flagged[0].issues[0], 'Raise your arm a little higher');

  const kinds = rec.attention.map((x) => x.kind);
  assert.ok(kinds.includes('pain'));
  assert.ok(kinds.includes('short'));    // 2 of 5 arm reps
});

test('poor reps sort before fair ones', () => {
  const ex = [{ idx: 0, name: 'A', target: 140, reps: [
    { n: 1, quality: 'fair', issues: [] }, { n: 2, quality: 'poor', issues: [] }, { n: 3, quality: 'good', issues: [] },
  ] }];
  assert.deepEqual(flaggedReps(ex).map((f) => f.rep), [2, 1]);
});

test('repeated form problems are called out', () => {
  const att = needsAttention({
    checkIn: { pain: 2 },
    exercises: [{ idx: 0, name: 'Side arm raise', repsTarget: 2, checks: [{ id: 'trunk-lean', label: "Don't lean your body" }],
      reps: [{ quality: 'fair', formFlags: ['trunk-lean'] }, { quality: 'fair', formFlags: ['trunk-lean'] }] }],
  });
  assert.equal(att.length, 1);
  assert.match(att[0].text, /lean your body.*2 reps/);
});

test('progress compares best angle with the last session (squat: lower is better)', () => {
  const now = { exercises: [
    { idx: 0, id: 'shoulder-abduction', name: 'Arm', direction: 'increase', summary: { bestPeakAngle: 132 } },
    { idx: 1, id: 'mini-squat', name: 'Squat', direction: 'decrease', summary: { bestPeakAngle: 105 } },
  ] };
  const before = [{ exercises: [
    { id: 'shoulder-abduction', summary: { bestPeakAngle: 120 } },
    { id: 'mini-squat', summary: { bestPeakAngle: 115 } },
  ] }];
  const p = progressVsPrevious(now, before);
  assert.equal(p[0].change, 12);
  assert.equal(p[1].change, 10);
  assert.equal(progressVsPrevious(now, [])[0].change, null);
});

for (const memory of [false, true]) {
  test(`store round trip (${memory ? 'memory fallback' : 'IndexedDB'})`, async () => {
    const st = createStore({ memory });
    await st.clearAll();
    assert.equal(st.persistent, !memory);

    const log = demoSession();
    const video = new Blob(['abc'], { type: 'video/webm' });
    const rec = await st.saveSession(log, { videos: { 0: video }, noteAudio: new Blob(['n'], { type: 'audio/webm' }) });

    const list = await st.listSessions();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, rec.id);
    assert.equal((await st.getFrames(rec.id, 0)).length, log.exercises[0].frames.length);
    assert.deepEqual(await st.getFrames(rec.id, 1), []);
    assert.equal((await st.getVideo(rec.id, 0)).size, 3);
    assert.equal(await st.getVideo(rec.id, 1), undefined);
    assert.ok(await st.getNoteAudio(rec.id));

    await st.updateCheckIn(rec.id, { pain: 3 });
    const rv = await st.markReviewed(rec.id, { by: 'Dr. Lee', comment: ' Nice work ', now: new Date('2026-11-15T10:00:00Z') });
    assert.equal(rv.checkIn.pain, 3);
    assert.equal(rv.checkIn.note, 'Shoulder felt tight on the last one');
    assert.deepEqual(rv.review, { at: '2026-11-15T10:00:00.000Z', by: 'Dr. Lee', comment: 'Nice work' });

    const exp = await st.exportSession(rec.id);
    assert.equal(exp.frames[0].length, log.exercises[0].frames.length);
    assert.ok(JSON.stringify(exp).length > 1000);

    // newest first
    const later = demoSession();
    later.startedAt = '2026-11-15T15:00:00.000Z';
    await st.saveSession(later);
    assert.equal((await st.listSessions())[0].id, later.id);

    await st.deleteSession(rec.id);
    assert.equal(await st.getSession(rec.id), undefined);
    assert.equal(await st.getVideo(rec.id, 0), undefined);
    assert.deepEqual(await st.getFrames(rec.id, 0), []);
    assert.equal((await st.listSessions()).length, 1);
  });
}
