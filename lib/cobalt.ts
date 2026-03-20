export async function fetchYouTubeAudio(
  url: string
): Promise<{ buffer: ArrayBuffer; title: string }> {
  const res = await fetch("/api/cobalt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Failed to fetch audio");
  }

  const contentType = res.headers.get("Content-Type") ?? "";

  // RapidAPI returns JSON with a redirect URL — fetch audio from that URL
  if (contentType.includes("application/json")) {
    const data = await res.json();
    if (data.redirectUrl) {
      const audioRes = await fetch(data.redirectUrl);
      if (!audioRes.ok) throw new Error("Failed to download audio");
      const buffer = await audioRes.arrayBuffer();
      return { buffer, title: data.title ?? "youtube-audio" };
    }
    throw new Error(data.error ?? "No audio URL returned");
  }

  // Cobalt returns audio buffer directly
  const title = res.headers.get("X-Audio-Title") ?? "youtube-audio";
  const buffer = await res.arrayBuffer();
  return { buffer, title };
}
