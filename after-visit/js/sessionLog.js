// Everything recorded during one home PT session, in the shape the therapist review reads.
// No DOM, no MediaPipe: the session screen feeds it, the store saves it, tests can run it in Node.
//
// One session = several exercises from the plan. Each exercise gets its own video recording, so every
// time inside an exercise (frames, reps) is in ms from the start of *that exercise's* video.
import { pack } from './draw.js';

export const SCHEMA_VERSION = 2;
export const FRAME_INTERVAL_MS = 66;   // log landmarks ~15 times a second
export const LANDMARK_FORMAT =
  '[x, y, z, visibility]; x/y normalized 0-1 image coords (unmirrored); 33 MediaPipe Pose points';

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

export class ExerciseLog {
  constructor(ex, idx) {
    this.idx = idx;
    this.ex = ex;
    this.frames = [];
    this.reps = [];
    this.side = ex.side === 'auto' ? null : ex.side;
    this.durationMs = 0;
    this.summary = null;
    this.video = null;
    this.skipped = false;
  }

  /**
   * Log one tracked frame. Throttled to FRAME_INTERVAL_MS; returns true if it was kept.
   * @param {number} t ms since this exercise's recording started
   * @param {{side:string, angle:number, landmarks:Array, checks?:Object}} f
   */
  addFrame(t, { side, angle, landmarks, checks }) {
    const last = this.frames.at(-1);
    if (last && t - last.t < FRAME_INTERVAL_MS) return false;
    const frame = { t: Math.round(t), side, a: r1(angle), lm: landmarks ? pack(landmarks) : null };
    const broken = Object.entries(checks || {}).filter(([, c]) => c.violated).map(([id]) => id);
    if (broken.length) frame.c = broken;      // form rules broken in this frame
    this.frames.push(frame);
    return true;
  }

  addRep(rep) { this.reps.push(rep); }

  /** Close the exercise. `summary` comes from RepCounter.summary(). */
  end({ durationMs, side, summary, video = null, skipped = false }) {
    this.durationMs = Math.round(durationMs || 0);
    if (side) this.side = side;
    this.summary = summary;
    this.video = video;   // { mime, width, height, bytes } – the Blob itself goes to the store
    this.skipped = skipped;
  }

  /** Meta + reps, without the (large) frames. */
  toRecord() {
    const ex = this.ex;
    return {
      idx: this.idx,
      id: ex.id,
      name: ex.name,
      mode: ex.mode,
      side: this.side,
      joint: ex.joint,
      direction: ex.direction,
      rest: ex.rest,
      target: ex.target,
      holdMs: ex.holdMs || 0,
      repsTarget: ex.reps,
      checks: (ex.checks || []).map(({ id, label }) => ({ id, label })),
      durationMs: this.durationMs,
      skipped: this.skipped,
      summary: this.summary,
      reps: this.reps,
      video: this.video,
      frameCount: this.frames.length,
    };
  }
}

export class SessionLog {
  constructor({ plan, now = new Date() } = {}) {
    this.id = newId();
    this.plan = plan || null;
    this.startedAt = now.toISOString();
    this.endedAt = null;
    this.exercises = [];
    this.checkIn = { pain: null, note: '', noteAudio: null, at: null };
  }

  beginExercise(ex) {
    const log = new ExerciseLog(ex, this.exercises.length);
    this.exercises.push(log);
    return log;
  }

  get current() { return this.exercises.at(-1) || null; }

  /** Pain 0–10 and an optional note (typed, dictated, or a recorded audio clip). */
  setCheckIn({ pain, note = '', noteAudio = null, now = new Date() }) {
    const p = Number(pain);
    this.checkIn = {
      pain: Number.isFinite(p) ? Math.max(0, Math.min(10, Math.round(p))) : null,
      note: String(note).trim(),
      noteAudio,              // { mime, bytes, durationMs } – the Blob goes to the store
      at: now.toISOString(),
    };
  }

  finish(now = new Date()) { this.endedAt = now.toISOString(); }

