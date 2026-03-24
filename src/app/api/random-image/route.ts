import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MUSEUM_SOURCE = "https://museum.ink/imagedata.json";

interface ImageEntry {
  name: string;
  url: string;
}

let cachedImages: ImageEntry[] | null = null;
let shuffled: ImageEntry[] = [];
let nextIndex = 0;

function shuffle(arr: ImageEntry[]): ImageEntry[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function GET() {
  try {
    if (!cachedImages) {
      const res = await fetch(MUSEUM_SOURCE, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch image list");
      const data = await res.json();
      cachedImages = data.images || [];
      shuffled = shuffle(cachedImages!);
      nextIndex = 0;
    }

    if (!cachedImages || cachedImages.length === 0) {
      throw new Error("No images available");
    }

    if (nextIndex >= shuffled.length) {
      shuffled = shuffle(cachedImages!);
      nextIndex = 0;
    }

    const entry = shuffled[nextIndex++];
    const imageUrl = entry.url.startsWith("http") ? entry.url : `https://museum.ink${entry.url}`;

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("Failed to fetch image");

    const buffer = await imgRes.arrayBuffer();
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("random-image error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
