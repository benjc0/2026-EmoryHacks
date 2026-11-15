// The guided session for a FaceTime (or browser) call: the therapist's plan, one exercise at a time, with the
// same tracker, rep scoring and wording as session.html. It decides WHAT the coach says and when; agent.mjs
// turns each line into speech. No LiveKit, no model, no clock of its own, so it can be tested with the fake person.
//
// Flow per exercise:  intro ("First: side arm raise. Face the camera...")
//                  -> positioning (waits until the measured joint is in view for 1.5 s, coaching if not)
//                  -> recording (each rep scored and spoken: "2. Good rep." / "3. Raise your arm a little higher.")
//                  -> summary, then the next exercise.
// After the last one it asks the 0-10 pain question; the model records the answer with recordPain().
import { DEMO_PLAN, planExercises } from '../js/plan.js';
import { ExerciseTracker } from '../js/exerciseTracker.js';
import { SessionLog } from '../js/sessionLog.js';

const IN_VIEW_MS = 1500;      // in view this long before counting starts (session.html uses the same)
const CUE_EVERY_MS = 12000;   // don't repeat a "step back" cue more often than this
const LOST_MS = 6000;         // out of view this long while recording -> ask them to step back into view

export class CoachSession {
  /**
   * @param {{ plan?: object, say: (text: string) => void }} opts  say() is called with each line to speak
   */
  constructor({ plan = DEMO_PLAN, say }) {
    this.plan = plan;
    this.say = say;
    this.exercises = planExercises(plan);
    this.log = new SessionLog({ plan });
    this.idx = -1;
    this.phase = 'idle';      // idle | positioning | recording | pain | done
    this.tracker = null;
    this.t = 0;
  }

  get exercise() { return this.exercises[this.idx] ?? null; }

  /** Begin the first exercise. `lead` is said first (e.g. a hello). */
  start(lead = '') {
    if (this.phase !== 'idle') return;
    this.next(lead);
  }

  /** One pose result from the caller's video. t = ms (any steady clock). */
  onPose({ landmarks, w, h, t }) {
    this.t = t;
    if (this.phase !== 'positioning' && this.phase !== 'recording') return;
    const ex = this.exercise, tr = this.tracker;
    const r = tr.update(landmarks, w, h, t);

    if (this.phase === 'positioning') {
      if (r.visible) {
        this.seenSince ??= t;
        if (t - this.seenSince >= IN_VIEW_MS) {
          tr.startRecording(t);
          this.phase = 'recording';
          this.lostSince = null;
          this.say(`I can see you. Go ahead: ${ex.reps} reps, nice and slow.`);
        }
      } else {
        this.seenSince = null;
        if (t - this.lastCue >= CUE_EVERY_MS) { this.lastCue = t; this.say(positionCue(ex, !!landmarks)); }
      }
      return;
    }

    // recording
    if (!r.visible) {
      this.lostSince ??= t;
      if (t - this.lostSince >= LOST_MS && t - this.lastCue >= CUE_EVERY_MS) { this.lastCue = t; this.say(positionCue(ex, !!landmarks)); }
    } else this.lostSince = null;

    for (const ev of r.events) {
      if (ev.type !== 'rep') continue;
      if (!ev.rep.counted) {   // rushed or out of view: it doesn't count, so say why
        this.say(ev.rep.notCounted === 'hidden' ? 'Stay in the picture so I can count that one.' : 'That was too fast to count. Slow down.');
        continue;
      }
      const n = tr.counted, left = ex.reps - n;
      let line = ev.rep.quality === 'good' ? `${n}. Good rep.` : `${n}. ${ev.rep.issues[0] || 'Try again'}.`;
      if (left === 1) line += ' One to go!';
      if (left > 0) this.say(line);
      else this.finishExercise({ lead: line });
    }
  }

  /** Skip the current exercise (the patient asked, or it hurts). */
  skip() {
    if (this.phase !== 'positioning' && this.phase !== 'recording') return false;
    this.finishExercise({ skipped: true });
    return true;
  }

  /** The patient's pain answer, 0-10, after the last exercise (or any time they mention it). Returns the record. */
  recordPain(pain, note = '') {
    this.log.setCheckIn({ pain, note });
    if (this.phase === 'pain') {
      this.log.finish();
      this.phase = 'done';
      const p = this.log.checkIn.pain;
      const who = this.plan.therapist ? `for ${this.plan.therapist}` : 'for your therapist';
      this.say(p !== null && p >= 6
        ? `Thanks for telling me. Please rest now, and let your therapist know about the pain. I've saved today's session ${who}.`
        : `Thanks. I've saved today's session ${who}. Nice work today!`);
    }
    return this.record();
  }

