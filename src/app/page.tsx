"use client";

import { useState } from "react";
import SpectrumAnalyzer from "../../components/SpectrumAnalyzer";
import Transport from "../../components/Transport";
import ProgressBar from "../../components/ProgressBar";
import Playlist from "../../components/Playlist";
import Toast from "../../components/Toast";
import { useStore } from "../../lib/store";

function snapToSemitone(speed: number): number {
  const rate = 1.0 + speed;
  const semitones = 12 * Math.log2(rate);
  const snapped = Math.round(semitones);
  return Math.pow(2, snapped / 12) - 1.0;
}

export default function Home() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const isPlaying = useStore((s) => s.isPlaying);
  const sourceFilename = useStore((s) => s.sourceFilename);
  const params = useStore((s) => s.params);
  const setParam = useStore((s) => s.setParam);
  const [stepMode, setStepMode] = useState(false);

  const rate = 1.0 + params.speed;
  const semitones = 12 * Math.log2(rate);
  const reverbPct = Math.round(params.reverb * 100);
  const toneLabel = params.tone === 0 ? "FLAT" : params.tone < 0 ? "DARK" : "BRIGHT";

  const handleSpeed = (v: number) => {
    if (stepMode) {
      setParam("speed", snapToSemitone(v));
    } else {
      setParam("speed", v);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-[1000px] flex flex-col gap-5">
        <div className="console flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center gap-4 px-3">
            <div className="w-6 h-6 border-[3px] border-[var(--text-dark)] rounded-[4px] relative">
              <div className="absolute inset-[4px] bg-[var(--text-dark)]" />
            </div>
            <span className="text-xl font-bold tracking-[2px] uppercase" style={{ color: "var(--text-dark)" }}>
              SLOWED AND REVERBED MACHINE
            </span>
          </div>

          {/* Display panel */}
          <div className="display-bezel grid grid-cols-[200px_1fr] gap-5">
            {/* Status CRT */}
            <div className="crt flex flex-col" style={{ height: "180px" }}>
              <div className="px-2 py-1 flex justify-between text-[10px] border-b z-10" style={{ color: "var(--crt-bright)", borderColor: "var(--crt-grid)" }}>
                <span>{sourceFilename ? sourceFilename.toUpperCase() : "SYS STATUS"}</span>
                {isPlaying && <span>PLAYING</span>}
              </div>
              <div className="crt-grid flex-1 p-2 text-[12px] leading-[1.8] z-10" style={{ color: "var(--crt-bright)" }}>
                <div><span style={{ color: "var(--crt-dim)", display: "inline-block", width: "70px" }}>SPEED:</span> {rate.toFixed(2)}X</div>
                <div><span style={{ color: "var(--crt-dim)", display: "inline-block", width: "70px" }}>REVERB:</span> {reverbPct}%</div>
                <div><span style={{ color: "var(--crt-dim)", display: "inline-block", width: "70px" }}>TONE:</span> {toneLabel}</div>
              </div>
            </div>

            {/* Visualizer CRT */}
            <SpectrumAnalyzer />
          </div>

          {/* Control deck - 2 columns */}
          <div className="grid grid-cols-2 gap-5">
            {/* Transport */}
            <div className="zone-inset">
              <Transport />
              <div className="label" style={{ fontSize: "14px", color: "var(--text-dark)" }}>TRANSPORT</div>
            </div>

            {/* Effects */}
            <div className="zone-engraved relative">
              <div className="label" style={{ position: "absolute", top: "10px", width: "calc(100% - 40px)", fontSize: "14px" }}>EFFECTS</div>
              <div className="flex justify-around pt-6">
                {/* Speed slider */}
                <div className="flex flex-col items-center gap-2">
                  <div className="relative h-[140px] w-[40px] flex justify-center">
                    <div className="slider-track h-full" />
                    <input
                      type="range"
                      min="-0.5"
                      max="0.5"
                      step={stepMode ? 0.001 : 0.01}
                      value={params.speed}
                      onChange={(e) => handleSpeed(parseFloat(e.target.value))}
                      className="absolute w-[140px] h-[40px]"
                      style={{
                        transform: "rotate(-90deg)",
                        transformOrigin: "center",
                        top: "50px",
                        left: "-50px",
                        WebkitAppearance: "none",
                        appearance: "none",
                        background: "transparent",
                      }}
                    />
                  </div>
                  <div className="label">SPEED</div>
                  <span className="text-[10px]" style={{ color: "var(--text-dark)" }}>{rate.toFixed(2)}X / {semitones >= 0 ? "+" : ""}{semitones.toFixed(1)}ST</span>
                  <button
                    onClick={() => setStepMode(!stepMode)}
                    className={`text-[8px] uppercase tracking-[0.15em] px-2 py-0.5 border ${
                      stepMode
                        ? "border-[#333] bg-[rgba(255,115,0,0.15)]"
                        : "border-[#777]"
                    }`}
                    style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}
                  >
                    STEP
                  </button>
                </div>

                {/* Reverb slider */}
                <div className="flex flex-col items-center gap-2">
                  <div className="relative h-[140px] w-[40px] flex justify-center">
                    <div className="slider-track h-full" />
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={params.reverb}
                      onChange={(e) => setParam("reverb", parseFloat(e.target.value))}
                      className="absolute w-[140px] h-[40px]"
                      style={{
                        transform: "rotate(-90deg)",
                        transformOrigin: "center",
                        top: "50px",
                        left: "-50px",
                        WebkitAppearance: "none",
                        appearance: "none",
                        background: "transparent",
                      }}
                    />
                  </div>
                  <div className="label">REVERB</div>
                  <span className="text-[10px]" style={{ color: "var(--text-dark)" }}>{reverbPct}%</span>
                </div>

                {/* Tone slider */}
                <div className="flex flex-col items-center gap-2">
                  <div className="relative h-[140px] w-[40px] flex justify-center">
                    <div className="slider-track h-full" />
                    <input
                      type="range"
                      min="-1"
                      max="1"
                      step="0.01"
                      value={params.tone}
                      onChange={(e) => setParam("tone", parseFloat(e.target.value))}
                      className="absolute w-[140px] h-[40px]"
                      style={{
                        transform: "rotate(-90deg)",
                        transformOrigin: "center",
                        top: "50px",
                        left: "-50px",
                        WebkitAppearance: "none",
                        appearance: "none",
                        background: "transparent",
                      }}
                    />
                  </div>
                  <div className="label">TONE</div>
                  <span className="text-[10px]" style={{ color: "var(--text-dark)" }}>{toneLabel}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          {sourceBuffer && (
            <div className="zone-inset">
              <ProgressBar />
            </div>
          )}
        </div>

        <Playlist />
        <Toast />
      </div>
    </main>
  );
}
