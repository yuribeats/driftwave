"use client";

import { useRef, useCallback } from "react";
import { useStore } from "../lib/store";

export default function Uploader() {
  const loadFile = useStore((s) => s.loadFile);
  const isLoading = useStore((s) => s.isLoading);
  const sourceFilename = useStore((s) => s.sourceFilename);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile]
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={isLoading}
        className="text-sm uppercase tracking-[0.2em] font-bold disabled:opacity-50"
        style={{
          color: sourceFilename ? "#555" : "#D4AF37",
          textShadow: sourceFilename ? "none" : "0 0 8px rgba(212,175,55,0.4)",
        }}
      >
        {isLoading ? "LOADING..." : sourceFilename || "LOAD SONG"}
      </button>
    </>
  );
}
