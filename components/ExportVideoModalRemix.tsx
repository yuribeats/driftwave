"use client";

import { useRef, useState } from "react";
import { generateCover } from "../lib/cover-generator";

interface Props {
  audioBlob: Blob;
  defaultFilename: string;
  onClose: () => void;
}

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
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const [customImage, setCustomImage] = useState<string | null>(null);
  const [customImageName, setCustomImageName] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCustomImage(URL.createObjectURL(file));
    setCustomImageName(file.name);
  };

  const handleExport = async () => {
    if (!artist.trim() || !title.trim()) return;

    setExporting(true);

    try {
      // Upload audio to Pinata (bypasses body size limit)
      setStatus("UPLOADING AUDIO...");
      const audioCid = await uploadToPinata(audioBlob, "audio.webm");

      // Generate cover image
      setStatus("GENERATING COVER...");
      const coverBlob = await generateCover(artist.trim(), title.trim(), customImage || undefined);

      // Send CID + cover to generate-video
      setStatus("GENERATING VIDEO...");
      const formData = new FormData();
      formData.append("audioCid", audioCid);
      formData.append("image", coverBlob, "cover.png");
      formData.append("artist", artist.trim());
      formData.append("title", title.trim());

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

      // Download
      setStatus("DOWNLOADING...");
      const a = document.createElement("a");
      a.href = data.url;
      a.download = `${defaultFilename}.mp4`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setStatus("DONE");
      setTimeout(() => onClose(), 2000);
    } catch (e) {
      console.error("[EXPORT] Error:", e);
      setStatus("ERROR: " + (e instanceof Error ? e.message : "FAILED"));
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

        <button
          onClick={handleExport}
          disabled={exporting || !artist.trim() || !title.trim()}
          className="border-2 border-[var(--accent-gold)] px-4 py-3 text-[12px] uppercase tracking-wider disabled:opacity-30"
          style={{ fontFamily: "var(--font-tech)", color: "var(--accent-gold)", background: "transparent" }}
        >
          {exporting ? status : "EXPORT MP4"}
        </button>

        {!exporting && status && (
          <div className="text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: status.startsWith("ERROR") ? "#c82828" : "var(--accent-gold)" }}>
            {status}
          </div>
        )}

        <div className="text-[9px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>
          GENERATES A VIDEO WITH YOUR MIX + COVER ART
        </div>
      </div>
    </div>
  );
}
