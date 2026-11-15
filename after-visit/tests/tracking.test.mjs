// Run from the after-visit folder:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { RepCounter } from '../js/repCounter.js';
import { EXERCISES } from '../js/exercises.js';
import { analyzeFrame, chooseSide } from '../js/analysis.js';
import { angleAt } from '../js/geometry.js';
import { frameAt } from '../js/review.js';

// Feed [ms, angle] keyframes (interpolated every 33 ms) into a counter; return its events.
function run(counter, keyframes, checks = {}) {
  const events = [];
  const push = (t, angle) => { const ev = counter.update({ t, angle, visible: true, checks }); if (ev) events.push(ev); };
  for (let i = 0; i < keyframes.length - 1; i++) {
    const [t0, a0] = keyframes[i], [t1, a1] = keyframes[i + 1];
    for (let t = t0; t < t1; t += 33) push(t, a0 + (a1 - a0) * (t - t0) / (t1 - t0));
  }
  push(...keyframes.at(-1));
  return events;
}
const reps = (ev) => ev.filter((e) => e.type === 'rep').map((e) => e.rep);
const arm = { ...EXERCISES['shoulder-abduction'], target: 140 };

test('angle math', () => {
  assert.equal(Math.round(angleAt({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 90);
  assert.equal(Math.round(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 180);
});

test('waits for the start position before counting', () => {
  const c = new RepCounter(arm, { targetAngle: 140 });
  assert.deepEqual(run(c, [[0, 120], [1000, 120], [2000, 20]]).map((e) => e.type), ['ready']);
});

test('slow full arm raise is good', () => {
  const r = reps(run(new RepCounter(arm, { targetAngle: 140 }), [[0, 20], [400, 20], [1600, 145], [2000, 145], [3200, 22]]));
  assert.equal(r.length, 1);
  assert.equal(r[0].quality, 'good');
});

test('short of the target is fair with a range cue', () => {
  const r = reps(run(new RepCounter(arm, { targetAngle: 140 }), [[0, 20], [400, 20], [1700, 115], [3000, 22]]))[0];
  assert.equal(r.quality, 'fair');
  assert.equal(r.issues[0], 'Raise your arm a little higher');
});

test('too fast is flagged', () => {
  const r = reps(run(new RepCounter(arm, { targetAngle: 140 }), [[0, 20], [100, 20], [400, 145], [700, 22]]))[0];
  assert.ok(r.issues.includes('Slow down'));
  assert.notEqual(r.quality, 'good');
});

test('jitter at the start line is not a rep', () => {
  assert.equal(reps(run(new RepCounter(arm, { targetAngle: 140 }), [[0, 25], [300, 42], [600, 30], [900, 44], [1200, 28]])).length, 0);
});

test('bent elbow for most of the rep is flagged', () => {
  const r = reps(run(new RepCounter(arm, { targetAngle: 140 }), [[0, 20], [400, 20], [1600, 145], [3000, 22]],
    { 'elbow-straight': { violated: true } }))[0];
  assert.deepEqual(r.formFlags, ['elbow-straight']);
  assert.ok(r.issues.includes('Keep your elbow straight'));
});

test('hold: reaching the target without holding is fair, holding is good', () => {
  const ex = EXERCISES['overhead-stretch'];   // target 160, hold 3 s
  const short = reps(run(new RepCounter(ex), [[0, 30], [400, 30], [1800, 165], [2600, 165], [4000, 30]]))[0];
  assert.equal(short.quality, 'fair');
  assert.equal(short.issues[0], 'Hold at the top for 3 seconds');
  const held = reps(run(new RepCounter(ex), [[0, 30], [400, 30], [1800, 165], [5200, 165], [6600, 30]]))[0];
  assert.equal(held.quality, 'good');
  assert.ok(held.heldMs >= 3000);
});

test('squat (angle decreases) and summary', () => {
  const ex = EXERCISES['mini-squat'];
  const kf = [[0, 172]]; let t = 400;
  for (let i = 0; i < 5; i++) { kf.push([t, 172], [t + 1000, i < 3 ? 105 : 125], [t + 2000, 170]); t += 2400; }
  const c = new RepCounter(ex);
  assert.equal(reps(run(c, kf)).length, 5);
  assert.equal(c.summary().goodReps, 3);
});

// Synthetic person facing the camera with the right arm raised to a known angle.
function person(armDeg) {
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const set = (i, x, y) => (lms[i] = { x, y, z: 0, visibility: 0.95 });
  set(11, 0.55, 0.35); set(12, 0.45, 0.35); set(23, 0.55, 0.65); set(24, 0.45, 0.65);   // shoulders, hips
  const r = armDeg * Math.PI / 180;                     // angle between "down the trunk" and the arm
  set(14, 0.45 - 0.15 * Math.sin(r), 0.35 + 0.15 * Math.cos(r));   // right elbow
  set(16, 0.45 - 0.30 * Math.sin(r), 0.35 + 0.30 * Math.cos(r));   // right wrist (straight arm)
  return lms;
}

test('analyzeFrame measures the shoulder angle and form', () => {
  for (const deg of [20, 90, 140]) {
    const f = analyzeFrame(arm, 'right', person(deg), 1, 1);
    assert.ok(Math.abs(f.angle - deg) < 1, `${f.angle} vs ${deg}`);
    assert.equal(f.checks['elbow-straight'].violated, false);
    assert.equal(f.checks['trunk-lean'].violated, false);
  }
  assert.ok(['left', 'right'].includes(chooseSide(arm, person(90))));
});

test('frameAt finds the frame for a video time', () => {
  const frames = [{ t: 0 }, { t: 66 }, { t: 133 }, { t: 2000 }];
  assert.equal(frameAt(frames, 100).t, 66);
  assert.equal(frameAt(frames, 1500), null);
});

test('rushed reps are logged but do not count, so five quick flicks cannot finish the set', () => {
  const c = new RepCounter(arm, { targetAngle: 140 });
  const quick = [[0, 20], [100, 20]];
  for (let k = 0; k < 5; k++) quick.push([200 + k * 800, 145], [600 + k * 800, 22]);   // a full rep every 0.8 s
  const rs = reps(run(c, quick));
  assert.ok(rs.length >= 4);
  assert.ok(rs.every((r) => r.counted === false && r.notCounted === 'too_fast'));
  assert.equal(c.counted, 0);
  assert.equal(c.summary().totalReps, 0);
  // a slow, controlled rep right after still counts
  const slow = reps(run(c, [[10000, 20], [10100, 20], [12000, 145], [14000, 22]]));
  assert.equal(slow.at(-1).counted, true);
  assert.equal(c.counted, 1);
});

test('a rep where you were mostly out of view does not count', () => {
  const c = new RepCounter(arm, { targetAngle: 140 });
  const events = [];
  const feed = (t, angle, visible) => { const ev = c.update({ t, angle, visible, checks: {} }); if (ev) events.push(ev); };
  feed(0, 20, true); feed(100, 20, true);
  for (let t = 200; t <= 2400; t += 100) feed(t, 20 + Math.min(125, (t - 200) / 8), t < 700);
  for (let t = 2500; t <= 4600; t += 100) feed(t, Math.max(22, 145 - (t - 2500) / 8), false);
  const rs = reps(events);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].notCounted, 'hidden');
  assert.equal(c.counted, 0);
});
