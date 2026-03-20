"use client";

import { useState } from "react";
import { generateCover } from "../lib/cover-generator";

interface Props {
  audioBlob: Blob;
  defaultFilename: string;
  onClose: () => void;
}

export default function ExportVideoModalRemix({ audioBlob, defaultFilename, onClose }: Props) {
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!artist.trim() || !title.trim()) return;

    setExporting(true);

    try {
      // Step 1: Generate cover image
      setStatus("GENERATING COVER...");
      const coverBlob = await generateCover(artist.trim(), title.trim());

      // Step 2: Send to generate-video API
      setStatus("GENERATING VIDEO...");
      const formData = new FormData();
      formData.append("audio", audioBlob, "audio.wav");
      formData.append("image", coverBlob, "cover.png");

      const res = await fetch("/api/generate-video", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "VIDEO GENERATION FAILED");
      }

      // Step 3: Download the video
      setStatus("DOWNLOADING...");
      const videoBlob = await res.blob();
      const filename = `${defaultFilename}.mp4`;

      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus("DONE");
      setTimeout(() => onClose(), 2000);
    } catch (e) {
      console.error(e);
      setStatus("ERROR: " + (e instanceof Error ? e.message : "FAILED"));
      setTimeout(() => setStatus(""), 5000);
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !exporting) onClose(); }}
    >
      <div className="console w-full max-w-[440px] mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span
            className="text-sm tracking-[2px] uppercase"
            style={{ color: "var(--text-dark)", fontFamily: "var(--font-display)" }}
          >
            EXPORT MP4
          </span>
          {!exporting && (
            <button
              onClick={onClose}
              className="text-[10px] uppercase tracking-wider border border-[#333] px-2 py-1"
              style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent" }}
            >
              CLOSE
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>
            ARTIST
          </span>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            disabled={exporting}
            placeholder="ARTIST NAME"
            className="bg-transparent border border-[#333] px-3 py-2 text-[13px] uppercase tracking-wider"
            style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", outline: "none" }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>
            TITLE
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={exporting}
            placeholder="TRACK TITLE"
            className="bg-transparent border border-[#333] px-3 py-2 text-[13px] uppercase tracking-wider"
            style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", outline: "none" }}
          />
        </div>

        <button
          onClick={handleExport}
          disabled={exporting || !artist.trim() || !title.trim()}
          className="border-2 border-[var(--accent-gold)] px-4 py-3 text-[12px] uppercase tracking-wider disabled:opacity-30"
          style={{ fontFamily: "var(--font-tech)", color: "var(--accent-gold)", background: "transparent" }}
        >
          {exporting ? status : "EXPORT MP4"}
        </button>

        <div className="text-[9px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>
          GENERATES A VIDEO WITH YOUR RECORDED MIX + RANDOM COVER ART
        </div>
      </div>
    </div>
  );
}
