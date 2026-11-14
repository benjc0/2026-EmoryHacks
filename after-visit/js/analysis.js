import { SIDES, toPx, angleAt, trunkLean } from './geometry.js';

const MIN_VIS = 0.5;

/** Pick the body side the camera sees best for this exercise. */
export function chooseSide(ex, landmarks) {
  const score = (side) => ex.joint.reduce((s, name) => s + (landmarks[SIDES[side][name]].visibility ?? 0), 0);
  return score('left') >= score('right') ? 'left' : 'right';
}

/**
 * Measure one video frame.
 * Returns { angle, visible, checks: { [id]: { value, violated } } }.
 */
export function analyzeFrame(ex, side, landmarks, w, h) {
  const px = landmarks.map((lm) => toPx(lm, w, h));
  const idx = SIDES[side];
  const [a, b, c] = ex.joint.map((name) => px[idx[name]]);
  const visible = [a, b, c].every((p) => p.v >= MIN_VIS);
  const angle = angleAt(a, b, c);

  const checks = {};
  for (const chk of ex.checks || []) {
    let value = NaN;
    let seen = true;
    if (chk.type === 'jointAngle') {
      const pts = chk.joint.map((name) => px[idx[name]]);
      seen = pts.every((p) => p.v >= MIN_VIS);
      value = angleAt(...pts);
    } else if (chk.type === 'trunkLean') {
      seen = [11, 12, 23, 24].every((i) => px[i].v >= MIN_VIS);
      value = trunkLean(px);
    }
    const violated = seen && Number.isFinite(value) &&
      ((chk.min !== undefined && value < chk.min) || (chk.max !== undefined && value > chk.max));
    checks[chk.id] = { value, violated, seen };
  }
  return { angle, visible, checks };
}
