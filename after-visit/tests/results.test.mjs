import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionResults, minutesText } from '../js/results.js';

const rep = (quality, issues = [], counted = true) => ({ quality, issues, counted });
const record = {
  durationMs: 190000,
  totals: { reps: 5, good: 4, qualityPct: 80 },
  checkIn: { pain: 3 },
  exercises: [
    { name: 'Side arm raise', repsTarget: 5, skipped: false, reps: [rep('good'), rep('good'), rep('fair', ['Raise your arm a little higher']), rep('good'), rep('good'), rep('poor', ['Slow down'], false)] },
    { name: 'Mini squat', repsTarget: 5, skipped: true, reps: [] },
  ],
};

test('results are short, plain and only count reps that counted', () => {
  const r = sessionResults(record);
  assert.equal(r.headline, 'Great work today!');
  assert.deepEqual(r.stats.map((s) => s.value), ['5', '80%', '3 min']);
  assert.equal(r.exercises[0].line, '5 of 5 reps, 4 good');
  assert.equal(r.exercises[0].status, 'fair');
  assert.equal(r.exercises[1].line, 'Skipped');
  assert.equal(r.tip, 'Raise your arm a little higher', 'the uncounted "Slow down" rep is ignored');
  assert.equal(r.pain, 'You told us your pain was 3 out of 10.');
  assert.equal(r.exercisesDone, 1);
});

test('no reps, and a rough session, are both kind and never blank', () => {
  assert.equal(sessionResults({ exercises: [], totals: { reps: 0, good: 0, qualityPct: 0 } }).headline, 'No reps were counted this time.');
  assert.match(sessionResults({ exercises: [], totals: { reps: 4, good: 1, qualityPct: 25 } }).headline, /showed up/);
  assert.equal(sessionResults({}).stats[1].value, '–');
  assert.equal(minutesText(20000), 'under a minute');
});
