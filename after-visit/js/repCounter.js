// Turns a stream of joint angles into reps and scores each rep's quality.
//
// States:  waiting -> (patient reaches start position) -> rest -> (leaves rest zone) -> active
//          active -> (returns to rest zone) -> rep scored -> rest ...

const HYSTERESIS = 10;   // degrees past the rest line before a rep "starts"
const MIN_TRAVEL = 15;   // movements smaller than this are ignored as noise
const FLAG_SHARE = 0.3;  // a form rule is flagged if broken in >30% of the rep's frames

export class RepCounter {
  constructor(ex, { targetAngle } = {}) {
    this.ex = ex;
    this.inc = ex.direction === 'increase';
    this.rest = ex.rest;
    this.partial = ex.partial;
    this.target = targetAngle ?? ex.target;
    // If the plan's target is easier than the library's "partial" line, put partial halfway.
    if (!this.beyond(this.target, this.partial)) this.partial = (this.rest + this.target) / 2;
    this.state = 'waiting';
    this.reps = [];
    this.current = null;
  }

  // "a is further along the movement than b"
  beyond(a, b) { return this.inc ? a >= b : a <= b; }
  inRest(angle) { return this.inc ? angle <= this.rest : angle >= this.rest; }
  leftRest(angle) { return this.inc ? angle > this.rest + HYSTERESIS : angle < this.rest - HYSTERESIS; }

  /**
   * @param {{t:number, angle:number, visible:boolean, checks:Object}} f
   * @returns {null | {type:'ready'} | {type:'rep', rep:Object} | {type:'ignored'}}
   */
  update(f) {
    if (!Number.isFinite(f.angle)) return null;

    if (this.state === 'waiting') {
      if (f.visible && this.inRest(f.angle)) { this.state = 'rest'; return { type: 'ready' }; }
      return null;
    }

    if (this.state === 'rest') {
      if (f.visible && this.leftRest(f.angle)) {
        this.state = 'active';
        this.current = { startMs: f.t, peak: f.angle, frames: 0, hidden: 0, violations: {}, lastT: f.t, heldMs: 0 };
      }
      return null;
    }

    // active
    const c = this.current;
    c.frames += 1;
    if (!f.visible) c.hidden += 1;
    if (this.beyond(f.angle, c.peak)) c.peak = f.angle;
    if (this.beyond(f.angle, this.target)) c.heldMs += f.t - c.lastT;   // time spent at/past the target
    c.lastT = f.t;
    for (const [id, r] of Object.entries(f.checks || {})) {
      if (r.violated) c.violations[id] = (c.violations[id] || 0) + 1;
    }

    if (this.inRest(f.angle)) {
      this.state = 'rest';
      this.current = null;
      if (Math.abs(c.peak - this.rest) < MIN_TRAVEL) return { type: 'ignored' };
      const rep = this.score(c, f.t);
      this.reps.push(rep);
      return { type: 'rep', rep };
    }
    return null;
  }

  score(c, endMs) {
    const durationMs = endMs - c.startMs;
    const reachedTarget = this.beyond(c.peak, this.target);
    const reachedPartial = this.beyond(c.peak, this.partial);
    const tooFast = durationMs < this.ex.minRepMs;
    const formFlags = (this.ex.checks || [])
      .filter((chk) => c.frames > 0 && (c.violations[chk.id] || 0) / c.frames > FLAG_SHARE)
      .map((chk) => chk.id);
    const lowVisibility = c.frames > 0 && c.hidden / c.frames > 0.5;
    const holdMs = this.ex.holdMs || 0;
    const heldEnough = !holdMs || c.heldMs >= holdMs;

    const issues = [];
    if (!reachedTarget) issues.push(this.ex.cueRange);
    if (reachedTarget && !heldEnough) issues.push(`Hold at the top for ${holdMs / 1000} seconds`);
    if (tooFast) issues.push('Slow down');
    for (const id of formFlags) issues.push(this.ex.checks.find((x) => x.id === id).label);
    if (lowVisibility) issues.push('Stay fully in the frame');

    let quality;
    if (reachedTarget && heldEnough && !tooFast && formFlags.length === 0 && !lowVisibility) quality = 'good';
    else if (reachedPartial) quality = 'fair';
    else quality = 'poor';

    return {
      n: this.reps.length + 1,
      startMs: Math.round(c.startMs),
      endMs: Math.round(endMs),
      durationMs: Math.round(durationMs),
      peakAngle: Math.round(c.peak),
      targetAngle: this.target,
      reachedTarget,
      heldMs: Math.round(c.heldMs),
      tooFast,
      formFlags,
      quality,
      issues,
    };
  }

  summary() {
    const n = this.reps.length;
    const good = this.reps.filter((r) => r.quality === 'good').length;
    const peaks = this.reps.map((r) => r.peakAngle);
    const best = n ? (this.inc ? Math.max(...peaks) : Math.min(...peaks)) : null;
    const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    return {
      totalReps: n,
      goodReps: good,
      fairReps: this.reps.filter((r) => r.quality === 'fair').length,
      poorReps: this.reps.filter((r) => r.quality === 'poor').length,
      qualityPct: n ? Math.round((good / n) * 100) : 0,
      bestPeakAngle: best,
      avgPeakAngle: avg(peaks),
      avgRepMs: avg(this.reps.map((r) => r.durationMs)),
    };
  }
}
