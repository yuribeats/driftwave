export interface ProcessingParams {
  rate: number;
  reverbWet: number;
  reverbDuration: number;
  reverbDecay: number;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
}

export interface SimpleParams {
  rate: number;     // 0.5–1.0
  reverb: number;   // 0–1
  tone: number;     // -1 to 1 (dark to bright)
}

export interface EQBand {
  type: BiquadFilterType;
  frequency: number;
  gain: number;
}

export const SIMPLE_DEFAULTS: SimpleParams = {
  rate: 0.85,
  reverb: 0.5,
  tone: -0.3,  // slightly dark
};

export function expandParams(s: SimpleParams): ProcessingParams {
  return {
    rate: s.rate,
    reverbWet: s.reverb * 0.8,
    reverbDuration: 1.5 + s.reverb * 4.5,
    reverbDecay: 1.5 + s.reverb * 2.5,
    eqLow: -s.tone * 8,
    eqMid: 0,
    eqHigh: s.tone * 8,
  };
}

export const DEFAULTS: ProcessingParams = expandParams(SIMPLE_DEFAULTS);
