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
    } catch (err) {
      setYtError(err instanceof Error ? err.message : "FETCH FAILED");
    }
  }, [ytUrl, loadFromYouTube]);

  if (sourceBuffer && !isLoading) return null;

  return (
    <div className="border border-dw-border p-6">
      <div
        className={`border border-dashed ${
          dragOver ? "border-dw-accent" : "border-dw-border"
        } p-12 text-center transition-colors`}
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
          <p className="text-dw-muted uppercase tracking-widest text-sm">
            DECODING...
          </p>
        ) : (
          <p className="text-dw-muted uppercase tracking-widest text-sm">
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
          className="flex-1 bg-dw-surface2 border border-dw-border px-3 py-2 text-sm text-dw-text placeholder:text-dw-muted uppercase tracking-wider outline-none focus:border-dw-accent disabled:opacity-50"
        />
        <button
          onClick={handleYouTube}
          disabled={isLoading || !ytUrl.trim()}
          className="bg-dw-surface2 border border-dw-border px-4 py-2 text-sm text-dw-accent uppercase tracking-wider hover:bg-dw-border disabled:opacity-50 disabled:text-dw-muted"
        >
          {isLoading ? "..." : "FETCH"}
        </button>
      </div>

      {ytError && (
        <p className="mt-2 text-dw-danger text-xs uppercase tracking-wider">
          {ytError}
        </p>
      )}
    </div>
  );
}
