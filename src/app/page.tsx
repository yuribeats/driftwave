"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import { expandParams } from "@yuribeats/audio-utils";
import { useRemixStore, getMasterAnalyser } from "../../lib/remix-store";
import type { MasterBusParams } from "../../lib/remix-store";
import { getAudioContext } from "../../lib/audio-context";
import WaveformDisplay from "../../components/WaveformDisplay";
import PianoKeyboard from "../../components/PianoKeyboard";
import Toast from "../../components/Toast";
import ExportVideoModalRemix from "../../components/ExportVideoModalRemix";


type DeckId = "A" | "B";

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

function semitoneToKey(baseKeyIndex: number, semitones: number, mode?: "major" | "minor" | null): string {
  const idx = ((baseKeyIndex + Math.round(semitones)) % 12 + 12) % 12;
  return NOTE_NAMES[idx] + (mode === "minor" ? "m" : "");
}

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
  `text-[12px] uppercase tracking-[0.15em] px-2 py-0.5 border ${
    active ? "border-[#333] bg-[rgba(255,115,0,0.15)]" : "border-[#777]"
  }`;

const detailBtnStyle: React.CSSProperties = { fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent" };

function Deck({ id, onHide }: { id: DeckId; onHide?: () => void }) {
  const deck = useRemixStore((s) => (id === "A" ? s.deckA : s.deckB));
  const loadFile = useRemixStore((s) => s.loadFile);
  const loadFromYouTube = useRemixStore((s) => s.loadFromYouTube);
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
  const inputRef = useRef<HTMLInputElement>(null);

  const [stepMode, setStepMode] = useState(true);
  const [reverbDetail, setReverbDetail] = useState(false);
  const [toneDetail, setToneDetail] = useState(false);
  const [satDetail, setSatDetail] = useState(false);
  const [nudgeStep, setNudgeStep] = useState(0.01);
  const waveformWrapRef = useRef<HTMLDivElement>(null);
  const [deckMenuOpen, setDeckMenuOpen] = useState(false);
  const [showYouTube, setShowYouTube] = useState(false);
  const [showKeyFinder, setShowKeyFinder] = useState(false);

  const rate = 1.0 + deck.params.speed;
  const pitchSemitones = deck.params.pitch ?? 0;
  const linked = deck.params.pitchSpeedLinked ?? true;
  const speedSemitones = 12 * Math.log2(rate);
  const displaySemitones = pitchSemitones;
  const reverbPct = Math.round(deck.params.reverb * 100);
  const satPct = Math.round((deck.params.saturation ?? 0) * 100);
  const toneLabel = deck.params.tone === 0 ? "FLAT" : deck.params.tone < 0 ? "DARK" : "BRIGHT";
  const expanded = expandParams(deck.params);
  const [ytUrl, setYtUrl] = useState("");
  const [loopEnabled, setLoopEnabled] = useState(false);
  const baseKey = deck.baseKey;
  const baseMode = deck.baseMode;
  const [editingKey, setEditingKey] = useState(false);
  const [userBPM, setUserBPM] = useState<string>("");
  const [editingBPM, setEditingBPM] = useState(false);
  const [editingSpeed, setEditingSpeed] = useState(false);
  const [speedInput, setSpeedInput] = useState("");
  const setBPM = useRemixStore((s) => s.setBPM);
  const setDeckMeta = useRemixStore((s) => s.setDeckMeta);
  const toggleGridlock = useRemixStore((s) => s.toggleGridlock);
  const toggleGridSubdivide = useRemixStore((s) => s.toggleGridSubdivide);
  const setGridOffset = useRemixStore((s) => s.setGridOffset);
  const lockGridSectionDur = useRemixStore((s) => s.lockGridSectionDur);
  const detectDownbeat = useRemixStore((s) => s.detectDownbeat);
  const loadDeck = useRemixStore((s) => s.loadDeck);
  const lookupEverysong = useRemixStore((s) => s.lookupEverysong);
  const recordArmed = useRemixStore((s) => s.recordArmed);

  const [deckArtist, setDeckArtist] = useState("");
  const [deckTitle, setDeckTitle] = useState("");
  const [deckLoading, setDeckLoading] = useState(false);
  const [deckLoadError, setDeckLoadError] = useState("");

  const handleDeckLoad = useCallback(async () => {
    if (!deckArtist && !deckTitle) return;
    setDeckLoading(true);
    setDeckLoadError("");
    try {
      await loadDeck(id, deckArtist, deckTitle);
    } catch (e) {
      setDeckLoadError(e instanceof Error ? e.message : "LOAD FAILED");
      setTimeout(() => setDeckLoadError(""), 4000);
    }
    setDeckLoading(false);
  }, [loadDeck, id, deckArtist, deckTitle]);

  // Clear key and BPM when source changes
  const sourceId = deck.sourceBuffer ? deck.sourceFilename : null;
  useEffect(() => {
    setDeckMeta(id, { baseKey: null, artist: "", title: "" });
    setUserBPM("");
    setEditingKey(false);
    setEditingBPM(false);
  }, [sourceId, id, setDeckMeta]);

  // Sync artist/title inputs from store (populated by autoLoad / lookupEverysong)
  useEffect(() => {
    if (deck.artist) setDeckArtist(deck.artist);
    if (deck.title) setDeckTitle(deck.title);
  }, [deck.artist, deck.title]);

  // Lock grid section duration when BPM is set while GRIDLOCK is enabled
  useEffect(() => {
    if (deck.gridlockEnabled && deck.calculatedBPM && deck.gridLockedSectionDur <= 0) {
      lockGridSectionDur(id);
    }
  }, [deck.gridlockEnabled, deck.calculatedBPM, deck.gridLockedSectionDur, lockGridSectionDur, id]);

  const handleSpeed = (v: number) => {
    if (linked) {
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
      if (file) {
        await loadFile(id, file);
        const stemTarget = id === "A" ? "instrumental" : "vocals";
        setStem(id, stemTarget);
      }
      if (inputRef.current) inputRef.current.value = "";
    },
    [loadFile, setStem, id]
  );

  const handleStart = useCallback(async () => {
    const ctx = getAudioContext();
    await ctx.resume();
    play(id, loopEnabled || undefined);
  }, [play, id, loopEnabled]);

  const handleSkip = useCallback(async (delta: number) => {
    if (!deck.sourceBuffer) return;
    const ctx = getAudioContext();
    const rStart = deck.regionStart;
    const rEnd = deck.regionEnd > 0 ? deck.regionEnd : deck.sourceBuffer.duration;
    const currentPos = deck.isPlaying
      ? rStart + (ctx.currentTime - deck.startedAt) * (1.0 + deck.params.speed)
      : deck.pauseOffset;
    const newPos = Math.max(rStart, Math.min(rEnd, currentPos + delta));
    await seek(id, newPos);
  }, [deck, seek, id]);

  return (
    <div className="flex flex-col gap-3">
      <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileSelect} />

      {/* Deck header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0">
          <span
            className="text-sm tracking-[2px] uppercase"
            style={{ color: "var(--text-dark)", fontFamily: "var(--font-display)" }}
          >
            {id === "A" ? "INSTRUMENTAL" : "ACAPELLA"}
          </span>
          <span
            className="text-[8px] tracking-[1px] uppercase"
            style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)", opacity: 0.55 }}
          >
            {id === "A" ? "AUTOMATICALLY REMOVES VOCALS" : "AUTOMATICALLY ISOLATES VOCALS"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-0.5">
            <button onClick={handleLoad} disabled={deck.isLoading} className="rocker-switch" style={{ width: "28px", height: "28px" }}>
              <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
            </button>
            <span className="text-[8px] tracking-[1px]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>LOCAL</span>
          </div>
          {onHide && (
            <button
              onClick={onHide}
              className={detailBtnClass(false)}
              style={detailBtnStyle}
            >
              (HIDE)
            </button>
          )}
          <div className="led-cutout">
            <div className={`led-rect ${deck.isPlaying ? "led-green-on" : deck.sourceBuffer ? "led-green-on" : "led-green"}`} />
          </div>
        </div>
      </div>

      {/* Per-deck artist + title + load */}
      <div className="flex gap-2">
        <div className="flex-1 flex flex-col gap-0.5">
          <span className="text-[10px] tracking-[1px]" style={{ fontFamily: "var(--font-tech)", color: "#000" }}>ARTIST</span>
          <input
            type="text"
            value={deckArtist}
            onChange={(e) => setDeckArtist(e.target.value)}
            onBlur={() => { if (deckArtist || deckTitle) lookupEverysong(id, deckArtist, deckTitle); }}
            onKeyDown={(e) => e.key === "Enter" && handleDeckLoad()}
            className="w-full bg-transparent border border-[#555] px-3 py-1.5 text-[11px] tracking-[1px] outline-none focus:border-[#888]"
            style={{ fontFamily: "var(--font-tech)", color: "#000" }}
          />
        </div>
        <div className="flex-1 flex flex-col gap-0.5">
          <span className="text-[10px] tracking-[1px]" style={{ fontFamily: "var(--font-tech)", color: "#000" }}>TITLE</span>
          <input
            type="text"
            value={deckTitle}
            onChange={(e) => setDeckTitle(e.target.value)}
            onBlur={() => { if (deckArtist || deckTitle) lookupEverysong(id, deckArtist, deckTitle); }}
            onKeyDown={(e) => e.key === "Enter" && handleDeckLoad()}
            className="w-full bg-transparent border border-[#555] px-3 py-1.5 text-[11px] tracking-[1px] outline-none focus:border-[#888]"
            style={{ fontFamily: "var(--font-tech)", color: "#000" }}
          />
        </div>
        <div className="flex flex-col justify-end">
          <button
            onClick={handleDeckLoad}
            disabled={deckLoading || (!deckArtist && !deckTitle)}
            className={detailBtnClass(false)}
            style={{ ...detailBtnStyle, opacity: (!deckArtist && !deckTitle) ? 0.3 : 1, color: deckLoadError ? "var(--led-red-on)" : "var(--accent-gold)" }}
          >
            {deckLoading ? "..." : deckLoadError || "LOAD"}
          </button>
        </div>
      </div>

      {/* CRT status */}
      <div className="display-bezel flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between">
          <div
            className="text-[12px] truncate crt-text"
            style={{ color: "var(--crt-bright)", fontFamily: "var(--font-crt)", fontSize: "12px" }}
          >
            {deck.isStemLoading
              ? deck.activeStem === "instrumental" ? "REMOVING VOCALS..." : "ISOLATING VOCALS..."
              : deck.downbeatDetecting
              ? "DETECTING DOWNBEAT..."
              : deck.isLoading
              ? "LOADING..."
              : deck.sourceFilename
              ? deck.sourceFilename.toUpperCase()
              : "NO TRACK"}
            {!deck.isLoading && !deck.isStemLoading && !deck.downbeatDetecting && deck.isPlaying && " — PLAYING"}
          </div>
        </div>
        {deck.sourceBuffer && (
          <div className="flex gap-4 text-[12px] items-center" style={{ color: "var(--crt-dim)", fontFamily: "var(--font-crt)", fontSize: "12px" }}>
            {editingKey ? (
              <span style={{ color: "var(--crt-bright)" }}>
                KEY:{" "}
                <span className="inline-flex gap-0.5">
                  {NOTE_NAMES.map((note, i) => (
                    <button
                      key={note}
                      onClick={() => { setDeckMeta(id, { baseKey: i }); setEditingKey(false); }}
                      className="px-1"
                      style={{
                        fontFamily: "var(--font-crt)", fontSize: "12px",
                        color: baseKey === i ? "var(--accent-gold)" : "var(--crt-bright)",
                        background: "transparent", border: "none",
                      }}
                    >
                      {note}
                    </button>
                  ))}
                </span>
              </span>
            ) : (
              <span
                style={{ color: baseKey !== null ? "var(--crt-bright)" : "var(--crt-dim)" }}
                onClick={() => setEditingKey(true)}
              >
                {baseKey !== null
                  ? `KEY: ${semitoneToKey(baseKey, displaySemitones, baseMode)}`
                  : "SET KEY"
                }
              </span>
            )}
            {editingBPM ? (
              <span style={{ color: "var(--crt-bright)" }}>
                BPM:{" "}
                <input
                  type="text"
                  autoFocus
                  value={userBPM}
                  onChange={(e) => setUserBPM(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = parseFloat(userBPM);
                      if (!isNaN(val) && val > 0) setBPM(id, val);
                      setEditingBPM(false);
                    }
                    if (e.key === "Escape") setEditingBPM(false);
                  }}
                  onBlur={() => {
                    const val = parseFloat(userBPM);
                    if (!isNaN(val) && val > 0) setBPM(id, val);
                    setEditingBPM(false);
                  }}
                  className="bg-transparent border-b border-[var(--crt-bright)] outline-none text-[12px] w-[50px]"
                  style={{ color: "var(--crt-bright)", fontFamily: "var(--font-crt)" }}
                />
              </span>
            ) : (
              <span
                style={{ color: userBPM ? "var(--crt-bright)" : "var(--crt-dim)" }}
                onClick={() => setEditingBPM(true)}
              >
                {deck.calculatedBPM
                  ? `BPM: ${(deck.calculatedBPM * rate).toFixed(3)}`
                  : "SET BPM"
                }
              </span>
            )}
            <span style={{ color: "var(--crt-dim)" }}>
              PITCH: {displaySemitones >= 0 ? "+" : ""}{displaySemitones.toFixed(1)}ST
            </span>
            {deck.firstDownbeatMs !== null && (
              <span
                style={{ color: "var(--crt-bright)" }}
                title="ML-detected first downbeat (madmom DBN)"
              >
                DB: {(deck.firstDownbeatMs / 1000).toFixed(3)}S
              </span>
            )}
            {deck.downbeatDetecting && (
              <span className="animate-pulse" style={{ color: "var(--accent-gold)" }}>
                DB...
              </span>
            )}
            {deck.downbeatError && !deck.downbeatDetecting && (
              <span style={{ color: "#e05050", fontSize: "9px" }} title={deck.downbeatError}>
                DB ERR
              </span>
            )}
          </div>
        )}
      </div>

      {/* Waveform */}
      <div ref={waveformWrapRef} style={{ display: "flex", flexDirection: "column" }}>
        <div>
          <WaveformDisplay
            audioBuffer={deck.activeStem && deck.stemBuffers?.[deck.activeStem] ? deck.stemBuffers[deck.activeStem]! : deck.sourceBuffer}
            isPlaying={deck.isPlaying}
            pauseOffset={deck.pauseOffset}
            startedAt={deck.startedAt}
            playbackRate={rate}
            regionStart={deck.regionStart}
            regionEnd={deck.regionEnd}
            onRegionChange={(s, e) => setRegion(id, s, e)}
            onSeek={(pos) => seek(id, pos)}
            onScrub={(pos) => scrub(id, pos)}
            gridEnabled={deck.gridlockEnabled && deck.gridLockedSectionDur > 0}
            gridSectionDur={deck.gridLockedSectionDur > 0 ? deck.gridLockedSectionDur / (deck.gridSubdivide ? 4 : 1) : undefined}
            gridAnchor={deck.gridlockEnabled ? deck.gridFirstTransient + deck.gridOffsetMs / 1000 : undefined}
            leftControls={
              <div className="relative shrink-0">
                <button
                  onClick={() => setDeckMenuOpen(!deckMenuOpen)}
                  className="text-[12px] px-1.5 py-0 border border-[#555]"
                  style={{ fontFamily: "var(--font-tech)", color: deckMenuOpen ? "var(--accent-gold)" : "var(--text-dark)", background: "transparent", lineHeight: "16px" }}
                >
                  TOOLS
                </button>
                {deckMenuOpen && (
                  <div className="absolute left-0 top-full mt-1 border-2 border-[#555] flex flex-col" style={{ minWidth: "200px", zIndex: 100, backgroundColor: "var(--bg-base, #c4b89a)" }}>
                    <button
                      onClick={() => { setShowYouTube(!showYouTube); setDeckMenuOpen(false); }}
                      className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                      style={{ fontFamily: "var(--font-tech)", color: showYouTube ? "var(--accent-gold)" : "var(--text-dark)", background: "transparent" }}
                    >
                      YOUTUBE URL
                      <span data-tooltip-right="LOAD A TRACK FROM YOUTUBE" className="ml-3 opacity-40 text-[10px]">?</span>
                    </button>
                    <button
                      onClick={() => { setStem(id, "vocals"); setDeckMenuOpen(false); }}
                      disabled={deck.isStemLoading}
                      className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                      style={{ fontFamily: "var(--font-tech)", color: deck.activeStem === "vocals" ? "var(--accent-gold)" : "var(--text-dark)", background: "transparent", opacity: deck.isStemLoading ? 0.5 : 1 }}
                    >
                      {deck.isStemLoading ? "SEPARATING..." : "ISOLATE VOCALS"}
                      <span data-tooltip-right="STRIP INSTRUMENTS, KEEP VOCALS (ML-POWERED, ~30S)" className="ml-3 opacity-40 text-[10px]">?</span>
                    </button>
                    <button
                      onClick={() => { setStem(id, "instrumental"); setDeckMenuOpen(false); }}
                      disabled={deck.isStemLoading}
                      className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                      style={{ fontFamily: "var(--font-tech)", color: deck.activeStem === "instrumental" ? "var(--accent-gold)" : "var(--text-dark)", background: "transparent", opacity: deck.isStemLoading ? 0.5 : 1 }}
                    >
                      {deck.isStemLoading ? "SEPARATING..." : "REMOVE VOCALS"}
                      <span data-tooltip-right="STRIP VOCALS, KEEP INSTRUMENTS (ML-POWERED, ~30S)" className="ml-3 opacity-40 text-[10px]">?</span>
                    </button>
                    <button
                      onClick={() => { detectDownbeat(id); setDeckMenuOpen(false); }}
                      disabled={!deck.sourceBuffer || deck.downbeatDetecting}
                      className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                      style={{ fontFamily: "var(--font-tech)", color: deck.firstDownbeatMs !== null ? "var(--accent-gold)" : "var(--text-dark)", background: "transparent", opacity: (!deck.sourceBuffer || deck.downbeatDetecting) ? 0.5 : 1 }}
                    >
                      <span>{deck.downbeatDetecting
                        ? "DETECTING..."
                        : deck.firstDownbeatMs !== null
                        ? `DOWNBEAT: ${(deck.firstDownbeatMs / 1000).toFixed(3)}S`
                        : "DETECT DOWNBEAT"}</span>
                      <span data-tooltip-right="FIND THE FIRST BEAT FOR LOOP ALIGNMENT" className="ml-3 opacity-40 text-[10px]">?</span>
                    </button>
                    <button
                      onClick={() => { setShowKeyFinder(!showKeyFinder); setDeckMenuOpen(false); }}
                      className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                      style={{ fontFamily: "var(--font-tech)", color: showKeyFinder ? "var(--accent-gold)" : "var(--text-dark)", background: "transparent" }}
                    >
                      KEY FINDER
                      <span data-tooltip-right="DETECT THE MUSICAL KEY OF THE TRACK" className="ml-3 opacity-40 text-[10px]">?</span>
                    </button>
                    <button
                      onClick={() => { toggleGridlock(id); setDeckMenuOpen(false); }}
                      className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left flex items-center justify-between"
                      style={{ fontFamily: "var(--font-tech)", color: deck.gridlockEnabled ? "#c82828" : "var(--text-dark)", background: "transparent" }}
                    >
                      GRIDLOCK
                      <span data-tooltip-right="LOCK LOOP LENGTH TO THE BPM GRID" className="ml-3 opacity-40 text-[10px]">?</span>
                    </button>
                  </div>
                )}
              </div>
            }
          />
        </div>
      </div>


      {/* GRIDLOCK section */}
      {deck.gridlockEnabled && deck.sourceBuffer && (() => {
        if (!deck.calculatedBPM || deck.gridLockedSectionDur <= 0) {
          return (
            <div className="zone-engraved" style={{ borderColor: "rgba(200,40,40,0.4)" }}>
              <div className="text-[12px] text-center" style={{ color: "#c82828", fontFamily: "var(--font-tech)" }}>
                SET BPM TO ENABLE GRIDLOCK
              </div>
            </div>
          );
        }
        const sectionDur = deck.gridLockedSectionDur / (deck.gridSubdivide ? 4 : 1);
        const sectionDurWallClock = sectionDur / rate; // actual playback time between lines
        const gridAnchor = deck.gridFirstTransient + deck.gridOffsetMs / 1000;
        const dur = deck.sourceBuffer!.duration;
        const inVal = deck.regionStart;
        const outVal = deck.regionEnd > 0 ? deck.regionEnd : dur;
        const sectionCount = Math.round((outVal - inVal) / sectionDur);
        const sectionDurMs = (sectionDurWallClock * 1000).toFixed(0);

        const snapGridIn = (dir: number) => {
          const n = dir < 0
            ? Math.floor((inVal - gridAnchor) / sectionDur - 0.001)
            : Math.ceil((inVal - gridAnchor) / sectionDur + 0.001);
          const snapped = gridAnchor + n * sectionDur;
          setRegion(id, snapped, deck.regionEnd);
        };
        const snapGridOut = (dir: number) => {
          const n = dir < 0
            ? Math.floor((outVal - gridAnchor) / sectionDur - 0.001)
            : Math.ceil((outVal - gridAnchor) / sectionDur + 0.001);
          const snapped = gridAnchor + n * sectionDur;
          setRegion(id, deck.regionStart, snapped);
        };
        const exportToMPC = () => {
          if (!deck.sourceBuffer) return;
          const buf = deck.sourceBuffer;
          const sr = buf.sampleRate;
          const ch0 = buf.getChannelData(0);
          const loops: { name: string; sampleRate: number; length: number; data: Float32Array }[] = [];

          // Calculate grid line positions within the region
          const firstN = Math.ceil((inVal - gridAnchor) / sectionDur);
          const lastN = Math.floor((outVal - gridAnchor) / sectionDur);
          const gridLines: number[] = [];
          for (let n = firstN; n <= lastN; n++) {
            const t = gridAnchor + n * sectionDur;
            if (t >= inVal - 0.001 && t <= outVal + 0.001) gridLines.push(t);
          }
          // Add region boundaries if not already at a grid line
          if (gridLines.length === 0 || gridLines[0] > inVal + 0.001) gridLines.unshift(inVal);
          if (gridLines[gridLines.length - 1] < outVal - 0.001) gridLines.push(outVal);

          // Extract audio between consecutive grid lines (max 15 for MPC pads, last pad = full track)
          for (let i = 0; i < gridLines.length - 1 && loops.length < 15; i++) {
            const start = Math.max(0, gridLines[i]);
            const end = Math.min(dur, gridLines[i + 1]);
            if (end <= start) continue;
            const startSample = Math.floor(start * sr);
            const endSample = Math.min(Math.ceil(end * sr), ch0.length);
            const sliceLen = endSample - startSample;
            if (sliceLen <= 0) continue;
            const data = new Float32Array(sliceLen);
            data.set(ch0.subarray(startSample, endSample));
            loops.push({
              name: `${(i + 1).toString().padStart(2, "0")} - ${Math.round(start * 1000)}MS`,
              sampleRate: sr,
              length: sliceLen,
              data,
            });
          }

          // Last pad (16): entire track from IN to OUT
          const fullStart = Math.max(0, inVal);
          const fullEnd = Math.min(dur, outVal);
          if (fullEnd > fullStart) {
            const fs = Math.floor(fullStart * sr);
            const fe = Math.min(Math.ceil(fullEnd * sr), ch0.length);
            const fullData = new Float32Array(fe - fs);
            fullData.set(ch0.subarray(fs, fe));
            loops.push({ name: "FULL LOOP", sampleRate: sr, length: fe - fs, data: fullData });
          }

          if (loops.length === 0) return;

          // Open full studio and send data to MPC
          const studioUrl = "https://studio-2026-03-19.vercel.app/mpc.html";
          const studioWin = window.open(studioUrl, "driftwave-studio");
          if (!studioWin) return;
          const msg = { type: "deck-export-mpc", loops, bank: id === "B" ? "B" : "A", bpm: deck.calculatedBPM ?? undefined };
          let attempts = 0;
          const trySend = setInterval(() => {
            attempts++;
            try { studioWin.postMessage(msg, "https://studio-2026-03-19.vercel.app"); } catch { /* cross-origin timing */ }
            if (attempts >= 10) clearInterval(trySend);
          }, 500);
        };
        const gridBtnStyle: React.CSSProperties = {
          fontFamily: "var(--font-tech)", color: "#c82828", background: "transparent",
          fontSize: "12px", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px solid #c82828",
        };
        return (
          <div className="zone-engraved" style={{ borderColor: "rgba(200,40,40,0.4)" }}>
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="label" style={{ fontSize: "12px", margin: 0, color: "#c82828" }}>IN</div>
                <div className="flex items-center gap-1">
                  <button onClick={() => snapGridIn(-1)} style={gridBtnStyle}>&lt;</button>
                  <button onClick={() => snapGridIn(1)} style={gridBtnStyle}>&gt;</button>
                </div>
              </div>
              <div className="flex-1 flex flex-col items-center gap-0.5">
                <div className="label" style={{ fontSize: "12px", margin: 0, color: "#c82828" }}>ALIGN</div>
                <input
                  type="range" min={-10000} max={10000} step={10}
                  value={deck.gridOffsetMs}
                  onChange={(e) => setGridOffset(id, parseFloat(e.target.value))}
                  className="w-full gridlock-slider"
                  style={{ WebkitAppearance: "none", appearance: "none", background: "transparent", height: "16px", accentColor: "#c82828" }}
                />
                <div className="flex items-center gap-3">
                  <span className="text-[12px]" style={{ color: "#c82828", fontFamily: "var(--font-tech)" }}>
                    {deck.gridOffsetMs >= 0 ? "+" : ""}{deck.gridOffsetMs}MS
                  </span>
                  <span className="text-[12px]" style={{ color: "#c82828", fontFamily: "var(--font-tech)" }}>
                    {sectionCount} SECTION{sectionCount !== 1 ? "S" : ""}
                  </span>
                  <span className="text-[12px]" style={{ color: "#c82828", fontFamily: "var(--font-tech)" }}>
                    {sectionDurMs}MS APART
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="label" style={{ fontSize: "12px", margin: 0, color: "#c82828" }}>OUT</div>
                <div className="flex items-center gap-1">
                  <button onClick={() => snapGridOut(-1)} style={gridBtnStyle}>&lt;</button>
                  <button onClick={() => snapGridOut(1)} style={gridBtnStyle}>&gt;</button>
                </div>
              </div>
            </div>
            <div className="flex justify-center gap-2 mt-2">
              <button
                onClick={() => toggleGridSubdivide(id)}
                className="text-[12px] uppercase tracking-[0.15em] px-4 py-1 border"
                style={{
                  fontFamily: "var(--font-tech)",
                  color: deck.gridSubdivide ? "#000" : "#c82828",
                  background: deck.gridSubdivide ? "#c82828" : "transparent",
                  borderColor: "#c82828",
                }}
              >
                ÷4 BEAT
              </button>
              <button
                onClick={exportToMPC}
                className="text-[12px] uppercase tracking-[0.15em] px-4 py-1 border"
                style={{ fontFamily: "var(--font-tech)", color: "#c82828", background: "transparent", borderColor: "#c82828" }}
              >
                OUTPUT TO MPC
              </button>
            </div>
          </div>
        );
      })()}

      {/* Loop IN/OUT nudge controls */}
      {deck.sourceBuffer && (deck.regionStart !== 0 || deck.regionEnd > 0) && (() => {
        const dur = deck.sourceBuffer!.duration;
        const inVal = deck.regionStart;
        const outVal = deck.regionEnd > 0 ? deck.regionEnd : dur;
        const nudgeIn = (dir: number) => {
          const v = Math.min(outVal - 0.001, inVal + dir * nudgeStep);
          setRegion(id, v, deck.regionEnd);
        };
        const nudgeOut = (dir: number) => {
          const v = Math.max(inVal + 0.001, outVal + dir * nudgeStep);
          setRegion(id, deck.regionStart, v);
        };
        const btnStyle: React.CSSProperties = {
          fontFamily: "var(--font-tech)", color: "var(--accent-gold)", background: "transparent",
          fontSize: "12px", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px solid #444",
        };
        return (
          <div className="zone-engraved">
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="label" style={{ fontSize: "12px", margin: 0 }}>IN</div>
                <div className="flex items-center gap-1">
                  <button onClick={() => nudgeIn(-1)} style={btnStyle}>&lt;</button>
                  <span className="text-[12px] w-[70px] text-center" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
                    {inVal.toFixed(4)}S
                  </span>
                  <button onClick={() => nudgeIn(1)} style={btnStyle}>&gt;</button>
                </div>
              </div>
              <div className="flex-1 flex flex-col items-center gap-0.5">
                <div className="label" style={{ fontSize: "12px", margin: 0 }}>STEP</div>
                <input
                  type="range" min={0.01} max={1} step={0.01}
                  value={nudgeStep}
                  onChange={(e) => setNudgeStep(parseFloat(e.target.value))}
                  className="w-full"
                  style={{ WebkitAppearance: "none", appearance: "none", background: "transparent", height: "16px" }}
                />
                <span className="text-[12px]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
                  {(nudgeStep * 1000).toFixed(0)}MS
                </span>
              </div>
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="label" style={{ fontSize: "12px", margin: 0 }}>LOOP</div>
                <button
                  onClick={() => setLoopEnabled((v) => !v)}
                  style={{
                    ...btnStyle,
                    width: 40, height: 24,
                    color: loopEnabled ? "var(--accent-gold)" : "var(--text-dark)",
                    borderColor: loopEnabled ? "var(--accent-gold)" : "#444",
                  }}
                >
                  {loopEnabled ? "ON" : "OFF"}
                </button>
              </div>
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="label" style={{ fontSize: "12px", margin: 0 }}>OUT</div>
                <div className="flex items-center gap-1">
                  <button onClick={() => nudgeOut(-1)} style={btnStyle}>&lt;</button>
                  <span className="text-[12px] w-[70px] text-center" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
                    {outVal.toFixed(4)}S
                  </span>
                  <button onClick={() => nudgeOut(1)} style={btnStyle}>&gt;</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Stem status */}
      {(deck.isStemLoading || deck.stemError) && (
        <div className="flex flex-col items-center gap-1">
          {deck.isStemLoading && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] animate-pulse" style={{ color: "var(--accent-gold)", fontFamily: "var(--font-tech)", letterSpacing: "0.15em" }}>
                ISOLATING VOCALS
              </span>
              <span className="text-[12px] animate-pulse" style={{ color: "var(--accent-gold)", fontFamily: "var(--font-tech)" }}>
                &#9679; &#9679; &#9679;
              </span>
            </div>
          )}
          {deck.stemError && (
            <span className="text-[12px]" style={{ color: "var(--led-red-on)", fontFamily: "var(--font-tech)" }}>
              {deck.stemError.toUpperCase()}
            </span>
          )}
        </div>
      )}
      {showKeyFinder && (
        <div className="flex justify-center">
          <PianoKeyboard />
        </div>
      )}

      {/* Transport buttons */}
      <div className="flex items-center gap-2 justify-center">
        <div className="flex flex-col items-center">
          <span className="label" style={{ margin: 0, fontSize: "12px", marginBottom: "4px" }}>REW</span>
          <button onClick={() => handleSkip(-5)} disabled={!deck.sourceBuffer} className="rocker-switch" style={{ width: "44px", height: "44px" }}>
            <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="label" style={{ margin: 0, fontSize: "12px", marginBottom: "4px" }}>START</span>
          <button onClick={handleStart} disabled={!deck.sourceBuffer || deck.isPlaying} className="rocker-switch" style={{ width: "44px", height: "44px" }}>
            <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="label" style={{ margin: 0, fontSize: "12px", marginBottom: "4px" }}>STOP</span>
          <button onClick={() => stop(id)} disabled={!deck.sourceBuffer} className="rocker-switch" style={{ width: "44px", height: "44px" }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{
              background: (id === "A" && recordArmed) ? "var(--led-red-on, #c82828)" : undefined,
              border: (id === "A" && recordArmed) ? "none" : "2px solid #555",
            }} />
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="label" style={{ margin: 0, fontSize: "12px", marginBottom: "4px" }}>PAUSE</span>
          <button onClick={() => pause(id)} disabled={!deck.sourceBuffer || !deck.isPlaying} className="rocker-switch" style={{ width: "44px", height: "44px" }}>
            <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="label" style={{ margin: 0, fontSize: "12px", marginBottom: "4px" }}>FF</span>
          <button onClick={() => handleSkip(5)} disabled={!deck.sourceBuffer} className="rocker-switch" style={{ width: "44px", height: "44px" }}>
            <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
          </button>
        </div>
      </div>

      {/* YouTube URL input */}
      {showYouTube && (
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={ytUrl}
            onChange={(e) => setYtUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ytUrl.trim()) {
                const ctx = getAudioContext();
                ctx.resume().then(() => loadFromYouTube(id, ytUrl.trim()));
                setYtUrl("");
              }
            }}
            placeholder="PASTE YOUTUBE URL"
            disabled={deck.isLoading}
            className="flex-1 bg-transparent border-2 border-[#555] px-3 py-2 text-[12px] uppercase tracking-wider placeholder:text-black"
            style={{ fontFamily: "var(--font-tech)", color: "#000", outline: "none" }}
          />
          <button
            onClick={() => {
              if (!ytUrl.trim()) return;
              const ctx = getAudioContext();
              ctx.resume().then(() => loadFromYouTube(id, ytUrl.trim()));
              setYtUrl("");
            }}
            disabled={deck.isLoading || !ytUrl.trim()}
            className="border-2 border-[#555] px-3 py-2 text-[12px] uppercase tracking-wider disabled:opacity-30"
            style={{ fontFamily: "var(--font-tech)", color: "#000", background: "transparent" }}
          >
            {deck.isLoading ? "LOADING..." : "GO"}
          </button>
        </div>
      )}
      {deck.error && (
        <div className="text-[12px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: "#ff4444" }}>
          {deck.error}
        </div>
      )}

      {/* All controls: Speed/Pitch/Vol on top, Reverb/Tone/Sat below */}
      <div className="zone-engraved">
        <div className="grid grid-cols-6 gap-2" style={{ justifyItems: "center" }}>
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input
                type="range" min="-0.5" max="0.5" step={stepMode && linked ? 0.001 : 0.001}
                value={deck.params.speed}
                onChange={(e) => handleSpeed(parseFloat(e.target.value))}
                className="absolute h-full"
                style={{ ...faderStyle, width: "36px" }}
              />
            </div>
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>SPEED</div>
            {editingSpeed ? (
              <form onSubmit={(e) => {
                e.preventDefault();
                const v = parseFloat(speedInput);
                if (!isNaN(v) && v > 0) {
                  if (deck.calculatedBPM) {
                    handleSpeed(v / deck.calculatedBPM - 1.0);
                  } else {
                    handleSpeed(v - 1.0);
                  }
                }
                setEditingSpeed(false);
              }} className="flex">
                <input
                  autoFocus
                  value={speedInput}
                  onChange={(e) => setSpeedInput(e.target.value)}
                  onBlur={() => setEditingSpeed(false)}
                  className="bg-transparent border border-[#333] text-center w-[70px] text-[12px]"
                  style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", outline: "none" }}
                />
              </form>
            ) : deck.calculatedBPM ? (
              <span
                className="text-[12px]"
                style={{ color: "var(--text-dark)" }}
                onClick={() => { setSpeedInput((deck.calculatedBPM! * rate).toFixed(3)); setEditingSpeed(true); }}
              >
                {(deck.calculatedBPM * rate).toFixed(3)}
              </span>
            ) : (
              <span
                className="text-[12px]"
                style={{ color: "var(--text-dark)" }}
                onClick={() => { setSpeedInput(rate.toFixed(4)); setEditingSpeed(true); }}
              >
                {rate.toFixed(4)}X
              </span>
            )}
            <button onClick={toggleLink} className={detailBtnClass(linked)} style={detailBtnStyle}>LINK</button>
          </div>
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
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>PITCH</div>
            <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>
              {baseKey !== null
                ? semitoneToKey(baseKey, displaySemitones, baseMode)
                : `${displaySemitones >= 0 ? "+" : ""}${displaySemitones.toFixed(1)}ST`
              }
            </span>
            <button onClick={() => setStepMode(!stepMode)} className={detailBtnClass(stepMode)} style={detailBtnStyle}>STEP</button>
          </div>
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
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>VOL</div>
            <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{Math.round(deck.volume * 100)}%</span>
          </div>
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
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>REVERB</div>
            <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{reverbPct}%</span>
            <button onClick={() => setReverbDetail(!reverbDetail)} className={detailBtnClass(reverbDetail)} style={detailBtnStyle}>DETAIL</button>
          </div>
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
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>TONE</div>
            <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{toneLabel}</span>
            <button onClick={() => setToneDetail(!toneDetail)} className={detailBtnClass(toneDetail)} style={detailBtnStyle}>DETAIL</button>
          </div>
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
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>SAT</div>
            <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{satPct}%</span>
            <button onClick={() => setSatDetail(!satDetail)} className={detailBtnClass(satDetail)} style={detailBtnStyle}>DETAIL</button>
          </div>
        </div>
      </div>

      {/* Reverb Detail */}
      {reverbDetail && (
        <div className="zone-engraved">
          <div className="label" style={{ fontSize: "12px", marginBottom: "8px", marginTop: 0 }}>REVERB DETAIL</div>
          <div className="grid grid-cols-3 gap-3" style={{ justifyItems: "center" }}>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="0" max="1" step="0.01"
                  value={deck.params.reverbWetOverride ?? expanded.reverbWet}
                  onChange={(e) => setParam(id, "reverbWetOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>WET/DRY</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{Math.round((deck.params.reverbWetOverride ?? expanded.reverbWet) * 100)}%</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="0.5" max="8" step="0.1"
                  value={deck.params.reverbDurationOverride ?? expanded.reverbDuration}
                  onChange={(e) => setParam(id, "reverbDurationOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>SIZE</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{(deck.params.reverbDurationOverride ?? expanded.reverbDuration).toFixed(1)}S</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="0.5" max="6" step="0.1"
                  value={deck.params.reverbDecayOverride ?? expanded.reverbDecay}
                  onChange={(e) => setParam(id, "reverbDecayOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>DECAY</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{(deck.params.reverbDecayOverride ?? expanded.reverbDecay).toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Tone Detail — Parametric EQ */}
      {toneDetail && (
        <div className="zone-engraved">
          <div className="label" style={{ fontSize: "12px", marginBottom: "8px", marginTop: 0 }}>PARAMETRIC EQ</div>
          <div className="grid grid-cols-5 gap-2" style={{ justifyItems: "center" }}>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="-20" max="20" step="0.5"
                  value={deck.params.eqLowOverride ?? expanded.eqLow}
                  onChange={(e) => setParam(id, "eqLowOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>LOW</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{(deck.params.eqLowOverride ?? expanded.eqLow).toFixed(1)}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="-20" max="20" step="0.5"
                  value={deck.params.eqMidOverride ?? expanded.eqMid}
                  onChange={(e) => setParam(id, "eqMidOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>MID</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{(deck.params.eqMidOverride ?? expanded.eqMid).toFixed(1)}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="-20" max="20" step="0.5"
                  value={deck.params.eqHighOverride ?? expanded.eqHigh}
                  onChange={(e) => setParam(id, "eqHighOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>HIGH</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{(deck.params.eqHighOverride ?? expanded.eqHigh).toFixed(1)}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="100" max="10000" step="50"
                  value={deck.params.eqBumpFreqOverride ?? expanded.eqBumpFreq}
                  onChange={(e) => setParam(id, "eqBumpFreqOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>FREQ</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{Math.round(deck.params.eqBumpFreqOverride ?? expanded.eqBumpFreq)}HZ</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="0" max="15" step="0.5"
                  value={deck.params.eqBumpGainOverride ?? expanded.eqBumpGain}
                  onChange={(e) => setParam(id, "eqBumpGainOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>PEAK</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{(deck.params.eqBumpGainOverride ?? expanded.eqBumpGain).toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Saturation Detail */}
      {satDetail && (
        <div className="zone-engraved">
          <div className="label" style={{ fontSize: "12px", marginBottom: "8px", marginTop: 0 }}>SATURATION DETAIL</div>
          <div className="grid grid-cols-3 gap-3" style={{ justifyItems: "center" }}>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="1" max="50" step="0.5"
                  value={deck.params.satDriveOverride ?? expanded.satDrive}
                  onChange={(e) => setParam(id, "satDriveOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>DRIVE</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{(deck.params.satDriveOverride ?? expanded.satDrive).toFixed(1)}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="0" max="1" step="0.01"
                  value={deck.params.satMixOverride ?? expanded.satMix}
                  onChange={(e) => setParam(id, "satMixOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>MIX</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{Math.round((deck.params.satMixOverride ?? expanded.satMix) * 100)}%</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center">
                <div className="slider-track h-full" />
                <input type="range" min="1000" max="20000" step="100"
                  value={deck.params.satToneOverride ?? expanded.satTone}
                  onChange={(e) => setParam(id, "satToneOverride", parseFloat(e.target.value))}
                  className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>TONE</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{Math.round((deck.params.satToneOverride ?? expanded.satTone) / 1000)}KHZ</span>
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const analyser = getMasterAnalyser();
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx2d.fillStyle = "#1e2e1a";
      ctx2d.fillRect(0, 0, W, H);
      // grid lines
      ctx2d.strokeStyle = "rgba(44,66,37,0.6)";
      ctx2d.lineWidth = 1;
      for (let y = H / 4; y < H; y += H / 4) {
        ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(W, y); ctx2d.stroke();
      }
      if (!analyser) return;
      const bufLen = analyser.frequencyBinCount;
      const data = new Uint8Array(bufLen);
      analyser.getByteFrequencyData(data);
      const useBins = Math.floor(bufLen * 0.15);
      const barW = W / useBins;
      for (let i = 0; i < useBins; i++) {
        const v = data[i] / 255;
        const barH = v * H;
        const alpha = 0.5 + v * 0.5;
        ctx2d.fillStyle = `rgba(117,204,70,${alpha})`;
        ctx2d.fillRect(i * barW, H - barH, barW, barH);
      }
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const compPct = Math.round(masterBus.compAmount * 100);
  const limPct = Math.round(masterBus.limiterAmount * 100);

  const amt = masterBus.compAmount;
  const threshold = masterBus.compThreshold ?? (amt * -40);
  const ratio = masterBus.compRatio ?? (1 + amt * 11);
  const attack = masterBus.compAttack ?? 0.01;
  const release = masterBus.compRelease ?? 0.15;
  const knee = masterBus.compKnee ?? 10;
  const makeup = masterBus.compMakeup ?? (amt * 12);

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

      <canvas
        ref={canvasRef}
        width={600}
        height={120}
        style={{
          width: "100%",
          height: "120px",
          display: "block",
          background: "var(--crt-bg)",
          border: "1px solid var(--engrave-dark)",
        }}
      />

      <div className="zone-engraved">
        <div className="grid grid-cols-5 gap-2" style={{ justifyItems: "center" }}>
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input type="range" min="-20" max="20" step="0.5" value={masterBus.eqLow} onChange={(e) => setMasterBus("eqLow", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
            </div>
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>LOW</div>
            <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{masterBus.eqLow > 0 ? "+" : ""}{masterBus.eqLow.toFixed(1)}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input type="range" min="-20" max="20" step="0.5" value={masterBus.eqMid} onChange={(e) => setMasterBus("eqMid", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
            </div>
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>MID</div>
            <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{masterBus.eqMid > 0 ? "+" : ""}{masterBus.eqMid.toFixed(1)}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input type="range" min="-20" max="20" step="0.5" value={masterBus.eqHigh} onChange={(e) => setMasterBus("eqHigh", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
            </div>
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>HIGH</div>
            <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{masterBus.eqHigh > 0 ? "+" : ""}{masterBus.eqHigh.toFixed(1)}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input type="range" min="0" max="1" step="0.01" value={masterBus.compAmount} onChange={(e) => setMasterBus("compAmount", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
            </div>
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>COMP</div>
            <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{compPct}%</span>
            <button onClick={() => setShowCompDetail(!showCompDetail)} className={detailBtnClass(showCompDetail)} style={detailBtnStyle}>DETAIL</button>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[100px] w-[36px] flex justify-center">
              <div className="slider-track h-full" />
              <input type="range" min="0" max="1" step="0.01" value={masterBus.limiterAmount} onChange={(e) => setMasterBus("limiterAmount", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} />
            </div>
            <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>LIMIT</div>
            <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{limPct}%</span>
            <button onClick={() => setShowLimDetail(!showLimDetail)} className={detailBtnClass(showLimDetail)} style={detailBtnStyle}>DETAIL</button>
          </div>
        </div>
      </div>

      {showCompDetail && (
        <div className="zone-engraved">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2" style={{ justifyItems: "center" }}>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center"><div className="slider-track h-full" /><input type="range" min="-60" max="0" step="1" value={threshold} onChange={(e) => setMasterBus("compThreshold", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} /></div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>THRESH</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{threshold.toFixed(0)}dB</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center"><div className="slider-track h-full" /><input type="range" min="1" max="20" step="0.5" value={ratio} onChange={(e) => setMasterBus("compRatio", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} /></div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>RATIO</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{ratio.toFixed(1)}:1</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center"><div className="slider-track h-full" /><input type="range" min="0.001" max="0.5" step="0.001" value={attack} onChange={(e) => setMasterBus("compAttack", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} /></div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>ATK</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{(attack * 1000).toFixed(0)}ms</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center"><div className="slider-track h-full" /><input type="range" min="0.01" max="1" step="0.01" value={release} onChange={(e) => setMasterBus("compRelease", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} /></div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>REL</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{(release * 1000).toFixed(0)}ms</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center"><div className="slider-track h-full" /><input type="range" min="0" max="40" step="1" value={knee} onChange={(e) => setMasterBus("compKnee", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} /></div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>KNEE</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{knee.toFixed(0)}dB</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center"><div className="slider-track h-full" /><input type="range" min="0" max="24" step="0.5" value={makeup} onChange={(e) => setMasterBus("compMakeup", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} /></div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>GAIN</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>+{makeup.toFixed(1)}dB</span>
            </div>
          </div>
        </div>
      )}

      {showLimDetail && (
        <div className="zone-engraved">
          <div className="label" style={{ fontSize: "12px", marginBottom: "8px", marginTop: 0 }}>LIMITER DETAIL</div>
          <div className="grid grid-cols-3 gap-3" style={{ justifyItems: "center" }}>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center"><div className="slider-track h-full" /><input type="range" min="-20" max="0" step="0.5" value={limThreshold} onChange={(e) => setMasterBus("limiterThreshold", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} /></div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>CEILING</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{limThreshold.toFixed(1)}dB</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center"><div className="slider-track h-full" /><input type="range" min="0.001" max="0.3" step="0.001" value={limRelease} onChange={(e) => setMasterBus("limiterRelease", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} /></div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>REL</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{(limRelease * 1000).toFixed(0)}ms</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-[80px] w-[36px] flex justify-center"><div className="slider-track h-full" /><input type="range" min="0" max="6" step="0.5" value={limKnee} onChange={(e) => setMasterBus("limiterKnee", parseFloat(e.target.value))} className="absolute h-full" style={{ ...faderStyle, width: "36px" }} /></div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>KNEE</div>
              <span className="text-[12px]" style={{ color: "var(--text-dark)" }}>{limKnee.toFixed(1)}dB</span>
            </div>
          </div>
        </div>
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
        <div className="flex flex-col gap-5 text-[12px] leading-[1.6]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>LOADING TRACKS</div>
            <div>LOAD A TRACK INTO A DECK USING THE LOAD BUTTON (LOCAL FILE) OR PASTE A YOUTUBE URL AND HIT GO. EACH DECK HAS INDEPENDENT CONTROLS FOR SPEED, PITCH, VOLUME, REVERB, TONE, AND SATURATION.</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>TWO DECKS</div>
            <div>STARTS WITH ONE DECK. HIT ADD A SECOND DECK TO SHOW DECK B. CLICK HIDE ON DECK B TO COLLAPSE BACK TO SINGLE DECK. SYNC CONTROLS AND CROSSFADER ONLY APPEAR WHEN BOTH DECKS ARE VISIBLE.</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>SPEED + PITCH</div>
            <div className="mb-1">SPEED AND PITCH ARE TWO SEPARATE PARAMETERS. SPEED CONTROLS PLAYBACK RATE. PITCH CONTROLS PITCH SHIFT. THEY ARE STORED AND APPLIED INDEPENDENTLY.</div>
            <div className="mb-1">THE LINK BUTTON COUPLES THEM IN THE UI. TOGGLING LINK DOES NOT CHANGE EITHER VALUE — IT ONLY CHANGES HOW THE SLIDERS BEHAVE FROM THAT POINT FORWARD.</div>
            <div className="mb-1">LINKED (DEFAULT — VARISPEED): MOVING THE SPEED SLIDER UPDATES BOTH SPEED AND PITCH ATOMICALLY SO THEY STAY IN SYNC. PITCH FOLLOWS SPEED LIKE A TAPE DECK. NET PITCH CORRECTION IS 1.0 — THE AUDIO IS NOT PROCESSED, JUST PLAYED AT A DIFFERENT RATE.</div>
            <div className="mb-1">UNLINKED: SPEED AND PITCH MOVE INDEPENDENTLY. SPEED CHANGES TEMPO WITHOUT AFFECTING PITCH. PITCH SHIFTS WITHOUT AFFECTING TEMPO. THE PITCH SHIFTER (RUBBER BAND) APPLIES THE DIFFERENCE BETWEEN WHERE PITCH IS AND WHERE SPEED WOULD PUT IT.</div>
            <div className="mb-1">RELINKING: IF YOU UNLINK, ADJUST PITCH, THEN RELINK — BOTH VALUES ARE PRESERVED EXACTLY AS YOU LEFT THEM. THE FIRST TIME YOU MOVE THE SPEED SLIDER AFTER RELINKING, PITCH WILL SYNC TO MATCH THE NEW SPEED. UNTIL THEN, NOTHING CHANGES.</div>
            <div>STEP: SNAPS PITCH TO SEMITONE INTERVALS. ONLY AVAILABLE WHEN UNLINKED.</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>MATCH LEN</div>
            <div className="mb-1">ADJUSTS THE PLAYBACK SPEED OF BOTH DECKS SO THEIR SELECTED REGIONS ARE THE SAME LENGTH IN SECONDS. BOTH DECKS MOVE TOWARD A GEOMETRIC MEAN — NEITHER ONE IS TREATED AS THE REFERENCE.</div>
            <div>THIS OPERATES ON SPEED ONLY AND DOES NOT AFFECT PITCH. BOTH DECKS ARE UNLINKED BEFORE THE SPEED VALUES ARE SET.</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>EFFECTS CHAIN</div>
            <div className="mb-1">EACH DECK RUNS: SOURCE → EQ → SATURATION → REVERB → OUTPUT.</div>
            <div className="mb-1">REVERB DETAIL: WET LEVEL, SIZE (ROOM DURATION), DECAY.</div>
            <div className="mb-1">TONE DETAIL: 5-BAND PARAMETRIC EQ — LOW SHELF, MID, HIGH SHELF, FREQUENCY SWEEP, PEAK GAIN.</div>
            <div>SAT DETAIL: DRIVE (WAVESHAPER AGGRESSIVENESS), MIX (DRY/WET BLEND), TONE (POST-SATURATION LOWPASS).</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>OUTPUT BUS</div>
            <div className="mb-1">MASTER EQ (LOW/MID/HIGH), COMPRESSOR, AND LIMITER ON THE FINAL MIX. EACH HAS A DETAIL PANEL.</div>
            <div className="mb-1">COMP: SINGLE KNOB MAPS TO THRESHOLD + RATIO + MAKEUP GAIN TOGETHER. DETAIL PANEL OVERRIDES INDIVIDUAL PARAMS.</div>
            <div>LIMIT: BRICK-WALL LIMITER AFTER THE COMPRESSOR. DETAIL CONTROLS CEILING, RELEASE, AND KNEE.</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>LOOP FINE-TUNE</div>
            <div>WHEN A REGION IS SELECTED, IN/OUT NUDGE BUTTONS APPEAR. USE &lt; AND &gt; TO NUDGE LOOP BOUNDARIES. STEP SIZE SLIDER ADJUSTS FROM 0.1MS TO 1S (LOGARITHMIC).</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>PIANO KEYBOARD</div>
            <div>ONE OCTAVE SINE WAVE GENERATOR FOR FINDING THE KEY BY EAR. OCTAVE UP/DOWN BUTTONS. LATCH HOLDS A NOTE UNTIL YOU PRESS ANOTHER OR THE SAME KEY AGAIN.</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>SYNC + CROSSFADER</div>
            <div className="mb-1">SYNC START: STARTS BOTH DECKS SIMULTANEOUSLY WITH SAMPLE-ACCURATE TIMING.</div>
            <div>CROSSFADER: CENTER = BOTH DECKS FULL VOLUME. LEFT = DECK A ONLY. RIGHT = DECK B ONLY.</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>RECORDING</div>
            <div>ARM THE REC BUTTON. RECORDING STARTS ON SYNC START AND CAPTURES THE LIVE MIX. WHEN DECK A STOPS, RECORDING ENDS AND THE EXPORT MODAL OPENS AUTOMATICALLY.</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>EXPORT</div>
            <div className="mb-1">HIT EXPORT IN THE HEADER TO RENDER DECK A WITH ALL EFFECTS APPLIED. ENTER ARTIST AND TITLE. THE VIDEO IS GENERATED WITH COVER ART AND STORED ON PINATA. DOWNLOADS AUTOMATICALLY.</div>
            <div>ALL EXPORTS ARE SAVED TO THE GALLERY.</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>STEM ISOLATION</div>
            <div>CLICK ISOLATE VOCALS TO SEPARATE VOCALS USING ML (DEMUCS). FIRST USE TAKES 30–60 SECONDS. CLICK AGAIN TO TOGGLE OFF.</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>GRIDLOCK</div>
            <div>TOGGLE FROM TOOLS MENU. OVERLAYS RED GRID LINES EVERY 4 BARS BASED ON BPM. ALIGN SLIDER SHIFTS ALL LINES UNIFORMLY. GRID IN/OUT ARROWS SNAP REGION TO GRID LINES. OUTPUT TO MPC SENDS GRID SECTIONS TO THE STUDIO MPC. THE LAST MPC PAD IS ALWAYS THE FULL LOOP FROM IN TO OUT.</div>
          </div>

          <div>
            <div className="text-[12px] mb-2" style={{ color: "var(--accent-gold)" }}>KEYBOARD SHORTCUTS</div>
            <div>+ / - : ZOOM WAVEFORM IN/OUT</div>
            <div>F : ZOOM TO FIT SELECTED REGION</div>
          </div>

        </div>
      </div>
    </div>
  );
}

interface LocalSession {
  id: string;
  name: string;
  savedAt: string;
  deckA: Record<string, unknown> | null;
  deckB: Record<string, unknown> | null;
  crossfader: number;
  masterBus: MasterBusParams;
}

const LS_KEY = "dw_sessions";

function getSavedSessions(): LocalSession[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}

function SaveLoadModal({ onClose }: { onClose: () => void }) {
  const restoreSessionFromData = useRemixStore((s) => s.restoreSessionFromData);
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    setSessions(getSavedSessions());
  }, []);

  const handleLoad = async (s: LocalSession) => {
    setLoadingId(s.id);
    await restoreSessionFromData({ deckA: s.deckA, deckB: s.deckB, crossfader: s.crossfader, masterBus: s.masterBus });
    setLoadingId(null);
    onClose();
  };

  const handleDelete = (id: string) => {
    const updated = getSavedSessions().filter((s) => s.id !== id);
    localStorage.setItem(LS_KEY, JSON.stringify(updated));
    setSessions(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)" }}>
      <div className="console w-full max-w-[600px] max-h-[80vh] overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm tracking-[2px] uppercase" style={{ color: "var(--text-dark)", fontFamily: "var(--font-display)" }}>SAVED SESSIONS</span>
          <button onClick={onClose} className={detailBtnClass(false)} style={detailBtnStyle}>CLOSE</button>
        </div>
        {sessions.length === 0 ? (
          <div className="text-[12px] opacity-50" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>NO SAVED SESSIONS</div>
        ) : (
          <div className="flex flex-col gap-0">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-2 border-b border-[#444]">
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className="text-[12px] uppercase tracking-[0.1em] truncate" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>{s.name}</span>
                  <span className="text-[10px] opacity-50" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>{s.savedAt}</span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleLoad(s)}
                    disabled={loadingId === s.id}
                    className={detailBtnClass(false)}
                    style={{ ...detailBtnStyle, opacity: loadingId === s.id ? 0.5 : 1 }}
                  >
                    {loadingId === s.id ? "LOADING..." : "LOAD"}
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className={detailBtnClass(false)}
                    style={{ ...detailBtnStyle, color: "#c82828", borderColor: "#c82828" }}
                  >
                    DELETE
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const crossfader = useRemixStore((s) => s.crossfader);
  const setCrossfader = useRemixStore((s) => s.setCrossfader);
  const syncPlay = useRemixStore((s) => s.syncPlay);
  const stopDeck = useRemixStore((s) => s.stop);
  const setParam = useRemixStore((s) => s.setParam);
  const deckA = useRemixStore((s) => s.deckA);
  const deckB = useRemixStore((s) => s.deckB);
  const recordArmed = useRemixStore((s) => s.recordArmed);
  const isRecording = useRemixStore((s) => s.isRecording);
  const isConvertingWav = useRemixStore((s) => s.isConvertingWav);
  const armRecord = useRemixStore((s) => s.armRecord);
  const pendingRecording = useRemixStore((s) => s.pendingRecording);
  const clearPendingRecording = useRemixStore((s) => s.clearPendingRecording);
  const downloadRecordingWAV = useRemixStore((s) => s.downloadRecordingWAV);
  const exportRecordingMP4 = useRemixStore((s) => s.exportRecordingMP4);
  const pendingVideoExport = useRemixStore((s) => s.pendingVideoExport);
  const clearPendingExport = useRemixStore((s) => s.clearPendingExport);
  const masterBus = useRemixStore((s) => s.masterBus);
  const [manualOpen, setManualOpen] = useState(false);
  const [loadModalOpen, setLoadModalOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDeckB, setShowDeckB] = useState(true);
  const exportMP4 = useRemixStore((s) => s.exportMP4);
  const isExporting = useRemixStore((s) => s.isExporting);
  const restoreSession = useRemixStore((s) => s.restoreSession);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareStatus, setShareStatus] = useState("");

  // Restore shared session on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("s");
    if (sessionId) {
      setShowDeckB(true);
      restoreSession(sessionId);
    }
  }, [restoreSession]);

  const handleShare = async () => {
    if (!deckA.sourceBuffer && !deckB.sourceBuffer) return;
    setShareLoading(true);
    setMenuOpen(false);
    try {
      const buildDeckData = (deck: typeof deckA) => deck.sourceBuffer ? {
        audioUrl: deck.sourceUrl || null,
        filename: deck.sourceFilename || "track",
        params: deck.params,
        regionStart: deck.regionStart,
        regionEnd: deck.regionEnd,
        volume: deck.volume,
        calculatedBPM: deck.calculatedBPM,
        artist: deck.artist,
        title: deck.title,
        baseKey: deck.baseKey,
        activeStem: deck.activeStem || null,
      } : null;

      const form = new FormData();
      form.append("session", JSON.stringify({
        deckA: buildDeckData(deckA),
        deckB: buildDeckData(deckB),
        crossfader,
      }));
      if (deckA.sourceFile) form.append("audioA", deckA.sourceFile);
      if (deckB.sourceFile) form.append("audioB", deckB.sourceFile);

      const res = await fetch("/api/session", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const url = `${window.location.origin}/?s=${data.id}`;
      await navigator.clipboard.writeText(url);
      setShareStatus("LINK COPIED");
    } catch {
      setShareStatus("SHARE FAILED");
    }
    setShareLoading(false);
    setTimeout(() => setShareStatus(""), 3000);
  };

  const saveSession = () => {
    const buildDeckData = (deck: typeof deckA) => deck.sourceBuffer ? {
      audioUrl: deck.sourceUrl || null,
      filename: deck.sourceFilename || "track",
      params: deck.params,
      regionStart: deck.regionStart,
      regionEnd: deck.regionEnd,
      volume: deck.volume,
      calculatedBPM: deck.calculatedBPM,
      artist: deck.artist,
      title: deck.title,
      baseKey: deck.baseKey,
    } : null;

    const parts: string[] = [];
    if (deckA.sourceBuffer && deckA.title) parts.push(deckA.title.toUpperCase());
    if (deckB.sourceBuffer && deckB.title) parts.push(deckB.title.toUpperCase());
    const name = parts.length > 0 ? parts.join(" + ") : "SESSION";

    const id = Math.random().toString(36).slice(2, 12);
    const savedAt = new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).toUpperCase();

    const session: LocalSession = {
      id,
      name,
      savedAt,
      deckA: buildDeckData(deckA) as Record<string, unknown> | null,
      deckB: buildDeckData(deckB) as Record<string, unknown> | null,
      crossfader,
      masterBus,
    };

    const existing = getSavedSessions();
    existing.unshift(session);
    if (existing.length > 30) existing.splice(30);
    localStorage.setItem(LS_KEY, JSON.stringify(existing));
    setSaveStatus("SAVED");
    setTimeout(() => setSaveStatus(""), 2500);
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-[1100px] flex flex-col gap-5">
        <div className="console flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center gap-4 px-3 boot-stagger boot-delay-1 relative" style={{ zIndex: 100 }}>
            <div className="w-6 h-6 border-[3px] border-[var(--text-dark)] rounded-[4px] relative">
              <div className="absolute inset-[4px] bg-[var(--text-dark)]" />
            </div>
            <span
              className="text-lg sm:text-xl tracking-[2px] uppercase"
              style={{ color: "var(--text-dark)", fontFamily: "var(--font-display)" }}
            >
              SLOWED AND REVERBED MACHINE
            </span>
            <div className="ml-auto relative" style={{ zIndex: 100 }}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="text-[12px] uppercase tracking-[0.15em] px-2 py-0.5 border border-[#555]"
                style={{ fontFamily: "var(--font-tech)", color: menuOpen ? "var(--accent-gold)" : "var(--text-dark)", background: "transparent" }}
              >
                MENU
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 border-2 border-[#555] flex flex-col" style={{ minWidth: "200px", zIndex: 100, backgroundColor: "var(--bg-base, #c4b89a)" }}>
                  <button
                    onClick={() => { saveSession(); setMenuOpen(false); }}
                    className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                    style={{ fontFamily: "var(--font-tech)", color: saveStatus ? "var(--accent-gold)" : "var(--text-dark)", background: "transparent" }}
                  >
                    {saveStatus || "SAVE SESSION"}
                    <span data-tooltip-right="SAVE CURRENT SESSION TO THIS BROWSER" className="ml-3 opacity-40 text-[10px]">?</span>
                  </button>
                  <button
                    onClick={() => { setLoadModalOpen(true); setMenuOpen(false); }}
                    className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                    style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent" }}
                  >
                    LOAD SESSION
                    <span data-tooltip-right="RESTORE A PREVIOUSLY SAVED SESSION" className="ml-3 opacity-40 text-[10px]">?</span>
                  </button>
                  <button
                    onClick={() => { setManualOpen(true); setMenuOpen(false); }}
                    className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                    style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent" }}
                  >
                    MANUAL
                    <span data-tooltip-right="VIEW THE FULL USER MANUAL" className="ml-3 opacity-40 text-[10px]">?</span>
                  </button>
                  <button
                    onClick={() => { exportMP4(); setMenuOpen(false); }}
                    disabled={(!deckA.sourceBuffer && !deckB.sourceBuffer) || isExporting}
                    className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                    style={{ fontFamily: "var(--font-tech)", color: "var(--accent-gold)", background: "transparent", opacity: (!deckA.sourceBuffer && !deckB.sourceBuffer) ? 0.3 : 1 }}
                  >
                    {isExporting ? "RENDERING..." : "EXPORT MP4"}
                    <span data-tooltip-right="RENDER YOUR MIX AS A VIDEO FILE" className="ml-3 opacity-40 text-[10px]">?</span>
                  </button>
                  <button
                    onClick={handleShare}
                    disabled={(!deckA.sourceBuffer && !deckB.sourceBuffer) || shareLoading}
                    className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                    style={{ fontFamily: "var(--font-tech)", color: shareStatus ? "var(--accent-gold)" : "var(--text-dark)", background: "transparent", opacity: (!deckA.sourceBuffer && !deckB.sourceBuffer) ? 0.3 : 1 }}
                  >
                    {shareLoading ? "UPLOADING..." : shareStatus || "SHARE SESSION"}
                    <span data-tooltip-right="UPLOAD AND SHARE A LINK TO THIS SESSION" className="ml-3 opacity-40 text-[10px]">?</span>
                  </button>
                  <a
                    href="https://www.youtube.com/@SLOWANDREVERBEDMACHINE"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                    style={{ fontFamily: "var(--font-tech)", color: "var(--accent-gold)", background: "transparent" }}
                  >
                    YOUTUBE
                    <span data-tooltip-right="VISIT THE SLOWED+REVERBED YOUTUBE CHANNEL" className="ml-3 opacity-40 text-[10px]">?</span>
                  </a>
                  <a
                    href="https://studio-2026-03-19.vercel.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left border-b border-[#333] flex items-center justify-between"
                    style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent" }}
                  >
                    STUDIO
                    <span data-tooltip-right="OPEN THE DRIFTWAVE STUDIO APP" className="ml-3 opacity-40 text-[10px]">?</span>
                  </a>
                  <a
                    href="https://everysong.site"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="text-[12px] uppercase tracking-[0.15em] px-4 py-2 text-left flex items-center justify-between"
                    style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent" }}
                  >
                    EVERY SONG
                    <span data-tooltip-right="BROWSE EVERY SONG ON EVERYSONG.SITE" className="ml-3 opacity-40 text-[10px]">?</span>
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Decks */}
          <div className="grid gap-5 boot-stagger boot-delay-3 grid-cols-1 sm:grid-cols-2">
            <div className="zone-inset">
              <Deck id="A" />
            </div>
            <div className="zone-inset">
              <Deck id="B" />
            </div>
          </div>

          {/* Sync start + Lock BPM + Record — only when deck B visible */}
          {showDeckB && (
            <div className="flex justify-center gap-6 boot-stagger boot-delay-3">
              <div className="flex flex-col items-center" data-tooltip="ARMS THE RECORDER. CAPTURES THE MIX WHEN BOTH DECKS PLAY.">
                <span className="label" style={{ margin: 0, fontSize: "12px", marginBottom: "4px" }}>LIVE RECORDING</span>
                <button
                  onClick={() => armRecord()}
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
                <span className="text-[12px] mt-0.5" style={{
                  fontFamily: "var(--font-tech)",
                  color: isRecording ? "var(--led-red-on, #c82828)" : recordArmed ? "var(--led-red-on, #c82828)" : "var(--text-dark)",
                  opacity: isRecording || recordArmed ? 1 : 0.4,
                }}>
                  {isRecording ? "STOP" : recordArmed ? "ARMED" : "OFF"}
                </span>
              </div>
              <div className="flex flex-col items-center" data-tooltip="STARTS BOTH DECKS SIMULTANEOUSLY.">
                <span className="label" style={{ margin: 0, fontSize: "12px", marginBottom: "4px" }}>SYNC START</span>
                <button
                  onClick={async () => { const ctx = getAudioContext(); await ctx.resume(); syncPlay(); }}
                  disabled={!deckA.sourceBuffer && !deckB.sourceBuffer}
                  className="rocker-switch"
                  style={{ width: "60px", height: "44px" }}
                >
                  <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
                </button>
              </div>
              <div className="flex flex-col items-center" data-tooltip="STOPS BOTH DECKS SIMULTANEOUSLY.">
                <span className="label" style={{ margin: 0, fontSize: "12px", marginBottom: "4px" }}>SYNC STOP</span>
                <button
                  onClick={() => { stopDeck("A"); stopDeck("B"); }}
                  disabled={!deckA.sourceBuffer && !deckB.sourceBuffer}
                  className="rocker-switch"
                  style={{ width: "60px", height: "44px" }}
                >
                  <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
                </button>
              </div>
              <div className="flex flex-col items-center" data-tooltip="ADJUSTS BOTH DECK SPEEDS SO THEIR REGIONS PLAY IN EQUAL TIME. PITCH PRESERVED.">
                <span className="label" style={{ margin: 0, fontSize: "12px", marginBottom: "4px" }}>MATCH LEN</span>
                <button
                  onClick={() => {
                    if (!deckA.sourceBuffer || !deckB.sourceBuffer) return;
                    const aLen = (deckA.regionEnd > 0 ? deckA.regionEnd : deckA.sourceBuffer.duration) - deckA.regionStart;
                    const bLen = (deckB.regionEnd > 0 ? deckB.regionEnd : deckB.sourceBuffer.duration) - deckB.regionStart;
                    if (aLen <= 0 || bLen <= 0) return;
                    // Target duration = geometric mean — both decks meet in the middle.
                    // Each deck adjusts its own speed (BPM) to play its selection in T seconds.
                    // Speed is always pitch-independent: unlink first so pitch is preserved.
                    const T = Math.sqrt(aLen * bLen);
                    if (deckA.params.pitchSpeedLinked ?? true) setParam("A", "pitchSpeedLinked", 0);
                    if (deckB.params.pitchSpeedLinked ?? true) setParam("B", "pitchSpeedLinked", 0);
                    setParam("A", "speed", aLen / T - 1);
                    setParam("B", "speed", bLen / T - 1);
                  }}
                  disabled={!deckA.sourceBuffer || !deckB.sourceBuffer}
                  className="rocker-switch"
                  style={{ width: "60px", height: "44px" }}
                >
                  <div className="w-1.5 h-1.5 rounded-full border-2 border-[#555]" />
                </button>
              </div>
            </div>
          )}

          {/* Crossfader — only when deck B visible */}
          {showDeckB && (
            <div className="zone-inset boot-stagger boot-delay-3">
              <div className="flex items-center gap-4">
                <span className="label" style={{ margin: 0, fontSize: "12px", minWidth: "20px" }}>A</span>
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
                <span className="label" style={{ margin: 0, fontSize: "12px", minWidth: "20px" }}>B</span>
              </div>
              <div className="label" style={{ fontSize: "12px", marginTop: "4px" }}>CROSSFADER</div>
            </div>
          )}

          {/* Recording complete — export options */}
          {pendingRecording && (
            <div className="zone-inset flex flex-col items-center gap-3 py-4">
              <span
                className="text-[12px] tracking-[2px] uppercase"
                style={{ color: "var(--accent-gold)", fontFamily: "var(--font-display)" }}
              >
                RECORDING COMPLETE
              </span>
              <div className="flex gap-4">
                <button
                  onClick={downloadRecordingWAV}
                  disabled={isConvertingWav}
                  className="border border-[var(--accent-gold)] px-4 py-2 text-[12px] uppercase tracking-wider disabled:opacity-50"
                  style={{ fontFamily: "var(--font-tech)", color: "var(--accent-gold)", background: "transparent" }}
                >
                  {isConvertingWav ? "CONVERTING..." : "DOWNLOAD WAV"}
                </button>
                <button
                  onClick={exportRecordingMP4}
                  className="border-2 border-[var(--accent-gold)] px-4 py-2 text-[12px] uppercase tracking-wider"
                  style={{ fontFamily: "var(--font-tech)", color: "var(--accent-gold)", background: "transparent" }}
                >
                  EXPORT MP4
                </button>
                <button
                  onClick={clearPendingRecording}
                  className="border border-[#333] px-4 py-2 text-[12px] uppercase tracking-wider"
                  style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent" }}
                >
                  DISCARD
                </button>
              </div>
            </div>
          )}

          {/* Master output bus */}
          <div className="zone-inset boot-stagger boot-delay-4">
            <MasterBus />
          </div>
        </div>

        <Toast />
        <div className="mt-16 py-5 border-t border-[#333] text-center">
          <a href="https://thegoodinternet.app" target="_blank" rel="noopener noreferrer" className="uppercase tracking-[1px]" style={{ fontSize: "10px", fontWeight: 300, color: "var(--text-muted, #777)", textDecoration: "none" }}>IN PUBLIC</a>
        </div>
      </div>
      {manualOpen && <Manual onClose={() => setManualOpen(false)} />}
      {loadModalOpen && <SaveLoadModal onClose={() => setLoadModalOpen(false)} />}
      {pendingVideoExport && (
        <ExportVideoModalRemix
          audioBlob={pendingVideoExport}
          defaultFilename={`${deckA.sourceFilename || "deck-a"}${deckB.sourceBuffer ? `-x-${deckB.sourceFilename || "deck-b"}` : ""}-driftwave`}
          initialArtist={[deckA.artist, deckB.artist].filter(Boolean).join(" x ")}
          initialTitle={[deckA.title, deckB.title].filter(Boolean).join(" / ")}
          onClose={clearPendingExport}
        />
      )}
    </main>
  );
}
