// Diagnostics (COACH_DIAGNOSTICS=1): how loud the caller's FaceTime audio is when it reaches the coach (Chert
// publishes it as "facetime-remote-audio"). Logs the level every 2 seconds. Use it when the coach doesn't react to
// the caller: "silent" means the line delivered no sound at all. It measures loudness only; no audio is kept or saved.
import { AudioStream, RoomEvent, TrackKind } from '@livekit/rtc-node';

/** Loudness of 16-bit samples in dBFS (0 = maximum, about -60 or lower = near silence). */
export function dbfs(samples) {
  if (!samples?.length) return -Infinity;
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / samples.length) / 32768;
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

export function watchCallerAudio(room, identity, { log = console.log } = {}) {
  let stopped = false;
  const onTrack = async (track, publication, participant) => {
    if (track.kind !== TrackKind.KIND_AUDIO || participant.identity !== identity) return;
    log(`[audio] caller audio track "${publication.name || track.sid}" arrived`);
    const stream = new AudioStream(track, 16000, 1);
    let peak = -Infinity, sum = 0, n = 0, frames = 0, last = Date.now();
    try {
      for await (const frame of stream) {
        if (stopped) break;
        frames++;
        const level = dbfs(frame.data);
        if (Number.isFinite(level)) { peak = Math.max(peak, level); sum += level; n++; }
        if (Date.now() - last >= 2000) {
          const avg = n ? sum / n : -Infinity;
          log(`[audio] caller level: average ${Number.isFinite(avg) ? avg.toFixed(0) : 'silent'} dBFS, peak ${Number.isFinite(peak) ? peak.toFixed(0) : 'silent'} dBFS (${frames} frames)`);
          peak = -Infinity; sum = 0; n = 0; frames = 0; last = Date.now();
        }
      }
    } catch (error) {
      if (!stopped) log(`[audio] caller audio stopped: ${error?.message ?? error}`);
    }
  };
  room.on(RoomEvent.TrackSubscribed, onTrack);
  for (const participant of room.remoteParticipants.values()) {
    if (participant.identity !== identity) continue;
    for (const publication of participant.trackPublications.values()) if (publication.track) void onTrack(publication.track, publication, participant);
  }
  const timer = setTimeout(() => {
    const p = room.remoteParticipants.get(identity);
    const tracks = p ? [...p.trackPublications.values()].map((t) => `${t.name || t.sid} (${t.kind === TrackKind.KIND_AUDIO ? 'audio' : 'video'}, ${t.subscribed ? 'subscribed' : 'not subscribed'}${t.muted ? ', muted' : ''})`) : [];
    log(`[audio] caller publishes after 10 s: ${tracks.join(', ') || 'nothing'}`);
  }, 10_000);
  return () => { stopped = true; clearTimeout(timer); room.off(RoomEvent.TrackSubscribed, onTrack); };
}
