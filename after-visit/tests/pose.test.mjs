import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { contentBox, cropToRgb, frameHeader, toLandmarks } from '../coach-agent/pose-frames.mjs';
import { poseCommand, startPose, toWslPath } from '../coach-agent/pose.mjs';

/** A 1280x720 RGBA frame: black bars, with a grey picture from x0 to x1 (like a portrait phone over FaceTime). */
function letterboxed(x0 = 400, x1 = 884, W = 1280, H = 720) {
  const f = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, lit = x >= x0 && x < x1;
    f[i] = f[i + 1] = f[i + 2] = lit ? 120 : 0; f[i + 3] = 255;
  }
  return { f, W, H };
}

test('contentBox finds the picture between black bars', () => {
  const { f, W, H } = letterboxed();
  const box = contentBox(f, W, H);
  assert.ok(Math.abs(box.x - 400) <= 4, `x ${box.x}`);
  assert.ok(Math.abs(box.x + box.w - 884) <= 4, `right ${box.x + box.w}`);
  assert.equal(box.y, 0);
  assert.equal(box.h, H);
});

test('contentBox keeps the whole frame when there are no bars, or the picture is all dark', () => {
  const { f: full, W, H } = letterboxed(0, 1280);
  assert.deepEqual(contentBox(full, W, H), { x: 0, y: 0, w: W, h: H });
  const dark = new Uint8Array(W * H * 4);
  assert.deepEqual(contentBox(dark, W, H), { x: 0, y: 0, w: W, h: H });
});

test('cropToRgb crops, keeps the shape, and caps the longer side', () => {
  const { f, W } = letterboxed();
  const { rgb, width, height } = cropToRgb(f, W, { x: 400, y: 0, w: 484, h: 720 }, 480);
  assert.equal(height, 480);
  assert.equal(width, Math.round(484 * (480 / 720)));
  assert.equal(rgb.length, width * height * 3);
  assert.equal(rgb[0], 120);  // inside the picture, not a bar
});

test('frameHeader is the 16-byte little-endian header pose_server.py reads', () => {
  const h = frameHeader(320, 480, 1234.6, 320 * 480 * 3);
  assert.equal(h.length, 16);
  assert.deepEqual([h.readUInt32LE(0), h.readUInt32LE(4), h.readUInt32LE(8), h.readUInt32LE(12)], [320, 480, 1235, 460800]);
});

test('toLandmarks turns arrays into the objects js/analysis.js reads, or null', () => {
  const lm = toLandmarks(Array.from({ length: 33 }, (_, i) => [i / 100, 0.5, 0, 0.9]));
  assert.deepEqual(lm[11], { x: 0.11, y: 0.5, z: 0, visibility: 0.9 });
  assert.equal(toLandmarks(null), null);
  assert.equal(toLandmarks([[0, 0, 0, 0]]), null);
});

test('toWslPath maps Windows drive paths into WSL', () => {
  assert.equal(toWslPath('C:\\Users\\Ben\\x\\pose_server.py'), '/mnt/c/Users/Ben/x/pose_server.py');
  assert.equal(toWslPath('D:/data/m.task'), '/mnt/d/data/m.task');
});

test('poseCommand runs in WSL on Windows by default, natively elsewhere', () => {
  const win = poseCommand({}, 'win32');
  assert.equal(win.runtime, 'wsl');
  assert.equal(win.cmd, 'wsl.exe');
  assert.deepEqual(win.args.slice(0, 2), ['-d', 'Ubuntu-24.04']);
  assert.equal(win.args[2], '--exec');
  // Build the expected WSL script/model command the same way poseCommand does (toWslPath + bash quoting),
  // instead of asserting a literal '/mnt/...' path: that only appears when the checkout itself lives under
  // a Windows-style path, so a hardcoded regex would pass or fail depending on the machine running the test.
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const script = toWslPath(fileURLToPath(new URL('../coach-agent/pose/pose_server.py', import.meta.url)));
  const model = toWslPath(fileURLToPath(new URL('../coach-agent/pose/models/pose_landmarker_lite.task', import.meta.url)));
  assert.equal(win.args.at(-1), `exec ~/.venvs/emory-pose/bin/python ${q(script)} ${q(model)}`);
  assert.equal(poseCommand({ POSE_WSL_DISTRO: 'Ubuntu' }, 'win32').args[1], 'Ubuntu');
  assert.equal(poseCommand({ POSE_RUNTIME: 'native' }, 'win32').runtime, 'native');
  assert.equal(poseCommand({}, 'linux').runtime, 'native');
});

test('startPose calls onExit when the helper dies on its own, but not after an intentional close()', async () => {
  // Fake pose_server.py protocol in plain node (no python/MediaPipe needed): print the ready line,
  // then either crash or sit idle until killed.
  const ready = "console.log(JSON.stringify({ready:true}));";

  let seenCode = null;
  await startPose({
    command: { cmd: process.execPath, args: ['-e', ready + "setTimeout(() => process.exit(3), 50);"] },
    log: () => {},
    onExit: (code) => { seenCode = code; },
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(seenCode, 3);

  let exitSeenAfterClose = false;
  const pose = await startPose({
    command: { cmd: process.execPath, args: ['-e', ready + "process.stdin.resume();"] },
    log: () => {},
    onExit: () => { exitSeenAfterClose = true; },
  });
  pose.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(exitSeenAfterClose, false);
});
