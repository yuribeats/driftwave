"use client";

import { useRef, useCallback } from "react";
import { useRemixStore } from "../../../lib/remix-store";
import { getAudioContext } from "../../../lib/audio-context";
import MiniSpectrum from "../../../components/MiniSpectrum";
import Toast from "../../../components/Toast";

type DeckId = "A" | "B";

const faderStyle: React.CSSProperties = {
  writingMode: "vertical-lr",
  direction: "rtl",
  WebkitAppearance: "none",
  appearance: "none",
  background: "transparent",
  width: "40px",
  top: 0,
  left: "50%",
  transform: "translateX(-50%)",
};

function Deck({ id }: { id: DeckId }) {
  const deck = useRemixStore((s) => (id === "A" ? s.deckA : s.deckB));
  const loadFile = useRemixStore((s) => s.loadFile);
  const play = useRemixStore((s) => s.play);
  const stop = useRemixStore((s) => s.stop);
  const setParam = useRemixStore((s) => s.setParam);
  const setVolume = useRemixStore((s) => s.setVolume);
  const eject = useRemixStore((s) => s.eject);
  const inputRef = useRef<HTMLInputElement>(null);

  const rate = 1.0 + deck.params.speed;
  const reverbPct = Math.round(deck.params.reverb * 100);
  const satPct = Math.round((deck.params.saturation ?? 0) * 100);
  const toneLabel = deck.params.tone === 0 ? "FLAT" : deck.params.tone < 0 ? "DARK" : "BRIGHT";

  const handleLoad = useCallback(() => {
    getAudioContext();
    if (deck.sourceBuffer) eject(id);
    inputRef.current?.click();
  }, [deck.sourceBuffer, eject, id]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const ctx = getAudioContext();
      await ctx.resume();
      const file = e.target.files?.[0];
      if (file) loadFile(id, file);
      if (inputRef.current) inputRef.current.value = "";
    },
    [loadFile, id]
  );

  const handlePlay = useCallback(async () => {
    const ctx = getAudioContext();
    await ctx.resume();
    if (deck.isPlaying) {
      stop(id);
    } else {
      play(id);
    }
  }, [deck.isPlaying, play, stop, id]);

  return (
    <div className="flex flex-col gap-3">
      <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileSelect} />

      {/* Deck header */}
      <div className="flex items-center justify-between">
        <span
          className="text-sm tracking-[2px] uppercase"
          style={{ color: "var(--text-dark)", fontFamily: "var(--font-display)" }}
        >
          DECK {id}
        </span>
        <div className="flex items-center gap-2">
          <div className="led-cutout">
            <div className={`led-rect ${deck.isPlaying ? "led-green-on" : deck.sourceBuffer ? "led-green-on" : "led-green"}`} />
          </div>
        </div>
      </div>

      {/* CRT status + spectrum */}
      <div className="display-bezel flex flex-col gap-2 p-3">
        <div
          className="text-[10px] truncate crt-text"
          style={{ color: "var(--crt-bright)", fontFamily: "var(--font-crt)", fontSize: "13px" }}
        >
          {deck.sourceFilename ? deck.sourceFilename.toUpperCase() : "NO TRACK"}
          {deck.isPlaying && " — PLAYING"}
        </div>
        <MiniSpectrum analyser={deck.nodes?.analyser ?? null} isPlaying={deck.isPlaying} />
      </div>

      {/* Transport buttons */}
      <div className="flex items-center gap-3 justify-center">
        <div className="flex flex-col items-center">
          <span className="label" style={{ margin: 0, fontSize: "9px", marginBottom: "4px" }}>LOAD</span>
          <button onClick={handleLoad} disabled={deck.isLoading} className="rocker-switch" style={{ width: "48px", height: "48px" }}>
            <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="label" style={{ margin: 0, fontSize: "9px", marginBottom: "4px" }}>{deck.isPlaying ? "STOP" : "PLAY"}</span>
          <button onClick={handlePlay} disabled={!deck.sourceBuffer} className="rocker-switch" style={{ width: "48px", height: "48px" }}>
            <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
          </button>
        </div>
      </div>

      {/* Effect faders */}
      <div className="zone-engraved">
        <div className="grid grid-cols-4 gap-2" style={{ justifyItems: "center" }}>
          {/* Speed */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="-0.5" max="0.5" step="0.01"
                value={deck.params.speed}
                onChange={(e) => setParam(id, "speed", parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>SPEED</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{rate.toFixed(2)}X</span>
          </div>

          {/* Reverb */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="0" max="1" step="0.01"
                value={deck.params.reverb}
                onChange={(e) => setParam(id, "reverb", parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>REVERB</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{reverbPct}%</span>
          </div>

          {/* Tone */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="-1" max="1" step="0.01"
                value={deck.params.tone}
                onChange={(e) => setParam(id, "tone", parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>TONE</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{toneLabel}</span>
          </div>

          {/* Saturate */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="0" max="1" step="0.01"
                value={deck.params.saturation ?? 0}
                onChange={(e) => setParam(id, "saturation", parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>SAT</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{satPct}%</span>
          </div>
        </div>
      </div>

      {/* Volume fader */}
      <div className="zone-inset flex items-center gap-3 justify-center py-3">
        <div className="label" style={{ margin: 0, fontSize: "9px", writingMode: "vertical-rl", transform: "rotate(180deg)" }}>VOL</div>
        <div className="relative h-[120px] w-[40px] flex justify-center">
          <div className="slider-track h-full" />
          <input
            type="range" min="0" max="1" step="0.01"
            value={deck.volume}
            onChange={(e) => setVolume(id, parseFloat(e.target.value))}
            className="absolute h-full"
            style={faderStyle}
          />
        </div>
        <span className="text-[10px]" style={{ color: "var(--text-dark)" }}>{Math.round(deck.volume * 100)}%</span>
      </div>
    </div>
  );
}

export default function RemixPage() {
  const crossfader = useRemixStore((s) => s.crossfader);
  const setCrossfader = useRemixStore((s) => s.setCrossfader);

  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-[1100px] flex flex-col gap-5">
        <div className="console flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center gap-4 px-3 boot-stagger boot-delay-1">
            <div className="w-6 h-6 border-[3px] border-[var(--text-dark)] rounded-[4px] relative">
              <div className="absolute inset-[4px] bg-[var(--text-dark)]" />
            </div>
            <span
              className="text-lg sm:text-xl tracking-[2px] uppercase"
              style={{ color: "var(--text-dark)", fontFamily: "var(--font-display)" }}
            >
              REMIX
            </span>
            <a
              href="/"
              className="ml-auto text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 border border-[#777]"
              style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}
            >
              MAIN
            </a>
          </div>

          {/* Two decks side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 boot-stagger boot-delay-2">
            <div className="zone-inset">
              <Deck id="A" />
            </div>
            <div className="zone-inset">
              <Deck id="B" />
            </div>
          </div>

          {/* Crossfader */}
          <div className="zone-inset boot-stagger boot-delay-3">
            <div className="flex items-center gap-4">
              <span className="label" style={{ margin: 0, fontSize: "10px", minWidth: "20px" }}>A</span>
              <div className="flex-1 relative h-[40px] flex items-center">
                <div
                  className="absolute inset-y-[14px] left-0 right-0"
                  style={{
                    background: "linear-gradient(to right, #0a0a0a, #1a1a1a 30%, #1a1a1a 70%, #0a0a0a)",
                    borderRadius: "5px",
                    boxShadow: "inset 2px 2px 6px rgba(0,0,0,0.9), inset -1px -1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.3), 0 0 0 2px rgba(255,255,255,0.05)",
                  }}
                />
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={crossfader}
                  onChange={(e) => setCrossfader(parseFloat(e.target.value))}
                  className="w-full relative z-10"
                  style={{ WebkitAppearance: "none", appearance: "none", background: "transparent", height: "40px" }}
                />
              </div>
              <span className="label" style={{ margin: 0, fontSize: "10px", minWidth: "20px" }}>B</span>
            </div>
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>CROSSFADER</div>
          </div>
        </div>

        <Toast />
      </div>
    </main>
  );
}
