// Camera, pose model and video recording.
// MediaPipe is imported lazily inside loadPose(), so the camera opens and recording still works even
// if the CDN is unreachable or the model fails to load. There is currently no manual/tap-to-count
// fallback for rep counting in that case: session.js shows a "Motion tracking could not load" coach
// message once, for the whole session (loadPose() is only awaited once, in the Start click handler),
// and every exercise in that session records without rep detection/scoring until the patient ends the
// session and starts a new one.
const BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let posePromise = null;

/** Load the pose model once (about 6 MB). Falls back to CPU if the GPU path fails (some iPhones). */
export function loadPose() {
  posePromise ??= (async () => {
    const { PoseLandmarker, FilesetResolver } = await import(BUNDLE);
    const files = await FilesetResolver.forVisionTasks(WASM);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { return await PoseLandmarker.createFromOptions(files, opts('GPU')); }
    catch (e) { console.warn('GPU pose failed, using CPU', e); return PoseLandmarker.createFromOptions(files, opts('CPU')); }
  })();
  posePromise.catch(() => { posePromise = null; });
  return posePromise;
}

export async function openCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access. Use Safari or Chrome over https://.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  return stream;
}

export function stopStream(stream) { stream?.getTracks().forEach((t) => t.stop()); }

/** Records the raw camera stream. Safari gives mp4, Chrome gives webm. */
export class Recorder {
  constructor(stream) {
    this.mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
    this.rec = window.MediaRecorder ? new MediaRecorder(stream, { mimeType: this.mime || undefined, videoBitsPerSecond: 1_500_000 }) : null;
    this.chunks = [];
    if (this.rec) this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
  }
  get supported() { return !!this.rec; }
  start() { this.rec?.start(1000); }
  stop() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') return resolve(null);
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: (this.rec.mimeType || this.mime || 'video/webm').split(';')[0] }));
      this.rec.stop();
    });
  }
}

/** Runs the pose model on every new video frame and calls onResult(result, nowMs). */
export function startPoseLoop(video, landmarker, onResult) {
  let last = -1, lastTs = 0, running = true;
  const tick = () => {
    if (!running) return;
    if (video.readyState >= 2 && video.currentTime !== last) {
      last = video.currentTime;
      const ts = Math.max(lastTs + 1, performance.now());
      lastTs = ts;
      try { onResult(landmarker.detectForVideo(video, ts), ts); } catch (e) { console.warn(e); }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => { running = false; };
}

export { pack, unpack, drawPose } from './draw.js';
