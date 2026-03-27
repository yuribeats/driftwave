import { NextRequest, NextResponse } from "next/server";

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
  // Normalize by query size: if all query words appear in the track, score = 1.0
  // This ensures "Bebe Rexha" matches "Bebe Rexha, Florida Georgia Line" fully
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

  const params = new URLSearchParams({ limit: "20", sort: "popularity", dir: "desc" });
  const combined = [artist, title, q].filter(Boolean).join(" ");
  params.set("q", combined);

  const apiKey = process.env.EVERYSONG_API_KEY;
  if (apiKey) params.set("api_key", apiKey);

  const url = `https://everysong.site/api/search?${params.toString()}`;

  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error(`Everysong error: ${res.status}`);
    const data = await res.json();

    const tracks = (data.tracks ?? []) as Array<{ artist: string; title: string; bpm: number | null; key: string | null }>;
    if (tracks.length === 0) {
      return NextResponse.json({ found: false });
    }

    // Pick best match by artist+title word overlap; fall back to first (most popular)
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
