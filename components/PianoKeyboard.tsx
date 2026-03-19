"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { getAudioContext } from "../lib/audio-context";

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]); // C#, D#, F#, G#, A#

interface Props {
  style?: React.CSSProperties;
}

export default function PianoKeyboard({ style }: Props) {
  const [octave, setOctave] = useState(4);
  const [latch, setLatch] = useState(false);
  const [activeNote, setActiveNote] = useState<number | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const stopNote = useCallback(() => {
    if (oscRef.current) {
      try { oscRef.current.stop(); } catch { /* ok */ }
      oscRef.current = null;
    }
    if (gainRef.current) {
      gainRef.current = null;
    }
  }, []);

  const playNote = useCallback((noteIdx: number) => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();

    // Stop previous note (monophonic)
    stopNote();

    const midi = (octave + 1) * 12 + noteIdx; // C4 = MIDI 60
    const freq = 440 * Math.pow(2, (midi - 69) / 12);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    gain.gain.value = 0.15;

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    oscRef.current = osc;
    gainRef.current = gain;
    setActiveNote(noteIdx);
  }, [octave, stopNote]);

  const handleNoteDown = useCallback((noteIdx: number) => {
    if (latch && activeNote === noteIdx) {
      // Unlatch: stop the note
      stopNote();
      setActiveNote(null);
    } else {
      playNote(noteIdx);
    }
  }, [latch, activeNote, playNote, stopNote]);

  const handleNoteUp = useCallback(() => {
    if (!latch) {
      stopNote();
      setActiveNote(null);
    }
  }, [latch, stopNote]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopNote(); };
  }, [stopNote]);

  const btnClass = "text-[8px] uppercase tracking-[0.15em] px-2 py-0.5 border";
  const btnStyle: React.CSSProperties = { fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent" };

  return (
    <div className="flex flex-col items-center gap-2" style={style}>
      <div className="label" style={{ margin: 0, fontSize: "9px" }}>KEY FINDER</div>

      {/* Keyboard */}
      <div className="flex relative" style={{ height: "48px", userSelect: "none" }}>
        {NOTES.map((note, i) => {
          const isBlack = BLACK_KEYS.has(i);
          const isActive = activeNote === i;
          return (
            <div
              key={i}
              onPointerDown={() => handleNoteDown(i)}
              onPointerUp={handleNoteUp}
              onPointerLeave={handleNoteUp}
              style={{
                width: isBlack ? "16px" : "22px",
                height: isBlack ? "30px" : "48px",
                background: isActive
                  ? "var(--accent, #c8a96e)"
                  : isBlack ? "#222" : "#ddd",
                border: "1px solid #333",
                marginLeft: isBlack ? "-8px" : "0",
                marginRight: isBlack ? "-8px" : "0",
                zIndex: isBlack ? 2 : 1,
                position: "relative",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                touchAction: "none",
              }}
            >
              <span style={{
                fontSize: "6px",
                color: isBlack ? "#888" : "#444",
                fontFamily: "var(--font-tech)",
                paddingBottom: "2px",
              }}>
                {note}
              </span>
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOctave(Math.max(1, octave - 1))}
          className={btnClass}
          style={{ ...btnStyle, borderColor: "#777" }}
        >
          OCT-
        </button>
        <span className="text-[9px]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
          {octave}
        </span>
        <button
          onClick={() => setOctave(Math.min(7, octave + 1))}
          className={btnClass}
          style={{ ...btnStyle, borderColor: "#777" }}
        >
          OCT+
        </button>
        <button
          onClick={() => setLatch(!latch)}
          className={btnClass}
          style={{
            ...btnStyle,
            borderColor: latch ? "#333" : "#777",
            background: latch ? "rgba(255,115,0,0.15)" : "transparent",
          }}
        >
          LATCH
        </button>
      </div>
    </div>
  );
}
