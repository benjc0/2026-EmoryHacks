// Geometry helpers for pose landmarks (MediaPipe Pose: 33 landmarks).

// Landmark indices by body side. "left" = the patient's own left.
export const SIDES = {
  left:  { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 },
};

// Skeleton lines drawn on the overlay.
export const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32], [27, 29], [28, 30],
];

const DEG = 180 / Math.PI;

/** Normalized landmark -> pixel point (keeps the angle math correct on non-square video). */
export function toPx(lm, w, h) {
  return { x: lm.x * w, y: lm.y * h, v: lm.visibility ?? 1 };
}

/** Angle ABC in degrees, measured at B (0–180). */
export function angleAt(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return NaN;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return Math.acos(cos) * DEG;
}

/** How far the trunk leans away from vertical, in degrees (0 = upright). */
export function trunkLean(px) {
  const sx = (px[11].x + px[12].x) / 2, sy = (px[11].y + px[12].y) / 2;
  const hx = (px[23].x + px[24].x) / 2, hy = (px[23].y + px[24].y) / 2;
  const dx = sx - hx, dy = sy - hy; // shoulders should be above hips (dy < 0)
  return Math.atan2(Math.abs(dx), -dy) * DEG;
}

/** Exponential moving average to steady a jittery angle. */
export function makeSmoother(alpha = 0.4) {
  let prev = null;
  return {
    next(x) {
      if (!Number.isFinite(x)) return prev;
      prev = prev === null ? x : prev + alpha * (x - prev);
      return prev;
    },
    reset() { prev = null; },
  };
}

export const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
