"use client";

import { useRef, useCallback, useState } from "react";
import { expandParams } from "@yuribeats/audio-utils";
import { useRemixStore } from "../../../lib/remix-store";
import { getAudioContext } from "../../../lib/audio-context";
import WaveformDisplay from "../../../components/WaveformDisplay";
import PianoKeyboard from "../../../components/PianoKeyboard";
import Toast from "../../../components/Toast";

type DeckId = "A" | "B";

function snapToSemitone(speed: number): number {
  const rate = 1.0 + speed;
  const semitones = 12 * Math.log2(rate);
  const snapped = Math.round(semitones);
  return Math.pow(2, snapped / 12) - 1.0;
}

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

const detailBtnClass = (active: boolean) =>
  `text-[8px] uppercase tracking-[0.15em] px-2 py-0.5 border ${
    active ? "border-[#333] bg-[rgba(255,115,0,0.15)]" : "border-[#777]"
  }`;

const detailBtnStyle: React.CSSProperties = { fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent" };

function Deck({ id }: { id: DeckId }) {
  const deck = useRemixStore((s) => (id === "A" ? s.deckA : s.deckB));
  const loadFile = useRemixStore((s) => s.loadFile);
  const play = useRemixStore((s) => s.play);
  const stop = useRemixStore((s) => s.stop);
  const pause = useRemixStore((s) => s.pause);
  const setParam = useRemixStore((s) => s.setParam);
  const setVolume = useRemixStore((s) => s.setVolume);
  const eject = useRemixStore((s) => s.eject);
  const setStem = useRemixStore((s) => s.setStem);
  const setRegion = useRemixStore((s) => s.setRegion);
  const seek = useRemixStore((s) => s.seek);
  const scrub = useRemixStore((s) => s.scrub);
  const calculateBPMFromLoop = useRemixStore((s) => s.calculateBPMFromLoop);
  const addLoopToBank = useRemixStore((s) => s.addLoopToBank);
  const removeFromBank = useRemixStore((s) => s.removeFromBank);
  const inputRef = useRef<HTMLInputElement>(null);

  const [stepMode, setStepMode] = useState(true);
  const [reverbDetail, setReverbDetail] = useState(false);
  const [toneDetail, setToneDetail] = useState(false);
  const [satDetail, setSatDetail] = useState(false);
  const [nudgeStep, setNudgeStep] = useState(0.001); // seconds per nudge press

  const rate = 1.0 + deck.params.speed;
  const pitchSemitones = deck.params.pitch ?? 0;
  const linked = deck.params.pitchSpeedLinked ?? true;
  const speedSemitones = 12 * Math.log2(rate);
  const displaySemitones = linked ? speedSemitones : pitchSemitones;
  const reverbPct = Math.round(deck.params.reverb * 100);
  const satPct = Math.round((deck.params.saturation ?? 0) * 100);
  const toneLabel = deck.params.tone === 0 ? "FLAT" : deck.params.tone < 0 ? "DARK" : "BRIGHT";
  const expanded = expandParams(deck.params);
  const adjustedBPM = deck.calculatedBPM ? (deck.calculatedBPM * rate) : null;

  const [bpmInput, setBpmInput] = useState("");
  const [editingBPM, setEditingBPM] = useState(false);

  const handleSpeed = (v: number) => {
    if (linked) {
      // Varispeed: speed and pitch move together
      if (stepMode) {
        const snapped = snapToSemitone(v);
        setParam(id, "speed", snapped);
        setParam(id, "pitch", 12 * Math.log2(1.0 + snapped));
      } else {
        setParam(id, "speed", v);
        setParam(id, "pitch", 12 * Math.log2(1.0 + v));
      }
    } else {
      setParam(id, "speed", v);
    }
  };

  const handlePitch = (v: number) => {
    if (stepMode) v = Math.round(v);
    if (linked) {
      // Varispeed: pitch drives speed
      const newRate = Math.pow(2, v / 12);
      setParam(id, "pitch", v);
      setParam(id, "speed", newRate - 1.0);
    } else {
      setParam(id, "pitch", v);
    }
  };

  const toggleLink = () => {
    setParam(id, "pitchSpeedLinked", linked ? 0 : 1);
  };

  const handleBPMSubmit = () => {
    const newBPM = parseFloat(bpmInput);
    if (!deck.calculatedBPM || isNaN(newBPM) || newBPM <= 0) {
      setEditingBPM(false);
      return;
    }
    const newRate = newBPM / deck.calculatedBPM;
    const newSpeed = newRate - 1.0;
    // Clamp to speed fader range
    const clamped = Math.max(-0.5, Math.min(0.5, newSpeed));
    setParam(id, "speed", clamped);
    if (linked) {
      setParam(id, "pitch", 12 * Math.log2(1.0 + clamped));
    }
    setEditingBPM(false);
  };

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

  const handleStart = useCallback(async () => {
    const ctx = getAudioContext();
    await ctx.resume();
    play(id);
  }, [play, id]);

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

      {/* CRT status */}
      <div className="display-bezel flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between">
          <div
            className="text-[10px] truncate crt-text"
            style={{ color: "var(--crt-bright)", fontFamily: "var(--font-crt)", fontSize: "13px" }}
          >
            {deck.sourceFilename ? deck.sourceFilename.toUpperCase() : "NO TRACK"}
            {deck.isPlaying && " — PLAYING"}
          </div>
        </div>
        {deck.sourceBuffer && (
          <div className="flex gap-3 text-[10px] items-center" style={{ color: "var(--crt-dim)", fontFamily: "var(--font-crt)", fontSize: "12px" }}>
            {editingBPM ? (
              <span style={{ color: "var(--crt-bright)" }}>
                BPM:{" "}
                <input
                  type="text"
                  autoFocus
                  value={bpmInput}
                  onChange={(e) => setBpmInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleBPMSubmit(); if (e.key === "Escape") setEditingBPM(false); }}
                  onBlur={handleBPMSubmit}
                  className="bg-transparent border-b border-[var(--crt-bright)] outline-none text-[12px] w-[50px]"
                  style={{ color: "var(--crt-bright)", fontFamily: "var(--font-crt)" }}
                />
              </span>
            ) : (
              <span
                style={{ color: "var(--crt-bright)" }}
                onClick={() => { if (adjustedBPM) { setBpmInput(adjustedBPM.toFixed(3)); setEditingBPM(true); } }}
              >
                BPM: {adjustedBPM !== null ? adjustedBPM.toFixed(3) : "—"}
              </span>
            )}
            <span style={{ color: "var(--crt-bright)" }}>PITCH: {displaySemitones >= 0 ? "+" : ""}{displaySemitones.toFixed(1)}ST</span>
          </div>
        )}
      </div>

      {/* Waveform */}
      <WaveformDisplay
        audioBuffer={deck.sourceBuffer}
        isPlaying={deck.isPlaying}
        pauseOffset={deck.pauseOffset}
        startedAt={deck.startedAt}
        playbackRate={rate}
        regionStart={deck.regionStart}
        regionEnd={deck.regionEnd}
        onRegionChange={(s, e) => setRegion(id, s, e)}
        onSeek={(pos) => seek(id, pos)}
        onScrub={(pos) => scrub(id, pos)}
      />

      {/* Loop IN/OUT nudge controls */}
      {deck.sourceBuffer && (deck.regionStart > 0 || deck.regionEnd > 0) && (() => {
        const dur = deck.sourceBuffer!.duration;
        const inVal = deck.regionStart;
        const outVal = deck.regionEnd > 0 ? deck.regionEnd : dur;
        const nudgeIn = (dir: number) => {
          const v = Math.max(0, Math.min(outVal - 0.001, inVal + dir * nudgeStep));
          setRegion(id, v, deck.regionEnd);
        };
        const nudgeOut = (dir: number) => {
          const v = Math.max(inVal + 0.001, Math.min(dur, outVal + dir * nudgeStep));
          setRegion(id, deck.regionStart, v);
        };
        const btnStyle: React.CSSProperties = {
          fontFamily: "var(--font-tech)", color: "var(--accent-gold)", background: "transparent",
          fontSize: "12px", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px solid #444",
        };
        return (
          <div className="zone-engraved">
            <div className="flex items-center gap-4 justify-center">
              {/* IN */}
              <div className="flex flex-col items-center gap-1">
                <div className="label" style={{ fontSize: "8px", margin: 0 }}>IN</div>
                <div className="flex items-center gap-1">
                  <button onClick={() => nudgeIn(-1)} style={btnStyle}>&lt;</button>
                  <span className="text-[8px] w-[70px] text-center" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
                    {inVal.toFixed(4)}S
                  </span>
                  <button onClick={() => nudgeIn(1)} style={btnStyle}>&gt;</button>
                </div>
              </div>

              {/* Step size */}
              <div className="flex flex-col items-center gap-0.5">
                <div className="label" style={{ fontSize: "7px", margin: 0 }}>STEP</div>
                <input
                  type="range" min={-4} max={0} step={0.1}
                  value={Math.log10(nudgeStep)}
                  onChange={(e) => setNudgeStep(Math.pow(10, parseFloat(e.target.value)))}
                  className="w-[50px]"
                  style={{ WebkitAppearance: "none", appearance: "none", background: "transparent", height: "16px" }}
                />
                <span className="text-[6px]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
                  {nudgeStep >= 0.1 ? nudgeStep.toFixed(1) + "S" : nudgeStep >= 0.001 ? (nudgeStep * 1000).toFixed(1) + "MS" : (nudgeStep * 1000000).toFixed(0) + "US"}
                </span>
              </div>

              {/* OUT */}
              <div className="flex flex-col items-center gap-1">
                <div className="label" style={{ fontSize: "8px", margin: 0 }}>OUT</div>
                <div className="flex items-center gap-1">
                  <button onClick={() => nudgeOut(-1)} style={btnStyle}>&lt;</button>
                  <span className="text-[8px] w-[70px] text-center" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
                    {outVal.toFixed(4)}S
                  </span>
                  <button onClick={() => nudgeOut(1)} style={btnStyle}>&gt;</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Stem isolation */}
      {deck.sourceBuffer && (
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-2 justify-center">
            <span className="label" style={{ margin: 0, fontSize: "8px" }}>
              {deck.isStemLoading ? "SEPARATING..." : "ISOLATE:"}
            </span>
            {(["vocals", "drums", "bass", "other"] as const).map((stem) => (
              <button
                key={stem}
                onClick={() => setStem(id, stem)}
                disabled={deck.isStemLoading}
                className={detailBtnClass(deck.activeStem === stem && !deck.isStemLoading)}
                style={{
                  ...detailBtnStyle,
                  opacity: deck.isStemLoading ? 0.5 : 1,
                }}
              >
                {deck.isStemLoading && deck.activeStem === stem
                  ? "..."
                  : stem.toUpperCase()}
              </button>
            ))}
            {deck.stemBuffers && !deck.isStemLoading && (
              <span className="text-[7px]" style={{ color: "var(--crt-dim)", fontFamily: "var(--font-tech)" }}>READY</span>
            )}
          </div>
          {deck.stemError && (
            <span className="text-[8px]" style={{ color: "var(--led-red-on)", fontFamily: "var(--font-tech)" }}>
              {deck.stemError.toUpperCase()}
            </span>
          )}
        </div>
      )}

      {/* BPM from loop + Key finder + Loop bank */}
      {deck.sourceBuffer && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4 justify-center">
            <button
              onClick={() => calculateBPMFromLoop(id)}
              disabled={deck.regionStart === 0 && deck.regionEnd === 0}
              className={detailBtnClass(false)}
              style={{ ...detailBtnStyle, opacity: (deck.regionStart === 0 && deck.regionEnd === 0) ? 0.4 : 1 }}
            >
              CALC BPM FROM LOOP
            </button>
            <button
              onClick={() => addLoopToBank(id)}
              disabled={deck.regionStart === 0 && deck.regionEnd === 0}
              className={detailBtnClass(false)}
              style={{ ...detailBtnStyle, opacity: (deck.regionStart === 0 && deck.regionEnd === 0) ? 0.4 : 1 }}
            >
              ADD TO BANK
            </button>
            <PianoKeyboard />
          </div>
          {deck.loopBank.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center">
              {deck.loopBank.map((loop, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 px-1.5 py-0.5 border border-[#333]"
                  style={{ background: "rgba(200,169,110,0.08)" }}
                >
                  <span className="text-[7px] uppercase" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
                    {loop.name} ({(loop.end - loop.start).toFixed(1)}S)
                  </span>
                  <button
                    onClick={() => {
                      setRegion(id, loop.start, loop.end);
                    }}
                    className="text-[7px]"
                    style={{ color: "var(--accent-gold)", fontFamily: "var(--font-tech)" }}
                  >
                    LOAD
                  </button>
                  <button
                    onClick={() => removeFromBank(id, i)}
                    className="text-[7px]"
                    style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transport buttons */}
      <div className="flex items-center gap-2 justify-center">
        <div className="flex flex-col items-center">
          <span className="label" style={{ margin: 0, fontSize: "9px", marginBottom: "4px" }}>LOAD</span>
          <button onClick={handleLoad} disabled={deck.isLoading} className="rocker-switch" style={{ width: "44px", height: "44px" }}>
            <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="label" style={{ margin: 0, fontSize: "9px", marginBottom: "4px" }}>START</span>
          <button onClick={handleStart} disabled={!deck.sourceBuffer || deck.isPlaying} className="rocker-switch" style={{ width: "44px", height: "44px" }}>
            <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="label" style={{ margin: 0, fontSize: "9px", marginBottom: "4px" }}>STOP</span>
          <button onClick={() => stop(id)} disabled={!deck.sourceBuffer} className="rocker-switch" style={{ width: "44px", height: "44px" }}>
            <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="label" style={{ margin: 0, fontSize: "9px", marginBottom: "4px" }}>PAUSE</span>
          <button onClick={() => pause(id)} disabled={!deck.sourceBuffer || !deck.isPlaying} className="rocker-switch" style={{ width: "44px", height: "44px" }}>
            <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
          </button>
        </div>
      </div>

      {/* Speed / Pitch / Volume */}
      <div className="zone-engraved">
        <div className="grid grid-cols-3 gap-2" style={{ justifyItems: "center" }}>
          {/* Speed */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="-0.5" max="0.5" step={stepMode && linked ? 0.001 : 0.01}
                value={deck.params.speed}
                onChange={(e) => handleSpeed(parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>SPEED</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{rate.toFixed(2)}X</span>
            <button onClick={toggleLink} className={detailBtnClass(linked)} style={detailBtnStyle}>LINK</button>
          </div>

          {/* Pitch */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="-12" max="12" step={stepMode ? 1 : 0.1}
                value={linked ? speedSemitones : pitchSemitones}
                onChange={(e) => handlePitch(parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>PITCH</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{displaySemitones >= 0 ? "+" : ""}{displaySemitones.toFixed(1)}ST</span>
            <button onClick={() => setStepMode(!stepMode)} className={detailBtnClass(stepMode)} style={detailBtnStyle}>STEP</button>
          </div>

          {/* Volume */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="0" max="1" step="0.01"
                value={deck.volume}
                onChange={(e) => setVolume(id, parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>VOL</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{Math.round(deck.volume * 100)}%</span>
          </div>
        </div>
      </div>

      {/* Reverb / Tone / Saturation */}
      <div className="zone-engraved">
        <div className="grid grid-cols-3 gap-2" style={{ justifyItems: "center" }}>
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
            <button onClick={() => setReverbDetail(!reverbDetail)} className={detailBtnClass(reverbDetail)} style={detailBtnStyle}>DETAIL</button>
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
            <button onClick={() => setToneDetail(!toneDetail)} className={detailBtnClass(toneDetail)} style={detailBtnStyle}>DETAIL</button>
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
            <button onClick={() => setSatDetail(!satDetail)} className={detailBtnClass(satDetail)} style={detailBtnStyle}>DETAIL</button>
          </div>
        </div>
      </div>

      {/* Reverb Detail */}
      {reverbDetail && (
        <div className="zone-engraved">
          <div className="label" style={{ fontSize: "9px", marginBottom: "8px", marginTop: 0 }}>REVERB DETAIL</div>
          <div className="grid grid-cols-3 gap-3" style={{ justifyItems: "center" }}>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="0" max="1" step="0.01"
                  value={deck.params.reverbWetOverride ?? expanded.reverbWet}
                  onChange={(e) => setParam(id, "reverbWetOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>WET/DRY</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{Math.round((deck.params.reverbWetOverride ?? expanded.reverbWet) * 100)}%</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="0.5" max="8" step="0.1"
                  value={deck.params.reverbDurationOverride ?? expanded.reverbDuration}
                  onChange={(e) => setParam(id, "reverbDurationOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>SIZE</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{(deck.params.reverbDurationOverride ?? expanded.reverbDuration).toFixed(1)}S</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="0.5" max="6" step="0.1"
                  value={deck.params.reverbDecayOverride ?? expanded.reverbDecay}
                  onChange={(e) => setParam(id, "reverbDecayOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>DECAY</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{(deck.params.reverbDecayOverride ?? expanded.reverbDecay).toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Tone Detail — Parametric EQ */}
      {toneDetail && (
        <div className="zone-engraved">
          <div className="label" style={{ fontSize: "9px", marginBottom: "8px", marginTop: 0 }}>PARAMETRIC EQ</div>
          <div className="grid grid-cols-5 gap-2" style={{ justifyItems: "center" }}>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="-20" max="20" step="0.5"
                  value={deck.params.eqLowOverride ?? expanded.eqLow}
                  onChange={(e) => setParam(id, "eqLowOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>LOW</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{(deck.params.eqLowOverride ?? expanded.eqLow).toFixed(1)}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="-20" max="20" step="0.5"
                  value={deck.params.eqMidOverride ?? expanded.eqMid}
                  onChange={(e) => setParam(id, "eqMidOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>MID</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{(deck.params.eqMidOverride ?? expanded.eqMid).toFixed(1)}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="-20" max="20" step="0.5"
                  value={deck.params.eqHighOverride ?? expanded.eqHigh}
                  onChange={(e) => setParam(id, "eqHighOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>HIGH</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{(deck.params.eqHighOverride ?? expanded.eqHigh).toFixed(1)}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="100" max="10000" step="50"
                  value={deck.params.eqBumpFreqOverride ?? expanded.eqBumpFreq}
                  onChange={(e) => setParam(id, "eqBumpFreqOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>FREQ</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{Math.round(deck.params.eqBumpFreqOverride ?? expanded.eqBumpFreq)}HZ</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="0" max="15" step="0.5"
                  value={deck.params.eqBumpGainOverride ?? expanded.eqBumpGain}
                  onChange={(e) => setParam(id, "eqBumpGainOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>PEAK</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{(deck.params.eqBumpGainOverride ?? expanded.eqBumpGain).toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Saturation Detail */}
      {satDetail && (
        <div className="zone-engraved">
          <div className="label" style={{ fontSize: "9px", marginBottom: "8px", marginTop: 0 }}>SATURATION DETAIL</div>
          <div className="grid grid-cols-3 gap-3" style={{ justifyItems: "center" }}>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="1" max="50" step="0.5"
                  value={deck.params.satDriveOverride ?? expanded.satDrive}
                  onChange={(e) => setParam(id, "satDriveOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>DRIVE</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{(deck.params.satDriveOverride ?? expanded.satDrive).toFixed(1)}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="0" max="1" step="0.01"
                  value={deck.params.satMixOverride ?? expanded.satMix}
                  onChange={(e) => setParam(id, "satMixOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>MIX</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{Math.round((deck.params.satMixOverride ?? expanded.satMix) * 100)}%</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="1000" max="20000" step="100"
                  value={deck.params.satToneOverride ?? expanded.satTone}
                  onChange={(e) => setParam(id, "satToneOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>TONE</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{Math.round((deck.params.satToneOverride ?? expanded.satTone) / 1000)}KHZ</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function MasterBus() {
  const masterBus = useRemixStore((s) => s.masterBus);
  const setMasterBus = useRemixStore((s) => s.setMasterBus);
  const [showCompDetail, setShowCompDetail] = useState(false);
  const [showLimDetail, setShowLimDetail] = useState(false);

  const compPct = Math.round(masterBus.compAmount * 100);
  const limPct = Math.round(masterBus.limiterAmount * 100);

  // Compute displayed compressor values
  const amt = masterBus.compAmount;
  const threshold = masterBus.compThreshold ?? (amt * -40);
  const ratio = masterBus.compRatio ?? (1 + amt * 11);
  const attack = masterBus.compAttack ?? 0.01;
  const release = masterBus.compRelease ?? 0.15;
  const knee = masterBus.compKnee ?? 10;
  const makeup = masterBus.compMakeup ?? (amt * 12);

  // Compute displayed limiter values
  const limAmt = masterBus.limiterAmount;
  const limThreshold = masterBus.limiterThreshold ?? (-1 - limAmt * 12);
  const limRelease = masterBus.limiterRelease ?? (0.01 + limAmt * 0.1);
  const limKnee = masterBus.limiterKnee ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span
          className="text-sm tracking-[2px] uppercase"
          style={{ color: "var(--text-dark)", fontFamily: "var(--font-display)" }}
        >
          OUTPUT
        </span>
      </div>

      {/* EQ + Comp + Limiter faders */}
      <div className="zone-engraved">
        <div className="grid grid-cols-5 gap-2" style={{ justifyItems: "center" }}>
          {/* Low */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="-20" max="20" step="0.5"
                value={masterBus.eqLow}
                onChange={(e) => setMasterBus("eqLow", parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>LOW</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{masterBus.eqLow > 0 ? "+" : ""}{masterBus.eqLow.toFixed(1)}</span>
          </div>

          {/* Mid */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="-20" max="20" step="0.5"
                value={masterBus.eqMid}
                onChange={(e) => setMasterBus("eqMid", parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>MID</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{masterBus.eqMid > 0 ? "+" : ""}{masterBus.eqMid.toFixed(1)}</span>
          </div>

          {/* High */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="-20" max="20" step="0.5"
                value={masterBus.eqHigh}
                onChange={(e) => setMasterBus("eqHigh", parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>HIGH</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{masterBus.eqHigh > 0 ? "+" : ""}{masterBus.eqHigh.toFixed(1)}</span>
          </div>

          {/* Comp */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="0" max="1" step="0.01"
                value={masterBus.compAmount}
                onChange={(e) => setMasterBus("compAmount", parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>COMP</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{compPct}%</span>
            <button onClick={() => setShowCompDetail(!showCompDetail)} className={detailBtnClass(showCompDetail)} style={detailBtnStyle}>DETAIL</button>
          </div>

          {/* Limiter */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="0" max="1" step="0.01"
                value={masterBus.limiterAmount}
                onChange={(e) => setMasterBus("limiterAmount", parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "9px", marginTop: "4px" }}>LIMIT</div>
            <span className="text-[9px]" style={{ color: "var(--text-dark)" }}>{limPct}%</span>
            <button onClick={() => setShowLimDetail(!showLimDetail)} className={detailBtnClass(showLimDetail)} style={detailBtnStyle}>DETAIL</button>
          </div>
        </div>
      </div>

      {/* Comp detail panel */}
      {showCompDetail && (
        <div className="zone-engraved">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2" style={{ justifyItems: "center" }}>
            {/* Threshold */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input
                  type="range" min="-60" max="0" step="1"
                  value={threshold}
                  onChange={(e) => setMasterBus("compThreshold", parseFloat(e.target.value))}
                  className="absolute h-full"
                  style={{ ...faderStyle, width: "36px" }}
                />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>THRESH</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{threshold.toFixed(0)}dB</span>
            </div>

            {/* Ratio */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input
                  type="range" min="1" max="20" step="0.5"
                  value={ratio}
                  onChange={(e) => setMasterBus("compRatio", parseFloat(e.target.value))}
                  className="absolute h-full"
                  style={{ ...faderStyle, width: "36px" }}
                />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>RATIO</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{ratio.toFixed(1)}:1</span>
            </div>

            {/* Attack */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input
                  type="range" min="0.001" max="0.5" step="0.001"
                  value={attack}
                  onChange={(e) => setMasterBus("compAttack", parseFloat(e.target.value))}
                  className="absolute h-full"
                  style={{ ...faderStyle, width: "36px" }}
                />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>ATK</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{(attack * 1000).toFixed(0)}ms</span>
            </div>

            {/* Release */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input
                  type="range" min="0.01" max="1" step="0.01"
                  value={release}
                  onChange={(e) => setMasterBus("compRelease", parseFloat(e.target.value))}
                  className="absolute h-full"
                  style={{ ...faderStyle, width: "36px" }}
                />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>REL</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{(release * 1000).toFixed(0)}ms</span>
            </div>

            {/* Knee */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input
                  type="range" min="0" max="40" step="1"
                  value={knee}
                  onChange={(e) => setMasterBus("compKnee", parseFloat(e.target.value))}
                  className="absolute h-full"
                  style={{ ...faderStyle, width: "36px" }}
                />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>KNEE</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{knee.toFixed(0)}dB</span>
            </div>

            {/* Makeup */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input
                  type="range" min="0" max="24" step="0.5"
                  value={makeup}
                  onChange={(e) => setMasterBus("compMakeup", parseFloat(e.target.value))}
                  className="absolute h-full"
                  style={{ ...faderStyle, width: "36px" }}
                />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>GAIN</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>+{makeup.toFixed(1)}dB</span>
            </div>
          </div>
        </div>
      )}

      {/* Limiter detail panel */}
      {showLimDetail && (
        <div className="zone-engraved">
          <div className="label" style={{ fontSize: "9px", marginBottom: "8px", marginTop: 0 }}>LIMITER DETAIL</div>
          <div className="grid grid-cols-3 gap-3" style={{ justifyItems: "center" }}>
            {/* Threshold */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input
                  type="range" min="-20" max="0" step="0.5"
                  value={limThreshold}
                  onChange={(e) => setMasterBus("limiterThreshold", parseFloat(e.target.value))}
                  className="absolute h-full"
                  style={{ ...faderStyle, width: "36px" }}
                />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>CEILING</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{limThreshold.toFixed(1)}dB</span>
            </div>

            {/* Release */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input
                  type="range" min="0.001" max="0.3" step="0.001"
                  value={limRelease}
                  onChange={(e) => setMasterBus("limiterRelease", parseFloat(e.target.value))}
                  className="absolute h-full"
                  style={{ ...faderStyle, width: "36px" }}
                />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>REL</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{(limRelease * 1000).toFixed(0)}ms</span>
            </div>

            {/* Knee */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input
                  type="range" min="0" max="6" step="0.5"
                  value={limKnee}
                  onChange={(e) => setMasterBus("limiterKnee", parseFloat(e.target.value))}
                  className="absolute h-full"
                  style={{ ...faderStyle, width: "36px" }}
                />
              </div>
              <div className="label" style={{ fontSize: "8px", marginTop: "4px" }}>KNEE</div>
              <span className="text-[8px]" style={{ color: "var(--text-dark)" }}>{limKnee.toFixed(1)}dB</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Sequencer() {
  const deckA = useRemixStore((s) => s.deckA);
  const deckB = useRemixStore((s) => s.deckB);
  const tracksA = useRemixStore((s) => s.sequencerTracksA);
  const tracksB = useRemixStore((s) => s.sequencerTracksB);
  const playing = useRemixStore((s) => s.sequencerPlaying);
  const addSlot = useRemixStore((s) => s.addSequencerSlot);
  const removeSlot = useRemixStore((s) => s.removeSequencerSlot);
  const moveSlot = useRemixStore((s) => s.moveSequencerSlot);
  const clearTrack = useRemixStore((s) => s.clearSequencerTrack);
  const playSeq = useRemixStore((s) => s.playSequencer);
  const stopSeq = useRemixStore((s) => s.stopSequencer);

  const arrowBtn: React.CSSProperties = {
    fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent",
    fontSize: "9px", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
    border: "1px solid #444", padding: 0, lineHeight: 1,
  };

  const renderTrack = (id: "A" | "B", bank: typeof deckA.loopBank, slots: number[]) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-col items-center gap-0.5" style={{ minWidth: "40px" }}>
          <span className="text-[9px] uppercase tracking-[0.15em]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
            DECK {id}
          </span>
          {slots.length > 0 && (
            <button
              onClick={() => clearTrack(id)}
              className="text-[6px] uppercase"
              style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)", opacity: 0.5 }}
            >
              CLEAR
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center gap-1 overflow-x-auto py-1">
          {slots.map((bankIdx, slotIdx) => {
            const loop = bank[bankIdx];
            if (!loop) return null;
            const dur = loop.end - loop.start;
            return (
              <div
                key={slotIdx}
                className="flex flex-col items-center shrink-0 border border-[#333]"
                style={{ background: "rgba(200,169,110,0.1)", minWidth: "60px" }}
              >
                <div className="flex items-center justify-between w-full px-1.5 py-1">
                  <span className="text-[8px] uppercase" style={{ color: "var(--accent-gold)", fontFamily: "var(--font-tech)" }}>
                    {loop.name}
                  </span>
                  <button
                    onClick={() => removeSlot(id, slotIdx)}
                    className="text-[7px]"
                    style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}
                  >
                    X
                  </button>
                </div>
                <span className="text-[6px]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)", opacity: 0.5 }}>
                  {dur.toFixed(2)}S
                </span>
                <div className="flex items-center gap-1 py-0.5">
                  <button
                    onClick={() => moveSlot(id, slotIdx, slotIdx - 1)}
                    disabled={slotIdx === 0}
                    style={{ ...arrowBtn, opacity: slotIdx === 0 ? 0.2 : 1 }}
                  >
                    &lt;
                  </button>
                  <button
                    onClick={() => moveSlot(id, slotIdx, slotIdx + 1)}
                    disabled={slotIdx === slots.length - 1}
                    style={{ ...arrowBtn, opacity: slotIdx === slots.length - 1 ? 0.2 : 1 }}
                  >
                    &gt;
                  </button>
                </div>
              </div>
            );
          })}
          {slots.length === 0 && (
            <span className="text-[7px]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)", opacity: 0.4 }}>EMPTY — ADD LOOPS BELOW</span>
          )}
        </div>
      </div>
      {bank.length > 0 && (
        <div className="flex items-center gap-1 pl-[48px] flex-wrap">
          <span className="text-[7px]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)", opacity: 0.5 }}>ADD:</span>
          {bank.map((loop, i) => (
            <button
              key={i}
              onClick={() => addSlot(id, i)}
              className="text-[7px] px-1.5 py-0.5 border border-[#444]"
              style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)", background: "transparent" }}
            >
              {loop.name} ({(loop.end - loop.start).toFixed(1)}S)
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const hasAnyLoops = deckA.loopBank.length > 0 || deckB.loopBank.length > 0;
  const hasSlots = tracksA.length > 0 || tracksB.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span
          className="text-sm tracking-[2px] uppercase"
          style={{ color: "var(--text-dark)", fontFamily: "var(--font-display)" }}
        >
          SEQUENCER
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={playing ? stopSeq : playSeq}
            disabled={!hasSlots}
            className={detailBtnClass(playing)}
            style={{ ...detailBtnStyle, opacity: !hasSlots ? 0.4 : 1 }}
          >
            {playing ? "STOP" : "PLAY"}
          </button>
        </div>
      </div>
      {hasAnyLoops ? (
        <>
          {deckA.loopBank.length > 0 && renderTrack("A", deckA.loopBank, tracksA)}
          {deckB.loopBank.length > 0 && renderTrack("B", deckB.loopBank, tracksB)}
        </>
      ) : (
        <span className="text-[8px] text-center" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)", opacity: 0.4 }}>
          BANK LOOPS FROM EACH DECK TO BUILD SEQUENCES
        </span>
      )}
    </div>
  );
}

function Manual({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)" }}>
      <div className="console w-full max-w-[700px] max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm tracking-[2px] uppercase" style={{ color: "var(--text-dark)", fontFamily: "var(--font-display)" }}>MANUAL</span>
          <button onClick={onClose} className={detailBtnClass(false)} style={detailBtnStyle}>CLOSE</button>
        </div>
        <div className="flex flex-col gap-3 text-[10px] leading-[1.6]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--accent-gold)" }}>DECKS</div>
            <div>LOAD A TRACK INTO EACH DECK USING THE LOAD BUTTON. EACH DECK HAS INDEPENDENT CONTROLS FOR SPEED, PITCH, VOLUME, REVERB, TONE, AND SATURATION.</div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--accent-gold)" }}>SPEED + PITCH</div>
            <div>LINKED (DEFAULT): SPEED AND PITCH MOVE TOGETHER LIKE A TURNTABLE. VARISPEED.</div>
            <div>UNLINKED: SPEED CHANGES TEMPO WITHOUT AFFECTING PITCH. PITCH SHIFTS WITHOUT AFFECTING TEMPO.</div>
            <div>STEP: SNAPS PITCH TO SEMITONE INTERVALS.</div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--accent-gold)" }}>BPM</div>
            <div>SELECT A 4-BAR LOOP REGION ON THE WAVEFORM, THEN HIT CALC BPM FROM LOOP. FORMULA: 240 / LOOP LENGTH IN SECONDS.</div>
            <div>CLICK THE BPM VALUE IN THE DISPLAY TO TYPE A NEW BPM. SPEED (AND PITCH IF LINKED) ADJUSTS AUTOMATICALLY.</div>
            <div>BPM UPDATES IN REAL TIME AS YOU ADJUST SPEED.</div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--accent-gold)" }}>LOOP FINE-TUNE</div>
            <div>WHEN A REGION IS SELECTED, IN/OUT ROTARY KNOBS APPEAR. DRAG UP TO NUDGE FORWARD, DOWN TO NUDGE BACK. 0.1MS RESOLUTION OVER A +/-0.5S WINDOW.</div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--accent-gold)" }}>PIANO KEYBOARD</div>
            <div>ONE OCTAVE SINE WAVE GENERATOR FOR FINDING THE KEY BY EAR. OVERLAY A NOTE ON YOUR SAMPLE. OCTAVE UP/DOWN BUTTONS. LATCH HOLDS A NOTE UNTIL YOU PRESS ANOTHER OR THE SAME KEY AGAIN.</div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--accent-gold)" }}>LOOP BANK + SEQUENCER</div>
            <div>SELECT A REGION AND HIT ADD TO BANK TO SAVE IT. BANKED LOOPS APPEAR BELOW WITH LOAD (RECALL) AND X (DELETE).</div>
            <div>HIT SEQ IN THE HEADER TO OPEN THE SEQUENCER. TWO TRACKS (DECK A, DECK B). ADD BANKED LOOPS TO BUILD A SEQUENCE. HIT PLAY TO PLAY THROUGH.</div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--accent-gold)" }}>SYNC + LOCK</div>
            <div>SYNC START: STARTS BOTH DECKS SIMULTANEOUSLY WITH SAMPLE-ACCURATE TIMING.</div>
            <div>LOCK BPM: DECK A IS THE ALPHA. ADJUSTS DECK B&apos;S SPEED TO MATCH DECK A&apos;S CURRENT BPM. WHILE LOCKED, SPEED AND PITCH CHANGES ON DECK A AUTOMATICALLY PROPAGATE TO DECK B. CLICK AGAIN TO UNLOCK.</div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--accent-gold)" }}>CROSSFADER</div>
            <div>CENTER = BOTH DECKS FULL VOLUME. LEFT = DECK A ONLY. RIGHT = DECK B ONLY.</div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--accent-gold)" }}>STEM ISOLATION</div>
            <div>CLICK VOCALS, DRUMS, BASS, OR OTHER TO ISOLATE A STEM USING ML SEPARATION (DEMUCS). FIRST USE TAKES 30-60 SECONDS. CLICK AGAIN TO TOGGLE OFF.</div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--accent-gold)" }}>OUTPUT BUS</div>
            <div>MASTER EQ (LOW/MID/HIGH), COMPRESSOR, AND LIMITER ON THE FINAL MIX. EACH HAS A DETAIL PANEL FOR FINE CONTROL.</div>
            <div>COMP: SINGLE KNOB MAPS TO THRESHOLD + RATIO + MAKEUP. DETAIL OVERRIDES INDIVIDUAL PARAMS.</div>
            <div>LIMIT: BRICK-WALL LIMITER AFTER THE COMPRESSOR. DETAIL CONTROLS CEILING, RELEASE, AND KNEE.</div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--accent-gold)" }}>EFFECT DETAILS</div>
            <div>REVERB DETAIL: WET/DRY, SIZE (DURATION), DECAY.</div>
            <div>TONE DETAIL: 5-BAND PARAMETRIC EQ (LOW, MID, HIGH, FREQ SWEEP, PEAK GAIN).</div>
            <div>SAT DETAIL: DRIVE, MIX, TONE (POST-SATURATION FILTER).</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RemixPage() {
  const crossfader = useRemixStore((s) => s.crossfader);
  const setCrossfader = useRemixStore((s) => s.setCrossfader);
  const syncPlay = useRemixStore((s) => s.syncPlay);
  const deckA = useRemixStore((s) => s.deckA);
  const deckB = useRemixStore((s) => s.deckB);
  const lockBPM = useRemixStore((s) => s.lockBPM);
  const bpmLocked = useRemixStore((s) => s.bpmLocked);
  const download = useRemixStore((s) => s.download);
  const isExporting = useRemixStore((s) => s.isExporting);
  const recordArmed = useRemixStore((s) => s.recordArmed);
  const isRecording = useRemixStore((s) => s.isRecording);
  const armRecord = useRemixStore((s) => s.armRecord);
  const [manualOpen, setManualOpen] = useState(false);
  const [seqOpen, setSeqOpen] = useState(false);

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
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setSeqOpen(!seqOpen)}
                className={detailBtnClass(seqOpen)}
                style={detailBtnStyle}
              >
                SEQ
              </button>
              <button
                onClick={() => download()}
                disabled={isExporting || (!deckA.sourceBuffer && !deckB.sourceBuffer)}
                className={detailBtnClass(isExporting)}
                style={{ ...detailBtnStyle, opacity: (!deckA.sourceBuffer && !deckB.sourceBuffer) ? 0.4 : 1 }}
              >
                {isExporting ? "WAIT" : "EXPORT"}
              </button>
              <button
                onClick={() => setManualOpen(true)}
                className={detailBtnClass(false)}
                style={detailBtnStyle}
              >
                MANUAL
              </button>
            </div>
          </div>

          {/* Sequencer — above decks when open */}
          {seqOpen && (
            <div className="zone-inset boot-stagger boot-delay-1">
              <Sequencer />
            </div>
          )}

          {/* Two decks side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 boot-stagger boot-delay-2">
            <div className="zone-inset">
              <Deck id="A" />
            </div>
            <div className="zone-inset">
              <Deck id="B" />
            </div>
          </div>

          {/* Sync start + Lock BPM + Record */}
          <div className="flex justify-center gap-6 boot-stagger boot-delay-3">
            <div className="flex flex-col items-center">
              <span className="label" style={{ margin: 0, fontSize: "9px", marginBottom: "4px" }}>REC</span>
              <button
                onClick={() => armRecord()}
                disabled={isRecording}
                className="rocker-switch"
                style={{
                  width: "60px", height: "44px",
                  boxShadow: recordArmed ? "inset 0 0 8px rgba(200,40,40,0.4)" : isRecording ? "inset 0 0 12px rgba(200,40,40,0.6)" : undefined,
                }}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    background: isRecording ? "var(--led-red-on, #c82828)" : recordArmed ? "var(--led-red-on, #c82828)" : "#555",
                    animation: isRecording ? "pulse 1s infinite" : undefined,
                  }}
                />
              </button>
              <span className="text-[7px] mt-0.5" style={{
                fontFamily: "var(--font-tech)",
                color: isRecording ? "var(--led-red-on, #c82828)" : recordArmed ? "var(--led-red-on, #c82828)" : "var(--text-dark)",
                opacity: isRecording || recordArmed ? 1 : 0.4,
              }}>
                {isRecording ? "RECORDING" : recordArmed ? "ARMED" : "OFF"}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <span className="label" style={{ margin: 0, fontSize: "9px", marginBottom: "4px" }}>SYNC START</span>
              <button
                onClick={async () => { const ctx = getAudioContext(); await ctx.resume(); syncPlay(); }}
                disabled={!deckA.sourceBuffer && !deckB.sourceBuffer}
                className="rocker-switch"
                style={{ width: "60px", height: "44px" }}
              >
                <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
              </button>
            </div>
            <div className="flex flex-col items-center">
              <span className="label" style={{ margin: 0, fontSize: "9px", marginBottom: "4px" }}>LOCK BPM</span>
              <button
                onClick={() => lockBPM()}
                disabled={!bpmLocked && (!deckA.calculatedBPM || !deckB.calculatedBPM)}
                className="rocker-switch"
                style={{
                  width: "60px", height: "44px",
                  opacity: (!bpmLocked && (!deckA.calculatedBPM || !deckB.calculatedBPM)) ? 0.4 : 1,
                  boxShadow: bpmLocked ? "inset 0 0 8px rgba(200,169,110,0.3)" : undefined,
                }}
              >
                <div className={`w-1.5 h-1.5 rounded-full border-2 ${bpmLocked ? "border-[var(--accent-gold)]" : "border-[#555]"}`} />
              </button>
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

          {/* Master output bus */}
          <div className="zone-inset boot-stagger boot-delay-4">
            <MasterBus />
          </div>
        </div>

        <Toast />
      </div>
      {manualOpen && <Manual onClose={() => setManualOpen(false)} />}
    </main>
  );
}
