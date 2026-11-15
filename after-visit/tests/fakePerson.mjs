// A synthetic person for tests: 33 MediaPipe-style landmarks with a chosen right-arm raise angle and
// knee bend. Built in pixel space and normalized, so angles come out right for any video size.
// Also used by the browser test's fake MediaPipe, which serves this file to the page.

export function person({ armDeg = 15, kneeDeg = 175, elbowBend = 0, lean = 0, w = 1280, h = 720 } = {}) {
  const pts = Array.from({ length: 33 }, () => ({ x: w / 2, y: h * 0.3, v: 0.9 }));
  const set = (i, x, y, v = 0.95) => (pts[i] = { x, y, v });
  const U = h / 10;                              // body unit in pixels
  const cx = w / 2, hipY = h * 0.55;
  const leanR = (lean * Math.PI) / 180;

  // legs: shin straight down from the knee; thigh at kneeDeg from the shin
  const th = (kneeDeg * Math.PI) / 180, L = 1.6 * U;
  for (const [hip, knee, ankle, dx] of [[23, 25, 27, 0.8], [24, 26, 28, -0.8]]) {
    const hx = cx + dx * U;
    const kx = hx - L * Math.sin(th), ky = hipY - L * Math.cos(th);
    set(hip, hx, hipY); set(knee, kx, ky); set(ankle, kx, ky + L);
    set(ankle + 2, kx - 0.2 * U, ky + L + 0.2 * U); set(ankle + 4, kx + 0.4 * U, ky + L + 0.2 * U);   // heel, toe
  }

  // trunk (optionally leaning), shoulders 2.4 units above the hips
  const sy = hipY - 2.4 * U * Math.cos(leanR), sxo = 2.4 * U * Math.sin(leanR);
  set(11, cx + 0.8 * U + sxo, sy); set(12, cx - 0.8 * U + sxo, sy);
  set(0, cx + sxo, sy - 1.2 * U);                // nose
  for (let i = 1; i <= 10; i++) set(i, cx + sxo + (i % 2 ? 0.2 : -0.2) * U, sy - 1.3 * U);

  // arms: angle between "down the trunk" and the upper arm; right arm moves, left rests
  const arm = (sh, el, wr, deg, out) => {
    const r = (deg * Math.PI) / 180, s = pts[sh];
    const ex = s.x + out * 1.3 * U * Math.sin(r), ey = s.y + 1.3 * U * Math.cos(r);
    const r2 = r + out * (elbowBend * Math.PI) / 180;
    set(el, ex, ey);
    set(wr, ex + out * 1.2 * U * Math.sin(r2), ey + 1.2 * U * Math.cos(r2));
    for (const k of [wr + 2, wr + 4, wr + 6]) set(k, pts[wr].x, pts[wr].y);
  };
  arm(12, 14, 16, armDeg, -1);
  arm(11, 13, 15, 15, 1);

  return pts.map((p) => ({ x: p.x / w, y: p.y / h, z: 0, visibility: p.v }));
}

/**
 * The demo motion over time: every 5 s one arm raise and one squat together, alternating a good
 * rep (arm 150°, knees 100°) and a short one (arm 115°, knees 135°). Rep k peaks at 1.5 s + 5k s.
 */
export function demoMotion(tMs, opts = {}) {
  const cycle = 5000, k = Math.floor(tMs / cycle), u = (tMs % cycle) / cycle;
  const good = k % 2 === 0;
  // 0–0.2 rest, 0.2–0.5 up, 0.5–0.8 down, 0.8–1 rest (3 s per rep: not "too fast")
  const s = u < 0.2 ? 0 : u < 0.5 ? (u - 0.2) / 0.3 : u < 0.8 ? 1 - (u - 0.5) / 0.3 : 0;
  const ease = (1 - Math.cos(Math.PI * s)) / 2;
  const armPeak = good ? 150 : 115, kneePeak = good ? 100 : 135;
  return person({ armDeg: 15 + (armPeak - 15) * ease, kneeDeg: 175 - (175 - kneePeak) * ease, ...opts });
}
