"use client";

import { useEffect, useState } from "react";
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

const textStyle: React.CSSProperties = { fontFamily: "Helvetica, Arial, sans-serif", fontWeight: 700, color: "#000" };

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const isAdmin = searchParams.get("admin") === "1";
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    fetch("/api/gallery")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
