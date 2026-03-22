"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

interface GalleryItem {
  id: string;
  cid: string;
  url: string;
  artist: string;
  title: string;
  createdAt: string;
}

interface PlaylistTrack {
  videoId: string;
  title: string;
  status: "pending" | "downloading" | "done" | "error";
  error?: string;
}

const textStyle: React.CSSProperties = { fontFamily: "Helvetica, Arial, sans-serif", fontWeight: 700, color: "#000" };

export default function GalleryPage() {
  return (
    <Suspense>
      <GalleryContent />
    </Suspense>
  );
}

function GalleryContent() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const isAdmin = searchParams.get("admin") === "1";
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<Record<string, string>>({});
  const [tiktokUploading, setTiktokUploading] = useState<string | null>(null);
  const [tiktokResult, setTiktokResult] = useState<Record<string, string>>({});

  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistTracks, setPlaylistTracks] = useState<PlaylistTrack[]>([]);
  const [playlistFetching, setPlaylistFetching] = useState(false);
  const [playlistDownloading, setPlaylistDownloading] = useState(false);
  const [playlistProgress, setPlaylistProgress] = useState({ current: 0, total: 0 });
  const [playlistError, setPlaylistError] = useState("");

  useEffect(() => {
    fetch("/api/gallery")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleYouTubeUpload(item: GalleryItem) {
    setUploading(item.id);
    try {
      const res = await fetch("/api/youtube/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, artist: item.artist, title: item.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "UPLOAD FAILED");
      setUploadResult((prev) => ({ ...prev, [item.id]: data.youtubeUrl }));
    } catch (e) {
      setUploadResult((prev) => ({ ...prev, [item.id]: e instanceof Error ? e.message : "FAILED" }));
    }
    setUploading(null);
  }

  async function handleTikTokUpload(item: GalleryItem) {
    setTiktokUploading(item.id);
    try {
      const res = await fetch("/api/tiktok/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, artist: item.artist, title: item.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "UPLOAD FAILED");
      setTiktokResult((prev) => ({ ...prev, [item.id]: "SENT TO TIKTOK" }));
    } catch (e) {
      setTiktokResult((prev) => ({ ...prev, [item.id]: e instanceof Error ? e.message : "FAILED" }));
    }
    setTiktokUploading(null);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch("/api/gallery", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }
    } catch {}
    setDeleting(null);
  }

  async function fetchPlaylist() {
    if (!playlistUrl.trim()) return;
    setPlaylistFetching(true);
    setPlaylistError("");
    setPlaylistTracks([]);
    try {
      const res = await fetch("/api/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: playlistUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "FAILED");
      setPlaylistTracks(
        data.items.map((item: { videoId: string; title: string }) => ({ ...item, status: "pending" }))
      );
    } catch (e) {
      setPlaylistError(e instanceof Error ? e.message : "FAILED TO FETCH PLAYLIST");
    }
    setPlaylistFetching(false);
  }

  async function downloadTrack(index: number) {
    const track = playlistTracks[index];
    setPlaylistTracks((prev) => prev.map((t, i) => (i === index ? { ...t, status: "downloading", error: undefined } : t)));
    try {
      const res = await fetch("/api/cobalt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${track.videoId}` }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const title = res.headers.get("X-Audio-Title") || track.title;
      const safeName = title.replace(/[^\w\s-]/g, "").trim() || "track";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${safeName}.mp3`;
      a.click();
      URL.revokeObjectURL(a.href);
      setPlaylistTracks((prev) => prev.map((t, i) => (i === index ? { ...t, status: "done" } : t)));
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "DOWNLOAD FAILED";
      setPlaylistTracks((prev) => prev.map((t, i) => (i === index ? { ...t, status: "error", error: msg } : t)));
      return false;
    }
  }

  async function downloadAllTracks() {
    setPlaylistDownloading(true);
    const pending = playlistTracks.filter((t) => t.status !== "done");
    setPlaylistProgress({ current: 0, total: pending.length });
    for (let i = 0; i < playlistTracks.length; i++) {
      if (playlistTracks[i].status === "done") continue;
      await downloadTrack(i);
      setPlaylistProgress((prev) => ({ ...prev, current: prev.current + 1 }));
    }
    setPlaylistDownloading(false);
  }

  const plDoneCount = playlistTracks.filter((t) => t.status === "done").length;
  const plErrorCount = playlistTracks.filter((t) => t.status === "error").length;

  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-8" style={{ background: "#fff" }}>
      <div className="w-full max-w-[1100px] flex flex-col gap-5">
        <div className="flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center gap-4 px-3">
            <span
              className="text-lg sm:text-xl tracking-[2px] uppercase"
              style={textStyle}
            >
              GALLERY
            </span>
            <a
              href="https://www.youtube.com/@SLOWANDREVERBEDMACHINE/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] uppercase tracking-wider border-2 border-black px-2 py-1"
              style={{ ...textStyle, fontSize: "9px", background: "transparent" }}
            >
              YOUTUBE
            </a>
            <div className="ml-auto flex gap-2">
              {isAdmin && (
                <button
                  onClick={() => setEditMode(!editMode)}
                  className="text-[10px] uppercase tracking-[0.15em] px-3 py-1 border-2 border-black"
                  style={{ ...textStyle, fontSize: "10px", background: editMode ? "#000" : "transparent", color: editMode ? "#fff" : "#000" }}
                >
                  {editMode ? "DONE" : "EDIT"}
                </button>
              )}
              <Link
                href="/"
                className="text-[10px] uppercase tracking-[0.15em] px-3 py-1 border-2 border-black"
                style={{ ...textStyle, fontSize: "10px", background: "transparent" }}
              >
                BACK
              </Link>
            </div>
          </div>

          {/* Playlist Downloader (admin only) */}
          {isAdmin && (
            <div className="flex flex-col gap-3 px-3 py-4 border-2 border-black">
              <span className="text-[11px] uppercase tracking-[0.15em]" style={textStyle}>
                PLAYLIST DOWNLOADER
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={playlistUrl}
                  onChange={(e) => setPlaylistUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchPlaylist()}
                  placeholder="PASTE YOUTUBE PLAYLIST URL"
                  className="flex-1 px-3 py-2 border-2 border-black text-[11px] uppercase tracking-wider outline-none"
                  style={{ ...textStyle, fontSize: "11px", background: "transparent" }}
                />
                <button
                  onClick={fetchPlaylist}
                  disabled={playlistFetching || !playlistUrl.trim()}
                  className="px-4 py-2 border-2 border-black text-[11px] uppercase tracking-wider"
                  style={{ ...textStyle, fontSize: "11px", background: playlistFetching ? "#000" : "transparent", color: playlistFetching ? "#fff" : "#000", opacity: !playlistUrl.trim() ? 0.3 : 1 }}
                >
                  {playlistFetching ? "LOADING..." : "FETCH"}
                </button>
              </div>
              {playlistError && (
                <span className="text-[10px] uppercase tracking-wider" style={{ ...textStyle, fontSize: "10px", color: "#c82828" }}>
                  {playlistError}
                </span>
              )}
              {playlistTracks.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] uppercase tracking-wider" style={{ ...textStyle, fontSize: "11px", opacity: 0.5 }}>
                      {playlistTracks.length} TRACKS{plDoneCount > 0 && ` / ${plDoneCount} DONE`}{plErrorCount > 0 && ` / ${plErrorCount} FAILED`}
                    </span>
                    <button
                      onClick={downloadAllTracks}
                      disabled={playlistDownloading || plDoneCount === playlistTracks.length}
                      className="ml-auto px-4 py-2 border-2 border-black text-[11px] uppercase tracking-wider"
                      style={{ ...textStyle, fontSize: "11px", background: playlistDownloading ? "#000" : "transparent", color: playlistDownloading ? "#fff" : "#000", opacity: plDoneCount === playlistTracks.length ? 0.3 : 1 }}
                    >
                      {playlistDownloading ? `DOWNLOADING ${playlistProgress.current}/${playlistProgress.total}` : plDoneCount > 0 && plDoneCount < playlistTracks.length ? "DOWNLOAD REMAINING" : "DOWNLOAD ALL"}
                    </button>
                  </div>
                  <div className="flex flex-col border-2 border-black divide-y-2 divide-black max-h-[300px] overflow-y-auto">
                    {playlistTracks.map((track, i) => (
                      <div
                        key={track.videoId}
                        className="flex items-center gap-3 px-3 py-2"
                        style={{ background: track.status === "done" ? "#f0f0f0" : track.status === "error" ? "#fff5f5" : "transparent" }}
                      >
                        <span className="text-[10px] uppercase tracking-wider shrink-0 w-6 text-right" style={{ ...textStyle, fontSize: "10px", opacity: 0.3 }}>
                          {i + 1}
                        </span>
                        <span className="text-[11px] uppercase tracking-wider truncate flex-1" style={{ ...textStyle, fontSize: "11px", opacity: track.status === "done" ? 0.4 : 1 }}>
                          {track.title}
                        </span>
                        <span className="text-[9px] uppercase tracking-wider shrink-0" style={{ ...textStyle, fontSize: "9px", color: track.status === "done" ? "#228B22" : track.status === "error" ? "#c82828" : track.status === "downloading" ? "#000" : "transparent" }}>
                          {track.status === "downloading" ? "..." : track.status === "done" ? "DONE" : track.status === "error" ? (track.error || "FAILED") : ""}
                        </span>
                        {track.status === "error" && !playlistDownloading && (
                          <button
                            onClick={() => downloadTrack(i)}
                            className="text-[9px] uppercase tracking-wider border border-black px-2 py-0.5 shrink-0"
                            style={{ ...textStyle, fontSize: "9px", background: "transparent" }}
                          >
                            RETRY
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Content */}
          {loading ? (
            <div
              className="text-[11px] uppercase tracking-wider text-center py-8"
              style={textStyle}
            >
              LOADING...
            </div>
          ) : items.length === 0 ? (
            <div
              className="text-[11px] uppercase tracking-wider text-center py-8"
              style={{ ...textStyle, opacity: 0.5 }}
            >
              NO EXPORTS YET
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item) => (
                <div key={item.id} className="flex flex-col gap-2 border-2 border-black p-2 relative">
                  {editMode && (
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={deleting === item.id}
                      className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center border-2 border-black"
                      style={{ ...textStyle, fontSize: "14px", background: "#fff", lineHeight: 1 }}
                    >
                      {deleting === item.id ? "..." : "X"}
                    </button>
                  )}
                  <video
                    src={item.url}
                    controls
                    preload="metadata"
                    className="w-full aspect-square object-cover"
                    style={{ background: "#000" }}
                    onError={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span
                      className="text-[13px] uppercase tracking-wider truncate"
                      style={textStyle}
                    >
                      {item.artist}
                    </span>
                    <span
                      className="text-[11px] uppercase tracking-wider truncate"
                      style={{ ...textStyle, opacity: 0.7 }}
                    >
                      {item.title}
                    </span>
                    <span
                      className="text-[9px] uppercase tracking-wider"
                      style={{ ...textStyle, opacity: 0.4 }}
                    >
                      {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="mt-1 flex gap-2 flex-wrap">
                      {uploadResult[item.id] ? (
                        uploadResult[item.id].startsWith("http") ? (
                          <a
                            href={uploadResult[item.id]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[9px] uppercase tracking-wider"
                            style={{ ...textStyle, fontSize: "9px", color: "#228B22" }}
                          >
                            YOUTUBE OK
                          </a>
                        ) : (
                          <span className="text-[9px] uppercase tracking-wider" style={{ ...textStyle, fontSize: "9px", color: "#c82828" }}>
                            {uploadResult[item.id]}
                          </span>
                        )
                      ) : (
                        <button
                          onClick={() => handleYouTubeUpload(item)}
                          disabled={uploading === item.id}
                          className="text-[9px] uppercase tracking-wider border border-black px-2 py-1"
                          style={{ ...textStyle, fontSize: "9px", background: "transparent", opacity: uploading === item.id ? 0.4 : 1 }}
                        >
                          {uploading === item.id ? "UPLOADING..." : "YOUTUBE"}
                        </button>
                      )}
                      {tiktokResult[item.id] ? (
                        <span
                          className="text-[9px] uppercase tracking-wider"
                          style={{ ...textStyle, fontSize: "9px", color: tiktokResult[item.id] === "SENT TO TIKTOK" ? "#228B22" : "#c82828" }}
                        >
                          {tiktokResult[item.id]}
                        </span>
                      ) : (
                        <button
                          onClick={() => handleTikTokUpload(item)}
                          disabled={tiktokUploading === item.id}
                          className="text-[9px] uppercase tracking-wider border border-black px-2 py-1"
                          style={{ ...textStyle, fontSize: "9px", background: "transparent", opacity: tiktokUploading === item.id ? 0.4 : 1 }}
                        >
                          {tiktokUploading === item.id ? "UPLOADING..." : "TIKTOK"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-4 justify-center py-4">
          <Link href="/terms" className="text-[11px] uppercase tracking-wider" style={{ ...textStyle, fontSize: "11px", opacity: 0.5 }}>
            TERMS
          </Link>
          <Link href="/privacy" className="text-[11px] uppercase tracking-wider" style={{ ...textStyle, fontSize: "11px", opacity: 0.5 }}>
            PRIVACY
          </Link>
        </div>
      </div>
    </main>
  );
}
