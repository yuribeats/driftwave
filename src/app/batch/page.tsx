"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRemixStore } from "../../../lib/remix-store";
import { BatchStyle, artistKey } from "../../../lib/batch-presets";
import { generateCover } from "../../../lib/cover-generator";

interface EverysongResult {
  artist: string;
  title: string;
  bpm: number | null;
  key: string | null;
  noteIndex: number | null;
  mode: "major" | "minor" | null;
}

const inputStyle: React.CSSProperties = {
  fontFamily: "Arial, sans-serif",
  fontWeight: "bold",
  fontSize: "11px",
  letterSpacing: "1px",
  color: "#000",
  background: "transparent",
  border: "1px solid #555",
  padding: "6px 10px",
  outline: "none",
  width: "100%",
  textTransform: "uppercase",
};

const btnStyle = (active?: boolean, green?: boolean): React.CSSProperties => ({
  fontFamily: "Arial, sans-serif",
  fontWeight: "bold",
  fontSize: "11px",
  letterSpacing: "1px",
  background: active ? "#000" : "transparent",
  color: active ? "#fff" : green ? "#228B22" : "#000",
  border: `1px solid ${active ? "#000" : "#555"}`,
  padding: "6px 14px",
  textTransform: "uppercase",
  cursor: "default",
  whiteSpace: "nowrap",
});

const labelStyle: React.CSSProperties = {
  fontFamily: "Arial, sans-serif",
  fontWeight: "bold",
  fontSize: "10px",
  letterSpacing: "1px",
  color: "#000",
  textTransform: "uppercase",
};

const sectionHead: React.CSSProperties = {
  fontFamily: "Arial, sans-serif",
  fontWeight: "bold",
  fontSize: "11px",
  letterSpacing: "2px",
  color: "#000",
  textTransform: "uppercase",
  borderBottom: "1px solid #000",
  paddingBottom: "4px",
  marginBottom: "8px",
};

const dividerStyle: React.CSSProperties = {
  borderTop: "1px solid #ccc",
  margin: "16px 0",
};

async function uploadToPinata(blob: Blob, filename: string): Promise<string> {
  const urlRes = await fetch("/api/pinata-upload-url", { method: "POST" });
  if (!urlRes.ok) throw new Error("Failed to get Pinata upload URL");
  const { url } = await urlRes.json();
  const fd = new FormData();
  fd.append("file", blob, filename);
  const uploadRes = await fetch(url, { method: "POST", body: fd });
  if (!uploadRes.ok) throw new Error(`Pinata upload failed: ${uploadRes.status}`);
  const data = await uploadRes.json();
  return data.data?.cid || data.cid;
}

