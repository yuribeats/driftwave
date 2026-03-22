import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

function extractPlaylistId(url: string): string | null {
  const m = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const playlistId = extractPlaylistId(url);
  if (!playlistId) {
    return NextResponse.json({ error: "Could not extract playlist ID" }, { status: 400 });
  }

  if (!process.env.API_KEY) {
    return NextResponse.json({ error: "API_KEY not configured" }, { status: 500 });
  }

  try {
    const items: { videoId: string; title: string }[] = [];
    let pageToken = "";

    do {
      const params = new URLSearchParams({
        part: "snippet",
        playlistId,
        maxResults: "50",
        key: process.env.API_KEY,
      });
      if (pageToken) params.set("pageToken", pageToken);

      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?${params}`
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || `YouTube API error: ${res.status}`);
      }

      for (const item of data.items || []) {
        const videoId = item.snippet?.resourceId?.videoId;
        const title = item.snippet?.title || "UNTITLED";
        if (videoId && title !== "Private video" && title !== "Deleted video") {
          items.push({ videoId, title });
        }
      }

      pageToken = data.nextPageToken || "";
    } while (pageToken);

    return NextResponse.json({ items, playlistId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch playlist";
    console.error("playlist error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
