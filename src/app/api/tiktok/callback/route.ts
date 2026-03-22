import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error || !code) {
    return new NextResponse(
      `<html><body style="background:#000;color:#fff;font-family:Arial;padding:40px">
        <h2 style="font-weight:700;letter-spacing:2px">TIKTOK AUTH FAILED</h2>
        <p style="font-size:12px">${error || "NO CODE RETURNED"}</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  try {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${baseUrl}/api/tiktok/callback`,
      }),
    });

    const data = await res.json();

    if (data.error || !data.refresh_token) {
      throw new Error(data.error_description || data.error || "No refresh token");
    }

    return new NextResponse(
      `<html><body style="background:#000;color:#fff;font-family:Arial;padding:40px">
        <h2 style="font-weight:700;letter-spacing:2px">TIKTOK CONNECTED</h2>
        <p style="font-size:12px;letter-spacing:1px;margin-top:20px">ADD THIS REFRESH TOKEN TO VERCEL ENV AS <strong>TIKTOK_REFRESH_TOKEN</strong>:</p>
        <pre style="background:#111;padding:16px;margin-top:12px;word-break:break-all;font-size:11px">${data.refresh_token}</pre>
        <p style="font-size:11px;margin-top:20px;opacity:0.5">THEN REDEPLOY. YOU ONLY NEED TO DO THIS ONCE.</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return new NextResponse(
      `<html><body style="background:#000;color:#fff;font-family:Arial;padding:40px">
        <h2 style="font-weight:700;letter-spacing:2px">TIKTOK AUTH ERROR</h2>
        <p style="font-size:12px">${msg}</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }
}
