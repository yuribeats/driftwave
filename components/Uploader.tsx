"use client";

import { useRef, useState, useCallback } from "react";
import { useStore } from "../lib/store";

export default function Uploader() {
  const loadFile = useStore((s) => s.loadFile);
  const loadFromYouTube = useStore((s) => s.loadFromYouTube);
  const isLoading = useStore((s) => s.isLoading);
  const sourceBuffer = useStore((s) => s.sourceBuffer);

  const [ytUrl, setYtUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [ytError, setYtError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) loadFile(file);
    },
    [loadFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile]
  );

  const handleYouTube = useCallback(async () => {
    setYtError("");
    const url = ytUrl.trim();
    if (!url) return;
    if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
      setYtError("INVALID YOUTUBE URL");
      return;
    }
    try {
      await loadFromYouTube(url);
      setYtUrl("");
    } catch (err) {
      setYtError(err instanceof Error ? err.message : "FETCH FAILED");
    }
  }, [ytUrl, loadFromYouTube]);

  if (sourceBuffer && !isLoading) return null;

  return (
    <div className="bg-gradient-to-b from-[#3a3a3e] to-[#2a2a2e] border border-[#1a1a1a] shadow-[0_4px_16px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] p-6">
      <div
        className={`border-2 border-dashed ${
          dragOver ? "border-dw-accent" : "border-[#444]"
        } p-10 text-center transition-colors`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileSelect}
        />
        {isLoading ? (
          <p className="text-dw-muted uppercase tracking-[0.15em] text-xs">
            LOADING...
          </p>
        ) : (
          <p className="text-dw-muted uppercase tracking-[0.15em] text-xs">
            DROP AUDIO FILE / CLICK TO BROWSE
          </p>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={ytUrl}
          onChange={(e) => setYtUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleYouTube()}
          placeholder="PASTE YOUTUBE URL..."
          disabled={isLoading}
          className="flex-1 bg-[#1a1a1a] border border-[#333] px-3 py-2 text-xs text-dw-text placeholder:text-dw-muted uppercase tracking-[0.1em] outline-none focus:border-dw-accent disabled:opacity-50 font-mono"
        />
        <button
          onClick={handleYouTube}
          disabled={isLoading || !ytUrl.trim()}
          className="bg-[#1a1a1a] border border-[#333] px-5 py-2 text-xs text-dw-accent uppercase tracking-[0.15em] hover:bg-[#333] disabled:opacity-50 disabled:text-dw-muted font-mono"
        >
          {isLoading ? "..." : "FETCH"}
        </button>
      </div>

      {ytError && (
        <p className="mt-2 text-dw-danger text-[10px] uppercase tracking-[0.1em]">
          {ytError}
        </p>
      )}
    </div>
  );
}
