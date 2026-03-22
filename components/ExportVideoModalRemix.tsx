"use client";

import { useRef, useState } from "react";
import { generateCover } from "../lib/cover-generator";

interface Props {
  audioBlob: Blob;
  defaultFilename: string;
  onClose: () => void;
}

const STEPS = [
  "UPLOADING AUDIO...",
  "GENERATING COVER...",
  "GENERATING VIDEO...",
  "DOWNLOADING...",
  "DONE",
] as const;

async function uploadToPinata(blob: Blob, filename: string): Promise<string> {
  const urlRes = await fetch("/api/pinata-upload-url", { method: "POST" });
  if (!urlRes.ok) throw new Error("Failed to get upload URL");
  const { url } = await urlRes.json();

  const formData = new FormData();
  formData.append("file", blob, filename);

  const uploadRes = await fetch(url, { method: "POST", body: formData });
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Upload failed: ${uploadRes.status} ${text.substring(0, 100)}`);
  }

  const data = await uploadRes.json();
  return data.data?.cid || data.cid;
}

export default function ExportVideoModalRemix({ audioBlob, defaultFilename, onClose }: Props) {
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [step, setStep] = useState(-1);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [customImage, setCustomImage] = useState<string | null>(null);
  const [customImageName, setCustomImageName] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);

  const progress = step < 0 ? 0 : Math.min(((step + 1) / STEPS.length) * 100, 100);
  const status = step >= 0 && step < STEPS.length ? STEPS[step] : "";

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCustomImage(URL.createObjectURL(file));
    setCustomImageName(file.name);
  };

  const handleExport = async () => {
    if (!artist.trim() || !title.trim()) return;

    setExporting(true);
    setError("");

    try {
      // Step 0: Upload audio to Pinata
      setStep(0);
      const audioCid = await uploadToPinata(audioBlob, "audio.webm");

      // Step 1: Generate cover
      setStep(1);
      const coverBlob = await generateCover(artist.trim(), title.trim(), customImage || undefined);

      // Step 2: Generate video
      setStep(2);
      const formData = new FormData();
      formData.append("audioCid", audioCid);
      formData.append("image", coverBlob, "cover.png");
      formData.append("artist", artist.trim());
      formData.append("title", title.trim());
      formData.append("watermark", "true");

      const res = await fetch("/api/generate-video", {
        method: "POST",
        body: formData,
      });

      const text = await res.text();
      let data: { url?: string; error?: string };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text.substring(0, 100) || `SERVER ${res.status}`);
      }
      if (!res.ok || !data.url) {
        throw new Error(data.error || `SERVER ${res.status}`);
      }

      // Step 3: Download
      setStep(3);
      const a = document.createElement("a");
      a.href = data.url;
      a.download = `${defaultFilename}.mp4`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Step 4: Done
      setStep(4);
      setTimeout(() => onClose(), 2000);
    } catch (e) {
      console.error("[EXPORT] Error:", e);
      setError(e instanceof Error ? e.message : "FAILED");
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

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>
            COVER IMAGE (OPTIONAL)
          </span>
          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={exporting}
            className="bg-transparent border border-[#333] px-3 py-2 text-[11px] uppercase tracking-wider text-left"
            style={{ fontFamily: "var(--font-tech)", color: customImage ? "var(--accent-gold)" : "var(--text-dark)", outline: "none" }}
          >
            {customImage ? customImageName.toUpperCase() : "RANDOM (CLICK TO UPLOAD)"}
          </button>
          {customImage && (
            <button
              onClick={() => { setCustomImage(null); setCustomImageName(""); }}
              className="text-[9px] uppercase tracking-wider self-start"
              style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", opacity: 0.5, background: "transparent", border: "none", padding: 0 }}
            >
              CLEAR
            </button>
          )}
        </div>

        {/* Progress bar */}
        {exporting && (
          <div className="flex flex-col gap-2">
            <div
              className="relative h-[6px] w-full"
              style={{ background: "#1a1a1a", boxShadow: "inset 1px 1px 3px rgba(0,0,0,0.6)" }}
            >
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${progress}%`,
                  background: "var(--accent-gold)",
                  transition: "width 0.4s ease-out",
                }}
              />
            </div>
            <span
              className="text-[10px] uppercase tracking-wider text-center"
              style={{ fontFamily: "var(--font-tech)", color: "var(--accent-gold)" }}
            >
              {status}
            </span>
          </div>
        )}

        {!exporting && (
          <button
            onClick={handleExport}
            disabled={!artist.trim() || !title.trim()}
            className="border-2 border-[var(--accent-gold)] px-4 py-3 text-[12px] uppercase tracking-wider disabled:opacity-30"
            style={{ fontFamily: "var(--font-tech)", color: "var(--accent-gold)", background: "transparent" }}
          >
            EXPORT MP4
          </button>
        )}

        {error && (
          <div className="text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: "#c82828" }}>
            ERROR: {error}
          </div>
        )}

        <div className="text-[9px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>
          GENERATES A VIDEO WITH YOUR MIX + COVER ART
        </div>
      </div>
    </div>
  );
}
