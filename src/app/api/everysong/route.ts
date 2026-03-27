import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@libsql/client";

const KEY_MAP: Record<string, number> = {
  "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3,
  "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8,
  "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
};

function parseKey(keyStr: string): { noteIndex: number; mode: "major" | "minor" } | null {
  if (!keyStr) return null;
  const parts = keyStr.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const note = parts[0];
  const mode = parts[1].toLowerCase() === "major" ? "major" : "minor";
  const noteIndex = KEY_MAP[note];
  if (noteIndex === undefined) return null;
  return { noteIndex, mode };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(normalize(a).split(" ").filter(Boolean));
  const wordsB = normalize(b).split(" ").filter(Boolean);
  return wordsB.filter((w) => wordsA.has(w)).length / Math.max(wordsA.size, 1);
}

function matchScore(
  track: { artist: string; title: string },
  artist: string,
  title: string
): number {
  const artistScore = artist ? wordOverlap(artist, track.artist) : 0.5;
  const titleScore = title ? wordOverlap(title, track.title) : 0.5;
  return artistScore * 0.5 + titleScore * 0.5;
}

export async function GET(request: NextRequest) {
  const artist = request.nextUrl.searchParams.get("artist") ?? "";
  const title = request.nextUrl.searchParams.get("title") ?? "";
  const q = request.nextUrl.searchParams.get("q") ?? "";

  if (!artist && !title && !q) {
    return NextResponse.json({ error: "Missing artist, title, or q" }, { status: 400 });
  }

  const db = createClient({
    url: process.env.TURSO_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  try {
    let sql: string;
    const args: (string | number)[] = [];

    if (q && !artist && !title) {
      // Free-form search via FTS5
      const safe = q.replace(/['"*]/g, " ").trim();
      sql = `
        SELECT t.artist, t.title, t.bpm, t.key_name, COALESCE(t.popularity, t.hq) AS pop
        FROM tracks_fts f
        JOIN tracks t ON t.id = f.rowid
        WHERE tracks_fts MATCH ?
        ORDER BY pop DESC
        LIMIT 20
      `;
      args.push(safe);
    } else {
      const conditions: string[] = [];
      if (artist) { conditions.push("LOWER(artist) LIKE LOWER(?)"); args.push(`%${artist}%`); }
      if (title) { conditions.push("LOWER(title) LIKE LOWER(?)"); args.push(`%${title}%`); }
      sql = `
        SELECT artist, title, bpm, key_name, COALESCE(popularity, hq) AS pop
        FROM tracks
        WHERE ${conditions.join(" AND ")}
        ORDER BY pop DESC
        LIMIT 20
      `;
    }

    const result = await db.execute({ sql, args });

    if (result.rows.length === 0) {
      return NextResponse.json({ found: false });
    }

    const tracks = result.rows.map((r) => ({
      artist: r.artist as string,
      title: r.title as string,
      bpm: r.bpm as number | null,
      key: r.key_name as string | null,
    }));

    const best = tracks.reduce((best, t) => {
      const score = matchScore(t, artist, title);
      const bestScore = matchScore(best, artist, title);
      return score > bestScore ? t : best;
    }, tracks[0]);

    const keyParsed = parseKey(best.key ?? "");

    return NextResponse.json({
      found: true,
      artist: best.artist,
      title: best.title,
      bpm: best.bpm ? Math.round(best.bpm * 10) / 10 : null,
      key: best.key ?? null,
      noteIndex: keyParsed?.noteIndex ?? null,
      mode: keyParsed?.mode ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Lookup failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
