// Runs on the audio thread. Downsamples mic audio (usually 48 kHz on iPhone)
// to 16 kHz mono 16-bit PCM and posts ~100 ms chunks to the main thread.
class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;            // fractional read position into incoming audio
    this.chunk = new Int16Array(1600);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // simple averaging downsampler (good enough for speech)
    while (this.pos < ch.length) {
      const start = Math.floor(this.pos);
      const end = Math.min(ch.length, Math.floor(this.pos + this.ratio));
      let sum = 0, cnt = 0;
      for (let i = start; i < end; i++) { sum += ch[i]; cnt++; }
      const s = cnt ? sum / cnt : ch[start];
      const v = Math.max(-1, Math.min(1, s));
      this.chunk[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.chunk.length) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(1600);
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor("pcm-downsampler", PcmDownsampler);
