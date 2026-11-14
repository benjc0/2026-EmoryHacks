// The exercise tracker end to end, with a synthetic person.  Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { ExerciseTracker } from '../js/exerciseTracker.js';
import { SessionLog } from '../js/sessionLog.js';
import { planExercises, DEMO_PLAN } from '../js/plan.js';
import { analyzeFrame } from '../js/analysis.js';
import { person, demoMotion } from './fakePerson.mjs';

const W = 1280, H = 720;

// Play `ms` of demoMotion through a tracker at 30 fps. Recording starts at `recAt`.
function play(tracker, ms, { recAt = 0, motion = demoMotion } = {}) {
  const events = [];
  for (let t = 0; t <= ms; t += 33) {
    if (t >= recAt && !tracker.recording) tracker.startRecording(t);
    const r = tracker.update(motion(t), W, H, t);
    events.push(...r.events);
  }
  return events;
}

test('fake person has the angles we asked for', () => {
  const [arm, squat] = planExercises();
  for (const deg of [15, 90, 150]) {
    const f = analyzeFrame(arm, 'right', person({ armDeg: deg }), W, H);
    assert.ok(Math.abs(f.angle - deg) < 1.5, `arm ${f.angle} vs ${deg}`);
    assert.equal(f.checks['elbow-straight'].violated, false);
  }
  for (const deg of [175, 140, 100]) {
    const f = analyzeFrame(squat, 'left', person({ kneeDeg: deg }), W, H);
    assert.ok(Math.abs(f.angle - deg) < 1.5, `knee ${f.angle} vs ${deg}`);
  }
  assert.equal(analyzeFrame(arm, 'right', person({ armDeg: 90, elbowBend: 60 }), W, H).checks['elbow-straight'].violated, true);
});

test('arm raise: locks onto the moving arm, catches the short rep, logs everything', () => {
  const log = new SessionLog({ plan: DEMO_PLAN });
  const [arm] = planExercises();
  const tr = new ExerciseTracker(arm, log.beginExercise(arm));
  const ev = play(tr, 20500).filter((e) => e.type === 'rep').map((e) => e.rep);
  assert.equal(tr.side, 'right');
  assert.equal(tr.locked, true);
  assert.deepEqual(ev.map((r) => r.quality), ['good', 'fair', 'good', 'fair']);
  assert.ok(Math.abs(ev[0].peakAngle - 150) <= 3, `peak ${ev[0].peakAngle}`);
  assert.equal(ev[1].issues[0], 'Raise your arm a little higher');

  tr.finish(20500, { video: { mime: 'video/webm', bytes: 10 } });
  const rec = log.toRecord().exercises[0];
  assert.equal(rec.reps.length, 4);
  assert.equal(rec.side, 'right');
  assert.equal(rec.durationMs, 20500);
  assert.ok(rec.frameCount > 290 && rec.frameCount < 320, `frames ${rec.frameCount}`);
  assert.equal(rec.summary.goodReps, 2);
});

test('mini squat (angle goes down): good and poor reps', () => {
  const log = new SessionLog();
  const [, squat] = planExercises();
  const tr = new ExerciseTracker(squat, log.beginExercise(squat));
  const reps = play(tr, 10500).filter((e) => e.type === 'rep').map((e) => e.rep);
  assert.deepEqual(reps.map((r) => r.quality), ['good', 'poor']);
  assert.equal(reps[1].issues[0], 'Bend your knees a little more');
  assert.equal(tr.done, false);
});

test('nothing counts or logs before recording starts', () => {
  const log = new SessionLog();
  const [arm] = planExercises();
  const tr = new ExerciseTracker(arm, log.beginExercise(arm));
  const ev = play(tr, 5000, { recAt: 1e9 });
  assert.equal(ev.length, 0);
  assert.equal(log.current.frames.length, 0);
  let r;
  for (let t = 5100; t < 6000; t += 33) r = tr.update(person({ armDeg: 150 }), W, H, t);
  assert.equal(r.visible, true);
  assert.equal(r.atTarget, true);
  assert.equal(tr.update(null, W, H, 6100).seen, false);
});

test('bent elbow mid-rep is reported live and flagged on the rep', () => {
  const log = new SessionLog();
  const [arm] = planExercises();
  const tr = new ExerciseTracker({ ...arm, side: 'right' }, log.beginExercise(arm));
  let sawBroken = false;
  const ev = play(tr, 5000, { motion: (t) => demoMotion(t, { elbowBend: 60 }) });
  for (let t = 5000; t < 5100; t += 33) { if (tr.update(demoMotion(t, { elbowBend: 60 }), W, H, t).broken) sawBroken = true; }
  const rep = ev.find((e) => e.type === 'rep').rep;
  assert.equal(rep.quality, 'fair');
  assert.ok(rep.formFlags.includes('elbow-straight'));
  assert.ok(log.current.frames.some((f) => f.c?.includes('elbow-straight')));
  // live "broken" only fires during a rep; check one directly mid-rep
  const tr2 = new ExerciseTracker({ ...arm, side: 'right' }, new SessionLog().beginExercise(arm));
  for (let t = 0; t <= 2500; t += 33) { if (t === 0) tr2.startRecording(0); if (tr2.update(demoMotion(t, { elbowBend: 60 }), W, H, t).broken) sawBroken = true; }
  assert.ok(sawBroken);
});

test('progress bar maps rest -> target', () => {
  const [arm, squat] = planExercises();
  const a = new ExerciseTracker(arm, new SessionLog().beginExercise(arm));
  assert.ok(a.progress(arm.rest) < a.progress(arm.target));
  assert.equal(a.progress(500), 100);
  const s = new ExerciseTracker(squat, new SessionLog().beginExercise(squat));
  assert.ok(s.progress(170) < s.progress(110));
});