  /** A short plain-language status for the model ("what am I on?", "how am I doing?"). */
  status() {
    const ex = this.exercise;
    if (this.phase === 'idle') return 'The session has not started yet.';
    if (this.phase === 'pain') return 'All exercises are done. Waiting for the pain score from 0 to 10.';
    if (this.phase === 'done') return 'The session is finished and saved.';
    const reps = (this.tracker?.reps ?? []).filter((r) => r.counted);   // rushed or out-of-view reps don't count
    const good = reps.filter((r) => r.quality === 'good').length;
    const where = this.phase === 'positioning' ? 'waiting to see the patient in the camera' : `${reps.length} of ${ex.reps} reps done, ${good} good`;
    return `Exercise ${this.idx + 1} of ${this.exercises.length}: ${ex.name} (${where}). Instructions: ${ex.instruction}`;
  }

  /** Where the patient is right now, for the dashboard to show while the call is happening. */
  progress() {
    const ex = this.exercise;
    const reps = (this.tracker?.reps ?? []).filter((r) => r.counted);
    return {
      phase: this.phase,                                  // idle | positioning | recording | pain | done
      exercise: Math.min(this.idx + 1, this.exercises.length),
      exercises: this.exercises.length,
      name: ex?.name ?? null,
      reps: reps.length,
      target: ex?.reps ?? null,
      good: reps.filter((r) => r.quality === 'good').length,
    };
  }

  /** The session record (same format as session.html saves). Finishes it if still open. */
  record() {
    if (this.phase !== 'done' && !this.log.endedAt) {
      if (this.phase === 'positioning' || this.phase === 'recording') this.tracker.finish(this.t, { skipped: this.tracker.reps.length === 0 });
      this.log.finish();
    }
    return this.log.toRecord();
  }

  // ---- internals

  next(lead = '') {
    this.idx++;
    const ex = this.exercise;
    if (!ex) return this.allDone(lead);
    this.tracker = new ExerciseTracker(ex, this.log.beginExercise(ex));
    this.phase = 'positioning';
    this.seenSince = null;
    this.lastCue = this.t;
    this.say([lead, intro(ex, this.idx, this.exercises.length)].filter(Boolean).join(' '));
  }

  finishExercise({ skipped = false, lead = '' } = {}) {
    const ex = this.exercise, tr = this.tracker;
    tr.finish(this.t, { skipped });
    const s = tr.counter.summary();
    const done = skipped ? `Okay, we'll skip the ${ex.name.toLowerCase()}.`
      : `${ex.name} done. ${s.goodReps} of ${s.totalReps} good reps.${s.goodReps === s.totalReps && s.totalReps ? ' Lovely work!' : ''}`;
    this.next([lead, done].filter(Boolean).join(' '));
  }

  allDone(lead) {
    this.phase = 'pain';
    const t = this.log.toRecord().totals;
    const result = t.reps ? `That's all your exercises. ${t.good} of ${t.reps} good reps today.` : "That's all your exercises.";
    this.say([lead, result, 'On a scale of 0 to 10, how much pain did you feel today?'].filter(Boolean).join(' '));
  }
}

/** What to say before an exercise. Precise mode gives the target in degrees; simple mode gives no numbers. */
export function intro(ex, idx, total) {
  const which = idx === 0 ? 'First' : idx === total - 1 ? 'Last one' : 'Next';
  const aim = ex.mode === 'precise' ? ` Aim for ${ex.target} degrees.` : '';
  const stand = idx === 0 ? ' First, stand about 6 feet, or 3 big steps, back from the phone, so I can see you from head to feet.' : '';
  return `${which}: ${ex.name.toLowerCase()}. ${ex.view}.${stand} ${ex.instruction} ${ex.reps} reps.${aim} I'll start counting when I can see you.`;
}

/** A plain cue to get into the picture. */
export function positionCue(ex, someoneSeen) {
  // Same as the session page: stand about 6 feet back so the whole body, head to feet, is in the picture.
  return someoneSeen
    ? "I can't see you from head to feet yet. Step back a little, to about 6 feet, or tilt the phone down."
    : "I can't see you yet. Prop the phone up and step back about 6 feet, so I can see you from head to feet.";
}