  /** The session record (no frames). Frames are saved separately so lists stay fast. */
  toRecord() {
    const exercises = this.exercises.map((e) => e.toRecord());
    return {
      schema: SCHEMA_VERSION,
      id: this.id,
      planId: this.plan?.id ?? null,
      therapist: this.plan?.therapist ?? null,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationMs: exercises.reduce((s, e) => s + e.durationMs, 0),
      landmarkFormat: LANDMARK_FORMAT,
      exercises,
      checkIn: this.checkIn,
      totals: totals(exercises),
      flagged: flaggedReps(exercises),
      attention: needsAttention({ exercises, checkIn: this.checkIn }),
      review: null,           // { at, by, comment } once the therapist has looked
    };
  }

  /** { [exerciseIdx]: frames[] } for the store. */
  framesByExercise() {
    return Object.fromEntries(this.exercises.map((e) => [e.idx, e.frames]));
  }
}

// ------------------------------------------------------------------ derived summaries

export function totals(exercises) {
  const reps = exercises.flatMap((e) => e.reps || []);
  const count = (q) => reps.filter((r) => r.quality === q).length;
  const good = count('good');
  return {
    exercisesDone: exercises.filter((e) => !e.skipped && (e.reps || []).length > 0).length,
    exercisesPlanned: exercises.length,
    reps: reps.length,
    good,
    fair: count('fair'),
    poor: count('poor'),
    qualityPct: reps.length ? Math.round((good / reps.length) * 100) : 0,
  };
}

/** Every rep that wasn't "good", in the order the therapist should look at them (poor first). */
export function flaggedReps(exercises) {
  const order = { poor: 0, fair: 1 };
  return exercises
    .flatMap((e) => (e.reps || [])
      .filter((r) => r.quality !== 'good')
      .map((r) => ({
        exercise: e.idx,
        exerciseName: e.name,
        rep: r.n,
        quality: r.quality,
        peakAngle: r.peakAngle,
        target: r.targetAngle ?? e.target,
        startMs: r.startMs,
        endMs: r.endMs,
        issues: r.issues || [],
      })))
    .sort((a, b) => order[a.quality] - order[b.quality] || a.exercise - b.exercise || a.rep - b.rep);
}

/** Short plain-language reasons this session deserves a look. Empty = nothing stands out. */
export function needsAttention({ exercises, checkIn }) {
  const out = [];
  if (checkIn?.pain != null && checkIn.pain >= 5) out.push({ kind: 'pain', text: `Pain ${checkIn.pain} out of 10` });
  for (const e of exercises) {
    if (e.skipped) { out.push({ kind: 'skipped', exercise: e.idx, text: `${e.name} skipped` }); continue; }
    const reps = e.reps || [];
    const poor = reps.filter((r) => r.quality === 'poor').length;
    if (poor) out.push({ kind: 'poor', exercise: e.idx, text: `${e.name}: ${poor} poor rep${poor > 1 ? 's' : ''}` });
    const form = new Map();
    for (const r of reps) for (const id of r.formFlags || []) form.set(id, (form.get(id) || 0) + 1);
    for (const [id, n] of form) {
      if (n >= 2) {
        const label = (e.checks || []).find((c) => c.id === id)?.label || id;
        out.push({ kind: 'form', exercise: e.idx, text: `${e.name}: "${label}" on ${n} reps` });
      }
    }
    if (reps.length && reps.length < e.repsTarget) {
      out.push({ kind: 'short', exercise: e.idx, text: `${e.name}: ${reps.length} of ${e.repsTarget} reps` });
    }
  }
  return out;
}

/**
 * Compare this session's best angle per exercise with earlier sessions (newest first).
 * Returns [{ exercise, name, best, previousBest, change }] – change > 0 means more range.
 */
export function progressVsPrevious(record, previous = []) {
  return record.exercises.map((e) => {
    const best = e.summary?.bestPeakAngle ?? null;
    const prev = previous
      .map((p) => p.exercises.find((x) => x.id === e.id && x.summary?.bestPeakAngle != null))
      .find(Boolean);
    const previousBest = prev?.summary.bestPeakAngle ?? null;
    let change = null;
    if (best != null && previousBest != null) {
      change = e.direction === 'decrease' ? previousBest - best : best - previousBest;
    }
    return { exercise: e.idx, name: e.name, best, previousBest, change };
  });
}
