// The FaceTime coach's guided session, end to end with the synthetic person.  Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachSession, intro, positionCue } from '../coach-agent/coach-session.mjs';
import { planExercises } from '../js/plan.js';
import { demoMotion, person } from './fakePerson.mjs';

const W = 1280, H = 720;

/** Play `ms` of motion into the coach at 10 fps (what the FaceTime coach uses), from time `from`. */
function play(coach, from, ms, motion = demoMotion) {
  for (let t = from; t <= from + ms; t += 100) coach.onPose({ landmarks: motion ? motion(t - from) : null, w: W, h: H, t });
  return from + ms;
}

function coachWithLines() {
  const lines = [];
  const coach = new CoachSession({ say: (s) => lines.push(s) });
  return { coach, lines };
}

test('starts with the first exercise, in plain words, with the target only in precise mode', () => {
  const { coach, lines } = coachWithLines();
  coach.start('Hi!');
  assert.equal(coach.phase, 'positioning');
  assert.match(lines[0], /^Hi! First: side arm raise\. Face the camera\./);
  assert.match(lines[0], /5 reps\. Aim for 140 degrees\./);
  const [, squat] = planExercises();
  assert.doesNotMatch(intro(squat, 1, 2), /degrees/);   // simple mode: no numbers
  assert.match(intro(squat, 1, 2), /^Last one: mini squat/);
});

test('waits until the patient is in view, coaches them into the picture, then starts counting', () => {
  const { coach, lines } = coachWithLines();
  coach.start();
  let t = play(coach, 0, 13000, null);                  // nobody in view for 13 s
  assert.equal(coach.phase, 'positioning');
  assert.ok(lines.some((l) => /I can't see you yet\. Prop the phone up/.test(l)), lines.join(' | '));
  play(coach, t + 100, 2000);                           // in view, at rest
  assert.equal(coach.phase, 'recording');
  assert.ok(lines.some((l) => l.startsWith('I can see you. Go ahead: 5 reps')));
});

test('speaks every rep like session.html, then moves to the next exercise, then asks about pain', () => {
  const { coach, lines } = coachWithLines();
  coach.start();
  let t = play(coach, 0, 2000);                         // get into view (positioning -> recording)
  t = play(coach, t + 100, 30000);                      // 5 s per rep: 5 reps in 25 s
  const repLines = lines.filter((l) => /^\d\. /.test(l));
  assert.ok(repLines.some((l) => /Good rep\./.test(l)), lines.join(' | '));
  assert.ok(repLines.some((l) => /Raise your arm a little higher\./.test(l)), lines.join(' | '));
  assert.ok(lines.some((l) => /One to go!/.test(l)));
  const handoff = lines.find((l) => /Side arm raise done\./.test(l));
  assert.match(handoff, /\d of 5 good reps\..*Last one: mini squat/);
  assert.equal(coach.idx, 1);

  t = play(coach, t + 100, 2000);                       // squat: into view
  play(coach, t + 100, 30000);
  assert.equal(coach.phase, 'pain');
  assert.match(lines.at(-1), /Mini squat done\..*That's all your exercises\..*scale of 0 to 10/);

  const record = coach.recordPain(3);
  assert.equal(coach.phase, 'done');
  assert.equal(record.checkIn.pain, 3);
  assert.equal(record.exercises.length, 2);
  assert.equal(record.totals.reps, 10);
  assert.match(lines.at(-1), /saved today's session for Dr\. Lee\. Nice work today!/);
});

test('high pain gets a rest message and is flagged for the therapist', () => {
  const { coach, lines } = coachWithLines();
  coach.start();
  coach.skip(); coach.skip();
  assert.equal(coach.phase, 'pain');
  const record = coach.recordPain(7, 'shoulder ached');
  assert.match(lines.at(-1), /Please rest now, and let your therapist know about the pain/);
  assert.ok(record.attention.some((a) => a.kind === 'pain' && /Pain 7/.test(a.text)), JSON.stringify(record.attention));
});

test('skip moves on in plain words, and status describes where the patient is', () => {
  const { coach, lines } = coachWithLines();
  coach.start();
  assert.match(coach.status(), /^Exercise 1 of 2: Side arm raise \(waiting to see the patient/);
  assert.equal(coach.skip(), true);
  assert.match(lines.at(-1), /^Okay, we'll skip the side arm raise\. Last one: mini squat/);
  assert.match(coach.status(), /^Exercise 2 of 2: Mini squat/);
});

test('a session ended early (hang-up) still produces a record', () => {
  const { coach } = coachWithLines();
  coach.start();
  play(coach, 0, 9000);
  const record = coach.record();
  assert.ok(record.endedAt);
  assert.equal(record.exercises.length, 1);
  assert.equal(record.checkIn.pain, null);
});

test('position cues name the right body parts', () => {
  const [arm, squat] = planExercises();
  assert.match(positionCue(arm, false), /step back about 6 feet.*head to feet/);
  assert.match(positionCue(squat, true), /Step back a little, to about 6 feet/);
  assert.match(intro(arm, 0, 2), /stand about 6 feet, or 3 big steps, back from the phone/);
  assert.doesNotMatch(intro(squat, 1, 2), /6 feet/);   // said once, on the first exercise
});

test('rushed reps are not counted, the coach says why, and they cannot finish the exercise', () => {
  const { coach, lines } = coachWithLines();
  coach.start();
  let t = play(coach, 0, 2000);                                   // into view, recording starts
  // a full arm raise and back in about a second, with a short rest: far too fast (a real rep takes 1.5 s or more)
  const flick = (ms) => { const u = (ms % 1600) / 1600, s = u < 0.2 ? 0 : u < 0.45 ? (u - 0.2) / 0.25 : u < 0.7 ? 1 - (u - 0.45) / 0.25 : 0; return person({ armDeg: 15 + 135 * s }); };
  t = play(coach, t + 100, 12000, flick);
  assert.equal(coach.phase, 'recording', 'twelve seconds of flicking must not finish the exercise');
  assert.equal(coach.tracker.counted, 0);
  assert.ok(lines.some((l) => /too fast to count/.test(l)), lines.join(' | '));
  assert.match(coach.status(), /0 of 5 reps done/);
});
