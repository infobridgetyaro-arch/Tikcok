class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "threshold",
        defaultValue: 0.02,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: "k-rate",
      },
    ];
  }

  constructor() {
    super();
    this._gain = 0;
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    const threshold = parameters.threshold[0];

    // Per 128-sample block at 44100 Hz ≈ 2.9 ms/block
    // 10 ms attack  → open  in ~3-4 blocks
    // 80 ms release → close in ~28 blocks
    const blockSec = 128 / 44100;
    const attackStep  = blockSec / 0.010;
    const releaseStep = blockSec / 0.080;

    // Detect peak level in this block
    let peak = 0;
    for (let i = 0; i < inp.length; i++) {
      const a = Math.abs(inp[i]);
      if (a > peak) peak = a;
    }

    if (peak > threshold) {
      this._gain = Math.min(1, this._gain + attackStep);
    } else {
      this._gain = Math.max(0, this._gain - releaseStep);
    }

    const g = this._gain;
    for (let i = 0; i < inp.length; i++) {
      out[i] = inp[i] * g;
    }
    return true;
  }
}

registerProcessor("noise-gate-processor", NoiseGateProcessor);
