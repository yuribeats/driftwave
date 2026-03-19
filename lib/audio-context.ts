let ctx: AudioContext | null = null;
let workletReady = false;

export function getAudioContext(): AudioContext {
  if (ctx && ctx.state === "closed") {
    ctx = null;
    workletReady = false;
  }
  if (!ctx) {
    ctx = new AudioContext();
    workletReady = false;
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

export async function ensurePitchWorklet(): Promise<void> {
  const c = getAudioContext();
  if (workletReady) return;
  try {
    await c.audioWorklet.addModule("/worklets/pitch-shifter-processor.js");
    workletReady = true;
  } catch {
    // Worklet not available — pitch shifting will be bypassed
  }
}

export function isPitchWorkletReady(): boolean {
  return workletReady;
}
