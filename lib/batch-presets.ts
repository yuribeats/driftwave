import { SimpleParams } from "@yuribeats/audio-utils";

export type BatchStyle = "mashup" | "slowed" | "chipmunk";

// Preset values are intentionally blank — user will specify them in a follow-up session
export const BATCH_PRESETS: Record<BatchStyle, Partial<SimpleParams>> = {
  mashup:   {},
  slowed:   {},
  chipmunk: {},
};

export function artistKey(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? words[1] : words[0];
}
