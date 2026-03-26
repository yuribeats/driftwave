import { NextRequest, NextResponse } from "next/server";

// Maps everysong key names to 0-11 note index (C=0 ... B=11)
const KEY_MAP: Record<string, number> = {
  "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3,
  "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8,
  "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
};

function parseKey(keyStr: string): { noteIndex: number; mode: "major" | "minor" } | null {
  if (!keyStr) return null;
  // e.g. "Db Minor", "C Major", "F# Minor"
  const parts = keyStr.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const note = parts[0];
  const mode = parts[1].toLowerCase() === "major" ? "major" : "minor";
  const noteIndex = KEY_MAP[note];
  if (noteIndex === undefined) return null;
  return { noteIndex, mode };
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q) {
    return NextResponse.json({ error: "Missing q" }, { status: 400 });
  }

  const apiKey = process.env.EVERYSONG_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "EVERYSONG_API_KEY not configured" }, { status: 500 });
  }

  const url = `https://everysong.site/api/search?q=${encodeURIComponent(q)}&limit=5&api_key=${apiKey}`;

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`Everysong error: ${res.status}`);
    const data = await res.json();

    const tracks = data.tracks ?? [];
    if (tracks.length === 0) {
      return NextResponse.json({ found: false });
    }

    const best = tracks[0];
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
