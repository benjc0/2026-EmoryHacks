// Pure frame helpers for pose tracking on FaceTime video: no Python, no LiveKit, so the tests can run them.
//
// Chert delivers the caller's camera as a 1280x720 frame. A phone held upright arrives as a tall picture with
// black bars on both sides, so we find the picture, crop to it, and shrink it before sending it to MediaPipe.

const DARK = 14;        // a column/row is "bar" when its average brightness is below this (0-255)
const STEP = 4;         // sample every 4th pixel: plenty for finding bars, 16x less work

/**
 * The part of an RGBA frame that isn't black bars: { x, y, w, h } in pixels.
 * Falls back to the whole frame when the picture itself is very dark.
 */
export function contentBox(rgba, width, height) {
  const colLit = (x) => {
    let sum = 0, n = 0;
    for (let y = 0; y < height; y += STEP) { const i = (y * width + x) * 4; sum += rgba[i] + rgba[i + 1] + rgba[i + 2]; n++; }
    return sum / (n * 3) >= DARK;
  };
  const rowLit = (y, x0, x1) => {
    let sum = 0, n = 0;
    for (let x = x0; x < x1; x += STEP) { const i = (y * width + x) * 4; sum += rgba[i] + rgba[i + 1] + rgba[i + 2]; n++; }
    return n > 0 && sum / (n * 3) >= DARK;
  };
  let x0 = 0, x1 = width - 1;
  while (x0 < x1 && !colLit(x0)) x0 += STEP;
  while (x1 > x0 && !colLit(x1)) x1 -= STEP;
  let y0 = 0, y1 = height - 1;
  while (y0 < y1 && !rowLit(y0, x0, x1)) y0 += STEP;
  while (y1 > y0 && !rowLit(y1, x0, x1)) y1 -= STEP;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w < width * 0.15 || h < height * 0.15) return { x: 0, y: 0, w: width, h: height };
  return { x: x0, y: y0, w, h };
}

/** Crop `box` out of an RGBA frame and scale it so its longer side is `maxSide`. Returns tightly packed RGB. */
export function cropToRgb(rgba, width, box, maxSide = 480) {
  const scale = Math.min(1, maxSide / Math.max(box.w, box.h));
  const w = Math.max(1, Math.round(box.w * scale)), h = Math.max(1, Math.round(box.h * scale));
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = box.y + Math.min(box.h - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = box.x + Math.min(box.w - 1, Math.floor(x / scale));
      const i = (sy * width + sx) * 4, o = (y * w + x) * 3;
      out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2];
    }
  }
  return { rgb: out, width: w, height: h };
}

/** The 16-byte header pose_server.py expects before each frame. */
export function frameHeader(width, height, t, length) {
  const head = Buffer.alloc(16);
  head.writeUInt32LE(width, 0); head.writeUInt32LE(height, 4);
  head.writeUInt32LE(Math.max(0, Math.round(t)) >>> 0, 8); head.writeUInt32LE(length, 12);
  return head;
}

/** [[x,y,z,v], ...] from pose_server.py into the { x, y, z, visibility } objects js/analysis.js reads. */
export function toLandmarks(lm) {
  return Array.isArray(lm) && lm.length === 33 ? lm.map(([x, y, z, visibility]) => ({ x, y, z, visibility })) : null;
}
