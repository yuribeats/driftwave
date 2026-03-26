import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });

  const body = {
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20231121.09.00",
      },
    },
    query: q,
  };

  const res = await fetch(
    "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "YouTube search failed" }, { status: 500 });
  }

  const data = await res.json();

  const contents =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;

  const videoItem = contents?.find(
    (item: Record<string, unknown>) => item.videoRenderer
  )?.videoRenderer;

  if (!videoItem) {
    return NextResponse.json({ error: "No results found" }, { status: 404 });
  }

  const videoId = videoItem.videoId;
  const title = videoItem.title?.runs?.[0]?.text || "";

  return NextResponse.json({
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  });
}
