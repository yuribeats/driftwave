"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface GalleryItem {
  id: string;
  cid: string;
  url: string;
  artist: string;
  title: string;
  createdAt: string;
}

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/gallery")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-[1100px] flex flex-col gap-5">
        <div className="console flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center gap-4 px-3 boot-stagger boot-delay-1">
            <div className="w-6 h-6 border-[3px] border-[var(--text-dark)] rounded-[4px] relative">
              <div className="absolute inset-[4px] bg-[var(--text-dark)]" />
            </div>
            <span
              className="text-lg sm:text-xl tracking-[2px] uppercase"
              style={{ color: "var(--text-dark)", fontFamily: "var(--font-display)" }}
            >
              GALLERY
            </span>
            <div className="ml-auto">
              <Link
                href="/"
                className="text-[8px] uppercase tracking-[0.15em] px-2 py-0.5 border border-[#777]"
                style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent" }}
              >
                BACK
              </Link>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div
              className="text-[11px] uppercase tracking-wider text-center py-8"
              style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}
            >
              LOADING...
            </div>
          ) : items.length === 0 ? (
            <div
              className="text-[11px] uppercase tracking-wider text-center py-8"
              style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", opacity: 0.5 }}
            >
              NO EXPORTS YET
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 boot-stagger boot-delay-2">
              {items.map((item) => (
                <div key={item.id} className="zone-inset flex flex-col gap-2">
                  <video
                    src={item.url}
                    controls
                    preload="metadata"
                    className="w-full aspect-square object-cover"
                    style={{ background: "#000" }}
                  />
                  <div className="flex flex-col gap-0.5 px-1">
                    <span
                      className="text-[11px] uppercase tracking-wider truncate"
                      style={{ fontFamily: "var(--font-tech)", color: "var(--accent-gold)" }}
                    >
                      {item.artist}
                    </span>
                    <span
                      className="text-[10px] uppercase tracking-wider truncate"
                      style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}
                    >
                      {item.title}
                    </span>
                    <span
                      className="text-[8px] uppercase tracking-wider"
                      style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", opacity: 0.4 }}
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
