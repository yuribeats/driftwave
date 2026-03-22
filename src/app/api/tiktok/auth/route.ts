import { NextResponse } from "next/server";

export async function GET() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY!;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const redirectUri = `${baseUrl}/api/tiktok/callback`;

  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope: "video.publish,video.upload",
    redirect_uri: redirectUri,
    state: "tiktok-auth",
  });

  return NextResponse.redirect(
    `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`
  );
}
