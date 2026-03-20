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

  const title = res.headers.get("X-Audio-Title") ?? "youtube-audio";
  const buffer = await res.arrayBuffer();

  if (buffer.byteLength < 10000) {
    throw new Error("Downloaded file too small — extraction likely failed");
  }

  return { buffer, title };
}
