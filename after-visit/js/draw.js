// Skeleton drawing + landmark packing. No MediaPipe import, so the therapist review can use it cheaply.
import { CONNECTIONS, SIDES } from './geometry.js';

/** Pack landmarks compactly for logging: [x, y, z, visibility] rounded. */
export const pack = (lms) => lms.map((p) => [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4), +(p.visibility ?? 0).toFixed(3)]);
export const unpack = (arr) => arr.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));

/**
 * Draw the skeleton. `highlight` = { side, joint:[a,b,c] } draws the measured angle in the accent colour.
 * `mirror` = the canvas is flipped with CSS (selfie view), so text is drawn flipped back.
 */
export function drawPose(canvas, lms, { highlight, angle, mirror = false, status = 'ok' } = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!lms) return;
  const P = (i) => ({ x: lms[i].x * w, y: lms[i].y * h, v: lms[i].visibility ?? 1 });
  const lw = Math.max(3, w / 220);

  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = lw;
  for (const [a, b] of CONNECTIONS) {
    const pa = P(a), pb = P(b);
    if (pa.v < 0.5 || pb.v < 0.5) continue;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  for (let i = 11; i < 33; i++) {
    const p = P(i); if (p.v < 0.5) continue;
    ctx.beginPath(); ctx.arc(p.x, p.y, lw * 1.1, 0, Math.PI * 2); ctx.fill();
  }

  if (highlight) {
    const idx = SIDES[highlight.side];
    const [a, b, c] = highlight.joint.map((n) => P(idx[n]));
    // design-system pages/pt-session.md: light blue normally, salmon while a form rule is broken
    const color = status === 'warn' ? '#FFB4A2' : '#A6C8E2';
    ctx.strokeStyle = color; ctx.lineWidth = lw * 2.2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    ctx.fillStyle = color;
    for (const p of [a, b, c]) { ctx.beginPath(); ctx.arc(p.x, p.y, lw * 2, 0, Math.PI * 2); ctx.fill(); }
    if (Number.isFinite(angle)) {
      const r = Math.max(28, w / 22);
      const a1 = Math.atan2(a.y - b.y, a.x - b.x), a2 = Math.atan2(c.y - b.y, c.x - b.x);
      let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(b.x, b.y, r, a1, a1 + d, d < 0); ctx.stroke();
      const label = `${Math.round(angle)}°`;
      const fs = Math.max(22, w / 26);
      ctx.save();
      ctx.translate(b.x + r * 1.2, b.y - r * 0.6);
      if (mirror) ctx.scale(-1, 1);
      ctx.font = `600 ${fs}px Inter, -apple-system, system-ui, sans-serif`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-tw / 2 - 8, -fs * 0.85, tw + 16, fs * 1.2);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
}
