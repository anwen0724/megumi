/*
 * AudioWorklet processor: aggregates every four 128-sample render quanta into
 * one 512-sample mono PCM frame and posts it with its ArrayBuffer transferred.
 * No VAD, STT, resampling, or utterance assembly happens here; the Renderer
 * Feature computes levels from the same frame before forwarding it.
 */
class VoiceInputFrameWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(512);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channel = input[0];
      const count = Math.min(channel.length, this.ring.length - this.filled);
      this.ring.set(channel.subarray(0, count), this.filled);
      this.filled += count;
      if (this.filled === this.ring.length) {
        const frame = new Float32Array(this.ring.length);
        frame.set(this.ring);
        this.port.postMessage({ samples: frame }, [frame.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('voice-input-frame-worklet', VoiceInputFrameWorklet);
