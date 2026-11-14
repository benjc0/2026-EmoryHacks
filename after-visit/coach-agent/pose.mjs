// Runs pose_server.py (Python MediaPipe) next to the coach and feeds it FaceTime frames.
//
// One frame in flight at a time: while MediaPipe works on a frame, newer frames are skipped, so the coach
// always tracks the latest picture and never falls behind the call.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { contentBox, cropToRgb, frameHeader, toLandmarks } from './pose-frames.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const SCRIPT = here('./pose/pose_server.py');
const MODEL = here('./pose/models/pose_landmarker_lite.task');
const BOX_EVERY_MS = 2000;   // look for the black bars again every 2 s (the phone may rotate)

/** C:\Users\x -> /mnt/c/Users/x, for handing Windows paths to WSL. */
export const toWslPath = (p) => p.replace(/^([A-Za-z]):[\\/]/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');

/**
 * How to start pose_server.py. On Windows it runs inside WSL Ubuntu by default: Windows' Application Control
 * blocks MediaPipe's native DLL, and Linux in WSL is not subject to it. POSE_RUNTIME=native uses pose/.venv here.
 */
export function poseCommand(env = process.env, platform = process.platform) {
  const runtime = env.POSE_RUNTIME || (platform === 'win32' ? 'wsl' : 'native');
  if (runtime === 'wsl') {
    const distro = env.POSE_WSL_DISTRO || 'Ubuntu-24.04';
    const python = env.POSE_WSL_PYTHON || '~/.venvs/emory-pose/bin/python';
    // --exec skips WSL's own shell (which would expand $ and quotes); bash -c then expands ~ once.
    const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
    return { cmd: 'wsl.exe', args: ['-d', distro, '--exec', 'bash', '-c', `exec ${python} ${q(toWslPath(SCRIPT))} ${q(toWslPath(MODEL))}`], runtime };
  }
  const python = platform === 'win32' ? here('./pose/.venv/Scripts/python.exe') : here('./pose/.venv/bin/python');
  return { cmd: python, args: [SCRIPT, MODEL], runtime, check: python };
}

/**
 * Start the pose helper. Resolves once MediaPipe has loaded.
 * @returns {Promise<{ track(frame:{rgba,width,height,t}): Promise<{landmarks, w, h, t}|null>, close(): void }>}
 */
export function startPose({ command = poseCommand(), log = console.log } = {}) {
  if (command.check && !existsSync(command.check)) return Promise.reject(new Error(`Pose helper not set up: ${command.check} is missing (see pose/README.md)`));
  const child = spawn(command.cmd, command.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  // MediaPipe prints a lot of startup INFO/WARNING lines; pass on only real errors (tracebacks etc.).
  const noise = /^(INFO:|WARNING:|[WI]\d{4} |W0000|I0000|absl|inference_feedback|TensorFlow Lite|Logging before InitGoogle)/;
  child.stderr.on('data', (d) => {
    for (const line of String(d).split(/\r?\n/)) if (line.trim() && !noise.test(line.trim())) log(`[pose] ${line.slice(0, 300)}`);
  });

  let pending = null;            // { resolve, w, h, t } for the frame in flight
  let box = null, boxAt = -Infinity;
  let closed = false;

  let ready = false;
  return new Promise((resolve, reject) => {
    child.on('error', (error) => { closed = true; if (!ready) reject(error); });
    child.on('exit', (code) => {
      closed = true;
      pending?.resolve(null); pending = null;
      if (!ready) reject(new Error(`Pose helper exited (${code}) before it was ready`));
      else if (code) log(`[pose] helper stopped (exit ${code})`);
    });

    lines.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.ready) {
        ready = true;
        resolve({ track, close });
        return;
      }
      const p = pending; pending = null;
      p?.resolve({ landmarks: toLandmarks(msg.lm), w: p.w, h: p.h, t: p.t });
    });
  });

  /** Track one RGBA frame. Resolves with landmarks (or null landmarks when nobody is in view), or null if skipped. */
  function track({ rgba, width, height, t }) {
    if (closed || pending) return Promise.resolve(null);
    if (t - boxAt >= BOX_EVERY_MS || !box) { box = contentBox(rgba, width, height); boxAt = t; }
    const { rgb, width: w, height: h } = cropToRgb(rgba, width, box);
    return new Promise((resolve) => {
      pending = { resolve, w, h, t };
      child.stdin.write(frameHeader(w, h, t, rgb.length));
      child.stdin.write(rgb);
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    pending?.resolve(null); pending = null;
    child.stdin.end();
    setTimeout(() => child.kill(), 1000).unref();
  }
}
