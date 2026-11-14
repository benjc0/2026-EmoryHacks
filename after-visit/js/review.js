// Therapist review helpers: find the logged frame for a video time, and draw the angle chart.

/** Logged frame closest to (and not after) time t in ms. Frames are sorted by t. */
export function frameAt(frames, t) {
  let lo = 0, hi = frames.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) { best = frames[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best && t - best.t < 500 ? best : null;
}

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const QCOLOR = { good: '--accent', fair: '#c98a00', poor: '--warn' };

/**
 * Angle over time with the target line and each rep shaded by quality.
 * Returns a function that maps a click x (CSS px) to a time in ms.
 */
export function drawChart(canvas, { frames, reps, target, rest, durationMs, playheadMs = null }) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const pad = { l: 40, r: 10, t: 10, b: 22 };
  const angles = frames.map((f) => f.a).filter(Number.isFinite);
  const end = Math.max(durationMs || 0, frames.at(-1)?.t || 0, 1);
  const lo = Math.max(0, Math.floor((Math.min(...angles, target ?? 180, rest ?? 180) - 10) / 10) * 10);
  const hi = Math.min(180, Math.ceil((Math.max(...angles, target ?? 0, rest ?? 0) + 10) / 10) * 10);
  const X = (t) => pad.l + (t / end) * (W - pad.l - pad.r);
  const Y = (a) => pad.t + (1 - (a - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const ink = css('--ink', '#1d2327'), muted = css('--muted', '#5d6870'), line = css('--line', '#e3ddd3');

  // rep bands
  for (const r of reps) {
    const c = QCOLOR[r.quality] || '--muted';
    ctx.fillStyle = c.startsWith('--') ? css(c, '#999') : c;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(X(r.startMs), pad.t, Math.max(2, X(r.endMs) - X(r.startMs)), H - pad.t - pad.b);
    ctx.globalAlpha = 1;
  }
  // grid + y labels
  ctx.font = '11px -apple-system, system-ui, sans-serif';
  ctx.fillStyle = muted; ctx.strokeStyle = line; ctx.lineWidth = 1;
  for (let a = lo; a <= hi; a += hi - lo > 80 ? 30 : 15) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(a)); ctx.lineTo(W - pad.r, Y(a)); ctx.stroke();
    ctx.fillText(`${a}°`, 4, Y(a) + 4);
  }
  // x labels (seconds)
  const step = end > 120000 ? 30000 : end > 40000 ? 10000 : 5000;
  for (let t = 0; t <= end; t += step) ctx.fillText(`${Math.round(t / 1000)}s`, X(t) - 8, H - 6);
  // target line
  if (Number.isFinite(target)) {
    ctx.strokeStyle = css('--accent', '#127a5a'); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(target)); ctx.lineTo(W - pad.r, Y(target)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = css('--accent', '#127a5a');
    ctx.fillText(`target ${target}°`, W - pad.r - 70, Y(target) - 4);
  }
  // angle line
  ctx.strokeStyle = ink; ctx.lineWidth = 1.75; ctx.beginPath();
  let pen = false;
  for (const f of frames) {
    if (!Number.isFinite(f.a)) { pen = false; continue; }
    pen ? ctx.lineTo(X(f.t), Y(f.a)) : ctx.moveTo(X(f.t), Y(f.a));
    pen = true;
  }
  ctx.stroke();
  // playhead
  if (playheadMs !== null) {
    ctx.strokeStyle = css('--warn', '#b3261e'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(playheadMs), pad.t); ctx.lineTo(X(playheadMs), H - pad.b); ctx.stroke();
  }
  return (cssX) => Math.max(0, Math.min(end, ((cssX - pad.l) / (W - pad.l - pad.r)) * end));
}