function TrackSearch({
  label,
  pick,
  onPick,
}: {
  label: string;
  pick: EverysongResult | null;
  onPick: (r: EverysongResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EverysongResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchErr("");
    setResults([]);
    try {
      const res = await fetch(`/api/everysong/search?q=${encodeURIComponent(query)}&limit=5`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results ?? []);
      if ((data.results ?? []).length === 0) setSearchErr("NO RESULTS");
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : "SEARCH FAILED");
    }
    setSearching(false);
  }, [query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={sectionHead}>{label}</div>

      <div style={{ display: "flex", gap: "6px" }}>
        <input
          style={inputStyle}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="SEARCH EVERYSONG..."
        />
        <button style={btnStyle(false)} onClick={handleSearch} disabled={searching}>
          {searching ? "..." : "SEARCH"}
        </button>
      </div>

      {searchErr && (
        <div style={{ ...labelStyle, color: "#c00" }}>{searchErr}</div>
      )}

      {results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {results.map((r, i) => (
            <div
              key={i}
              onClick={() => onPick(r)}
              style={{
                padding: "6px 10px",
                border: `1px solid ${pick?.artist === r.artist && pick?.title === r.title ? "#000" : "#bbb"}`,
                background: pick?.artist === r.artist && pick?.title === r.title ? "#000" : "transparent",
                cursor: "default",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <span style={{
                fontFamily: "Arial, sans-serif",
                fontWeight: "bold",
                fontSize: "11px",
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                color: pick?.artist === r.artist && pick?.title === r.title ? "#fff" : "#000",
              }}>
                {r.artist} — {r.title}
              </span>
              <span style={{
                fontFamily: "Arial, sans-serif",
                fontWeight: "bold",
                fontSize: "10px",
                letterSpacing: "0.5px",
                color: pick?.artist === r.artist && pick?.title === r.title ? "#aaa" : "#666",
                whiteSpace: "nowrap",
              }}>
                {r.bpm ? `${r.bpm} BPM` : ""}{r.bpm && r.key ? " · " : ""}{r.key ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {pick && (
        <div style={{ ...labelStyle, color: "#228B22" }}>
          SELECTED: {pick.artist} — {pick.title}
        </div>
      )}
    </div>
  );
}

export default function BatchPage() {
  const router = useRouter();
  const loadDeck = useRemixStore((s) => s.loadDeck);
  const applyStylePreset = useRemixStore((s) => s.applyStylePreset);
  const renderToBlob = useRemixStore((s) => s.renderToBlob);

  const [instPick, setInstPick] = useState<EverysongResult | null>(null);
  const [acapPick, setAcapPick] = useState<EverysongResult | null>(null);
  const [style, setStyle] = useState<BatchStyle>("mashup");
  const [mode, setMode] = useState<"automatic" | "manual">("automatic");
  const [status, setStatus] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ galleryUrl: string; youtubeUrl?: string } | null>(null);
  const [error, setError] = useState("");

  const canProcess = !!instPick && !!acapPick && !processing;

  const handleProcess = useCallback(async () => {
    if (!instPick || !acapPick) return;
    setProcessing(true);
    setError("");
    setResult(null);

    const artist = `${artistKey(instPick.artist)}x${artistKey(acapPick.artist)}`;
    const title = `${instPick.title} / ${acapPick.title}`;

    try {
      // Load both decks concurrently
      setStatus("LOADING TRACKS...");
      console.log("[batch] loading decks concurrently");
      await Promise.all([
        loadDeck("A", instPick.artist, instPick.title),
        loadDeck("B", acapPick.artist, acapPick.title),
      ]);
      console.log("[batch] both decks loaded");

      // Apply style preset to both decks
      setStatus(`APPLYING ${style.toUpperCase()} PRESET...`);
      applyStylePreset(style);
      console.log(`[batch] applied preset: ${style}`);

      if (mode === "manual") {
        setStatus("READY — OPENING MACHINE...");
        console.log("[batch] manual mode — navigating to machine");
        router.push("/");
        return;
      }

      // Automatic: render → upload → generate video → gallery
      setStatus("RENDERING MIX...");
      const wavBlob = await renderToBlob();
      if (!wavBlob) throw new Error("Render produced no audio");
      console.log(`[batch] rendered WAV: ${(wavBlob.size / 1024 / 1024).toFixed(2)} MB`);

      setStatus("UPLOADING AUDIO...");
      const audioCid = await uploadToPinata(wavBlob, "mix.wav");
      console.log(`[batch] audio uploaded to Pinata: ${audioCid}`);

      setStatus("GENERATING COVER...");
      const coverBlob = await generateCover(artist, title);

      setStatus("GENERATING VIDEO...");
      const fd = new FormData();
      fd.append("audioCid", audioCid);
      fd.append("image", coverBlob, "cover.png");
      fd.append("artist", artist);
      fd.append("title", title);
      fd.append("watermark", "true");

      const vidRes = await fetch("/api/generate-video", { method: "POST", body: fd });
      if (!vidRes.ok) {
        const e = await vidRes.json();
        throw new Error(e.error || `generate-video failed (${vidRes.status})`);
      }
      const { url: galleryUrl } = await vidRes.json();
      console.log(`[batch] video in gallery: ${galleryUrl}`);

      setStatus("UPLOADING TO YOUTUBE...");
      let youtubeUrl: string | undefined;
      try {
        const ytRes = await fetch("/api/youtube/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: galleryUrl, artist, title }),
        });
        if (ytRes.ok) {
          const ytData = await ytRes.json();
          youtubeUrl = ytData.youtubeUrl;
          console.log(`[batch] YouTube: ${youtubeUrl}`);
        } else {
          console.warn("[batch] YouTube upload failed — gallery only");
        }
      } catch (e) {
        console.warn("[batch] YouTube upload error:", e);
      }

      setResult({ galleryUrl, youtubeUrl });
      setStatus("DONE");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "PROCESS FAILED";
      console.error("[batch] error:", e);
      setError(msg);
      setStatus("");
    }

    setProcessing(false);
  }, [instPick, acapPick, style, mode, loadDeck, applyStylePreset, renderToBlob, router]);

  return (
    <main style={{ minHeight: "100vh", background: "#f0ebe0", padding: "32px 24px" }}>
      <div style={{ maxWidth: "720px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>

        {/* Header */}
        <div style={{
          fontFamily: "Arial, sans-serif",
          fontWeight: "bold",
          fontSize: "18px",
          letterSpacing: "4px",
          textTransform: "uppercase",
          color: "#000",
          borderBottom: "2px solid #000",
          paddingBottom: "12px",
        }}>
          REMIX
        </div>

        {/* Instrumental search */}
        <TrackSearch label="INSTRUMENTAL" pick={instPick} onPick={setInstPick} />

        <div style={dividerStyle} />

        {/* Acapella search */}
        <TrackSearch label="ACAPELLA" pick={acapPick} onPick={setAcapPick} />

        <div style={dividerStyle} />

        {/* Style */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={sectionHead}>STYLE</div>
          <div style={{ display: "flex", gap: "6px" }}>
            {(["mashup", "slowed", "chipmunk"] as BatchStyle[]).map((s) => (
              <button key={s} style={btnStyle(style === s)} onClick={() => setStyle(s)}>
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div style={dividerStyle} />

        {/* Mode */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={sectionHead}>MODE</div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button style={btnStyle(mode === "automatic")} onClick={() => setMode("automatic")}>
              AUTOMATIC
            </button>
            <button style={btnStyle(mode === "manual")} onClick={() => setMode("manual")}>
              MANUAL
            </button>
          </div>
          <div style={{ ...labelStyle, color: "#555", fontWeight: "normal" }}>
            {mode === "automatic"
              ? "RENDERS AND POSTS TO GALLERY DIRECTLY"
              : "OPENS MACHINE WITH TRACKS AND PRESET LOADED — ADJUST AND EXPORT MANUALLY"}
          </div>
        </div>

        <div style={dividerStyle} />

        {/* Process */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {instPick && acapPick && (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div style={{ ...labelStyle, color: "#228B22" }}>
                ARTIST: {artistKey(instPick.artist).toUpperCase()}x{artistKey(acapPick.artist).toUpperCase()}
              </div>
              <div style={{ ...labelStyle, color: "#228B22" }}>
                TITLE: {instPick.title.toUpperCase()} / {acapPick.title.toUpperCase()}
              </div>
            </div>
          )}

          <button
            style={btnStyle(!canProcess ? false : true, false)}
            onClick={handleProcess}
            disabled={!canProcess}
          >
            {processing ? status || "PROCESSING..." : mode === "manual" ? "LOAD TO MACHINE" : "PROCESS"}
          </button>

          {error && (
            <div style={{ ...labelStyle, color: "#c00" }}>{error}</div>
          )}
        </div>

        {/* Result */}
        {result && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "2px solid #228B22", paddingTop: "16px" }}>
            <div style={{ ...sectionHead, color: "#228B22", borderBottomColor: "#228B22" }}>DONE</div>
            <a
              href={result.galleryUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...btnStyle(false, true), display: "inline-block", textDecoration: "none" }}
            >
              VIEW IN GALLERY
            </a>
            {result.youtubeUrl && (
              <a
                href={result.youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...btnStyle(false, true), display: "inline-block", textDecoration: "none" }}
              >
                VIEW ON YOUTUBE
              </a>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
