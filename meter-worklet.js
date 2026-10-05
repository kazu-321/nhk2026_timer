class OnsetMeter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.threshold = options.processorOptions?.threshold ?? 0.035;
    this.minGapFrames = Math.round(sampleRate * 0.4);
    this.lastHit = -Infinity;
    this.quietFrames = 0;
    this.armed = true;
    this.armAtFrame = null;
    this.port.onmessage = event => {
      if (event.data.threshold != null) this.threshold = event.data.threshold;
      if (event.data.minGapFrames != null) this.minGapFrames = event.data.minGapFrames;
      if (event.data.reset) this.lastHit = -Infinity;
      if (event.data.armAtFrame != null) this.armAtFrame = event.data.armAtFrame;
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const frames = channels[0].length;
    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < channels.length; c++) peak = Math.max(peak, Math.abs(channels[c][i]));
      const frame = currentFrame + i;
      if (this.armAtFrame != null && frame < this.armAtFrame) continue;
      if (this.armAtFrame != null && frame >= this.armAtFrame) {
        this.armAtFrame = null; this.armed = true; this.lastHit = -Infinity; this.quietFrames = 0;
      }
      if (peak < this.threshold) {
        this.quietFrames++;
        if (!this.armed && this.quietFrames >= Math.round(sampleRate * 0.08)) this.armed = true;
      } else {
        this.quietFrames = 0;
      }
      if (this.armed && peak >= this.threshold && frame - this.lastHit >= this.minGapFrames) {
        this.lastHit = frame;
        this.armed = false;
        this.port.postMessage({ type: 'onset', frame, peak });
      }
    }
    return true;
  }
}
registerProcessor('onset-meter', OnsetMeter);
