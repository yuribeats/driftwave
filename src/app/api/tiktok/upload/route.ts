import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: process.env.TIKTOK_REFRESH_TOKEN!,
    }),
  });

  const data = await res.json();
  if (data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || "Token refresh failed");
  }
  return data.access_token;
}

export async function POST(request: NextRequest) {
  if (!process.env.TIKTOK_REFRESH_TOKEN) {
    return NextResponse.json({ error: "TIKTOK NOT CONNECTED. VISIT /API/TIKTOK/AUTH FIRST." }, { status: 401 });
  }

  try {
    const { url, artist, title } = await request.json();
    if (!url) {
      return NextResponse.json({ error: "Missing video URL" }, { status: 400 });
    }

    const accessToken = await getAccessToken();
    const caption = `${artist || ""} - ${title || ""} (SLOWED + REVERB) | MADE WITH SLOWEDANDREVERBED.COM`;

    // Download video to get file size
    const videoRes = await fetch(url);
    if (!videoRes.ok) throw new Error("Failed to download video");
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

    // Initialize upload with FILE_UPLOAD source
    const initRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title: caption.substring(0, 150),
            privacy_level: "PUBLIC_TO_EVERYONE",
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: videoBuffer.length,
            chunk_size: videoBuffer.length,
            total_chunk_count: 1,
          },
        }),
      }
    );

    const initData = await initRes.json();

    if (initData.error?.code) {
      throw new Error(initData.error.message || `TikTok error: ${initData.error.code}`);
    }

    const uploadUrl = initData.data?.upload_url;
    if (!uploadUrl) throw new Error("No upload URL returned");

    // Upload the video file
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes 0-${videoBuffer.length - 1}/${videoBuffer.length}`,
      },
      body: videoBuffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Upload failed: ${uploadRes.status} ${errText.substring(0, 100)}`);
    }

    const publishId = initData.data?.publish_id;
    return NextResponse.json({ success: true, publishId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    console.error("tiktok upload error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
