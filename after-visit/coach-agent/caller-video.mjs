// The caller's camera as the coach receives it over FaceTime (Chert's bridge publishes it as
// "facetime-remote-video", 1280x720 at about 15 fps). Hands frames to the pose tracker, at most `fps` a second.
// Frames live only in memory; nothing is saved.
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';

/** Watch video from `identity` in `room`. Calls onFrame({ rgba, width, height, t }) at most `fps` times a second. */
export function watchCallerVideo(room, identity, { fps = 10, onFrame, log = console.log } = {}) {
  let stopped = false, reading = 0;

  async function read(track, name) {
    const stream = new VideoStream(track);
    const started = Date.now();
    let frames = 0, last = 0;
    reading++;
    log(`[video] caller video "${name}" arrived`);
    try {
      for await (const { frame } of stream) {
        if (stopped) break;
        frames++;
        const now = Date.now();
        if (now - last < 1000 / fps) continue;
        last = now;
        const rgba = frame.convert(VideoBufferType.RGBA);
        onFrame?.({ rgba: rgba.data, width: rgba.width, height: rgba.height, t: now - started });
      }
    } catch (error) {
      if (!stopped) log(`[video] caller video stopped: ${error?.message ?? error}`);
    } finally {
      reading--;
      log(`[video] caller video "${name}" ended after ${frames} frames`);
    }
  }

  const onTrack = (track, publication, participant) => {
    if (track.kind !== TrackKind.KIND_VIDEO || participant.identity !== identity) return;
    void read(track, publication.name || track.sid);
  };
  room.on(RoomEvent.TrackSubscribed, onTrack);
  // A track already subscribed before we started listening.
  for (const participant of room.remoteParticipants.values()) {
    if (participant.identity !== identity) continue;
    for (const publication of participant.trackPublications.values()) if (publication.track) onTrack(publication.track, publication, participant);
  }
  // FaceTime Audio calls, or a line without caller capture, send no video: say so once, plainly.
  const timer = setTimeout(() => { if (!reading) log('[video] no caller video after 10 s (FaceTime Audio, or camera off): reps cannot be counted'); }, 10_000);

  return () => { stopped = true; clearTimeout(timer); room.off(RoomEvent.TrackSubscribed, onTrack); };
}
