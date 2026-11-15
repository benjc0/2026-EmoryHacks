import test from 'node:test';
import assert from 'node:assert/strict';
import { visitConnection } from '../js/visitConnection.js';
import { planExercise } from '../js/plan.js';
import { readData, recordCompletion, completedIds, localDate } from '../js/dashboardData.js';

test('standalone dashboard uses a separate backend for visits and patient data', () => {
  const c = visitConnection('http://localhost:8000/index.html?patient_id=kim-001');
  assert.equal(c.visitUrl, 'http://localhost:8001/');
  assert.equal(c.api, 'http://localhost:8001/api/patients/kim-001');
});
test('dashboard served by the visit backend keeps same-origin API and visit navigation', () => {
  const c = visitConnection('https://mend.example/pt/index.html');
  assert.equal(c.visitUrl, '/');
  assert.equal(c.api, '/api/patients/demo-patient');
});
test('explicit backend survives the handoff into training', () => {
  const values = new Map();
  const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  visitConnection('http://localhost:8000/?server=http://localhost:9000&patient_id=kim', storage);
  const c = visitConnection('http://localhost:8000/session.html', storage);
  assert.equal(c.api, 'http://localhost:9000/api/patients/kim');
  assert.equal(c.visitUrl, 'http://localhost:9000/');
});
test('custom visit URL also supplies the patient API origin', () => {
  const c = visitConnection('https://dashboard.example/?visit_url=https%3A%2F%2Fvisit.example%2F');
  assert.equal(c.api, 'https://visit.example/api/patients/demo-patient');
});
test('unavailable browser storage does not prevent connection setup', () => {
  const c = visitConnection('http://localhost:8000/?patient_id=test', { getItem() { throw Error(); }, setItem() { throw Error(); } });
  assert.equal(c.patientId, 'test');
});
test('prescribed hold and form limits survive conversion to a tracked exercise', () => {
  const check = { id: 'therapist-limit', label: 'Stay within your prescribed range', max: 100 };
  const ex = planExercise({ id: 'shoulder-abduction', reps: 8, target: 95, holdMs: 2000, checks: [check], note: 'Rest between sets' });
  assert.equal(ex.holdMs, 2000);
  assert.equal(ex.target, 95);
  assert.equal(ex.reps, 8);
  assert.equal(ex.checks.filter(c => c.id === check.id).length, 1);
  assert.equal(ex.note, 'Rest between sets');
});
test('session log exercise totals update dashboard completion without counting partial exercises', () => {
  const recorded_at = new Date().toISOString();
  let data = readData({ getItem: () => null });
  data = recordCompletion(data, { exercise_id: 'mini-squat', recorded_at, reps_target: 5, summary: { totalReps: 4 } });
  assert.equal(completedIds(data, localDate()).size, 0);
  data = recordCompletion(data, { exercise_id: 'mini-squat', recorded_at, reps_target: 5, summary: { totalReps: 5 } });
  assert.ok(completedIds(data, localDate()).has('mini-squat'));
});

test('the public site sends the visit button to the Visit Copilot on this computer', () => {
  const c = visitConnection('https://mending.fit/');
  assert.equal(c.visitUrl, 'http://localhost:8000/');
});
