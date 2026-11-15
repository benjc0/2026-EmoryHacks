// Runs one exercise: pose landmarks in -> angle, rep events and logged frames out.
// No DOM and no MediaPipe, so it can be tested in Node with synthetic landmarks.
//
// Side = auto: both sides are tracked with their own rep counter, and the tracker locks onto
// whichever side finishes the first rep. Facing the camera, both arms are visible, so visibility
// alone can't tell which one is exercising.
import { analyzeFrame, chooseSide } from './analysis.js';
import { RepCounter } from './repCounter.js';
import { makeSmoother } from './geometry.js';

const SWITCH_MARGIN = 8;   // degrees; before locking, show whichever side is moving clearly more

export class ExerciseTracker {
  /**
   * @param {Object} ex   exercise from planExercise()
   * @param {import('./sessionLog.js').ExerciseLog} log  where recorded frames and reps go
   */
  constructor(ex, log) {
    this.ex = ex;
    this.log = log;
    const sides = ex.side === 'auto' ? ['left', 'right'] : [ex.side];
    this.locked = sides.length === 1;
    this.side = this.locked ? sides[0] : null;
    this.counters = Object.fromEntries(sides.map((s) => [s, new RepCounter(ex, { targetAngle: ex.target })]));
    this.smoothers = Object.fromEntries(sides.map((s) => [s, makeSmoother(0.4)]));
    this.recording = false;
    this.t0 = 0;
  }

  get counter() { return this.counters[this.side] || Object.values(this.counters)[0]; }
  get reps() { return this.counter.reps; }
  get counted() { return this.counter.counted; }          // reps that count (not rushed or hidden)
  get done() { return this.counted >= this.ex.reps; }

  /** Recording started: from now on frames are logged and reps count. `now` is performance.now(). */
  startRecording(now) { this.recording = true; this.t0 = now; }

  /** ms into this exercise's video. */
  elapsed(now) { return this.recording ? now - this.t0 : 0; }

  /** 0–100: how far `angle` is from the rest position toward (and a bit past) the target. */
  progress(angle) {
    const { rest, target, direction } = this.ex;
    const lo = Math.min(rest, target) - 10, hi = Math.max(rest, target) + 10;
    const p = ((direction === 'increase' ? angle - lo : hi - angle) / (hi - lo)) * 100;
    return Math.max(0, Math.min(100, p));
  }
  targetProgress() { return this.progress(this.ex.target); }

  /**
   * Feed one pose result.
   * @param {Array|null} landmarks  33 MediaPipe landmarks, or null when nobody is in view
   * @returns {{ seen:boolean, side:string|null, angle:number|null, visible:boolean,
   *             atTarget:boolean, broken:Object|null, holding:number|null, events:Array }}
   */
  update(landmarks, w, h, now) {
    const out = { seen: !!landmarks, side: this.side, angle: null, visible: false, atTarget: false, broken: null, holding: null, events: [] };
    if (!landmarks) return out;
    const ex = this.ex;

    const per = {};
    for (const s of Object.keys(this.counters)) {
      const fr = analyzeFrame(ex, s, landmarks, w, h);
      per[s] = { fr, angle: this.smoothers[s].next(fr.angle) };
    }
    if (!this.locked) {
      const travel = (s) => (per[s].fr.visible && Number.isFinite(per[s].angle) ? Math.abs(per[s].angle - ex.rest) : -1);
      const l = travel('left'), r = travel('right');
      this.side = l > r + SWITCH_MARGIN ? 'left' : r > l + SWITCH_MARGIN ? 'right' : (this.side || chooseSide(ex, landmarks));
    }

    const { fr, angle } = per[this.side];
    const counter = this.counters[this.side];
    Object.assign(out, {
      side: this.side,
      angle: Number.isFinite(angle) ? angle : null,
      visible: fr.visible,
      atTarget: Number.isFinite(angle) && counter.beyond(angle, ex.target),
    });
    if (!this.recording) return out;

    const t = now - this.t0;
    this.log.addFrame(t, { side: this.side, angle, landmarks, checks: fr.checks });

    if (counter.state === 'active') {
      out.broken = (ex.checks || []).find((c) => fr.checks[c.id]?.violated) || null;
      if (ex.holdMs && out.atTarget) out.holding = Math.min(counter.current.heldMs, ex.holdMs);
    }

    let mine = null;
    for (const [s, c] of Object.entries(this.counters)) {
      const ev = c.update({ t, angle: per[s].angle, visible: per[s].fr.visible, checks: per[s].fr.checks });
      if (ev?.type === 'rep' && ev.rep.counted && !this.locked) {   // first counted rep decides the side
        this.locked = true;
        this.side = s;
        this.counters = { [s]: c };
        out.side = s;
        mine = ev;
        break;
      }
      if (s === this.side) mine = ev;
    }
    if (mine) {
      if (mine.type === 'rep') this.log.addRep(mine.rep);
      out.events.push(mine);
    }
    return out;
  }

  /** Close the exercise log. */
  finish(now, { video = null, skipped = false } = {}) {
    this.log.end({
      durationMs: this.elapsed(now),
      side: this.side || Object.keys(this.counters)[0],
      summary: this.counter.summary(),
      video,
      skipped,
    });
  }
}
