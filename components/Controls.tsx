"use client";

import SpeedPitchSlider from "./SpeedPitchSlider";
import ReverbControls from "./ReverbControls";
import EQControls from "./EQControls";
import { useStore } from "../lib/store";

export default function Controls() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);

  if (!sourceBuffer) return null;

  return (
    <div className="border border-dw-border p-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <SpeedPitchSlider />
        <ReverbControls />
        <EQControls />
      </div>
    </div>
  );
}
