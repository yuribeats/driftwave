export interface ProcessingParams {
  rate: number;
  pitchFactor: number;   // pitch shift ratio (1.0 = no shift, 2.0 = octave up)
  pitchSpeedLinked: boolean;
  reverbWet: number;
  reverbDuration: number;
  reverbDecay: number;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  eqBumpFreq: number;
  eqBumpGain: number;
  satDrive: number;      // waveshaper curve aggressiveness 1–50
  satMix: number;        // dry/wet blend 0–1
  satTone: number;       // post-saturation lowpass cutoff 1000–20000 Hz
}

export interface SimpleParams {
  speed: number;    // -0.5 to +0.5 (0 = no change, negative = slow, positive = fast)
  pitch: number;    // semitones -12 to +12 (0 = no change)
  pitchSpeedLinked: boolean;  // when true, pitch and speed move together (varispeed)
  reverb: number;   // 0–1
  tone: number;     // -1 to 1 (dark to bright)
  // Optional detailed overrides (when set, bypass the auto-calculated values)
  reverbWetOverride?: number;       // 0–1
  reverbDurationOverride?: number;  // 0.5–8 seconds
  reverbDecayOverride?: number;     // 0.5–6
  eqLowOverride?: number;          // -20 to +20 dB
  eqMidOverride?: number;          // -20 to +20 dB
  eqHighOverride?: number;         // -20 to +20 dB
  eqBumpFreqOverride?: number;     // 100–10000 Hz
  eqBumpGainOverride?: number;     // 0–15 dB
  saturation?: number;             // 0–1 (0 = clean, 1 = heavy)
  satDriveOverride?: number;       // 1–50
  satMixOverride?: number;         // 0–1
  satToneOverride?: number;        // 1000–20000 Hz
}

export interface EQBand {
  type: BiquadFilterType;
  frequency: number;
  gain: number;
}

export const SIMPLE_DEFAULTS: SimpleParams = {
  speed: -0.15,    // slightly slowed (~0.85x)
  pitch: 0,        // no pitch shift
  pitchSpeedLinked: true,  // varispeed by default
  reverb: 0.5,
  tone: -0.3,
  saturation: 0,   // clean by default
};

export function expandParams(s: SimpleParams): ProcessingParams {
  // Speed: 0 = 1.0x, -0.5 = 0.5x, +0.5 = 1.5x
  const speedRate = 1.0 + s.speed;
  const pitchFactor = Math.pow(2, (s.pitch ?? 0) / 12);
  const linked = s.pitchSpeedLinked ?? true;

  // When linked: rate = speedRate (varispeed — pitch follows speed naturally)
  // When unlinked: rate = speedRate (speed only), pitchFactor applied separately via worklet
  const rate = linked ? speedRate : speedRate;

  // Tone: high shelf for air, gentle low shelf for bass cut/boost
  // Max ±5dB to keep EQ musical and avoid harsh phase artifacts at extremes
  const toneMag = Math.abs(s.tone);
  const toneSign = s.tone < 0 ? -1 : 1;
  const toneAmount = Math.pow(toneMag, 0.7) * 5 * toneSign;

  // Reverb: sqrt curve for audible presence at low settings
  const reverbCurve = Math.sqrt(s.reverb);

  // No resonant bump — just shelf EQ
  const bumpFreq = 1000;
  const bumpGain = 0;

  // Saturation: series tanh with normalized output — adds harmonic warmth and air
  // Drive range 1–9; at drive=1 the curve is nearly linear for typical signals
  const sat = s.saturation ?? 0;
  const satDrive = 1 + sat * 8;        // max 9x drive
  const satMix = 1.0;                  // always series — no dry/wet split
  const satTone = 20000 - sat * 6000;  // 20kHz → 14kHz (preserves more air)

  return {
    rate,
    pitchFactor,
    pitchSpeedLinked: linked,
    reverbWet: s.reverbWetOverride ?? reverbCurve * 0.65,
    reverbDuration: s.reverbDurationOverride ?? 0.5 + s.reverb * 1.5,
    reverbDecay: s.reverbDecayOverride ?? 3.0 + s.reverb * 4.0,
    eqLow: s.eqLowOverride ?? -toneAmount * 0.4,
    eqMid: s.eqMidOverride ?? 0,
    eqHigh: s.eqHighOverride ?? toneAmount,
    eqBumpFreq: s.eqBumpFreqOverride ?? bumpFreq,
    eqBumpGain: s.eqBumpGainOverride ?? bumpGain,
    satDrive: s.satDriveOverride ?? satDrive,
    satMix: s.satMixOverride ?? satMix,
    satTone: s.satToneOverride ?? satTone,
  };
}

export const DEFAULTS: ProcessingParams = expandParams(SIMPLE_DEFAULTS);
