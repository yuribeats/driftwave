# Driftwave Architecture Reference

Internal reference for API flows, external services, and critical nuances. Keep this up to date when routes change.

---

## External Services

| Service | Endpoint | Env vars | Critical notes |
|---------|----------|----------|----------------|
| **Everysong API** | `https://everysong.site/api/search` | `EVERYSONG_API_KEY` (optional) | VPS at 204.168.175.190:3000 is authoritative (40M tracks). DO NOT use Turso (stale copy, 5.6M). `artist=` and `title=` must ALWAYS be separate params. NEVER combine into `q=`. `q=` only for free-form batch searches. |
| **YouTube download** | RapidAPI `youtube-mp36.p.rapidapi.com` | `RAPIDAPI_KEY`, `RAPIDAPI_USERNAME` | MD5 hash of `RAPIDAPI_USERNAME` sent as `X-RUN` header — required by proxy whitelist. Do not remove. |
| **YouTube search** | Undocumented `youtubei/v1/search` POST | none | No API key needed. |
| **Stem separation** | Replicate Demucs `htdemucs_ft` | `REPLICATE_API_TOKEN` | `instrumental` stem = drums + bass + other (synthesized client-side, NOT a direct Demucs output). |
| **Downbeat detection** | Modal serverless | `MODAL_DOWNBEAT_URL` | beat_this model (CPJKU, ISMIR 2024). Always pass `bpm`, `note_index`, `mode` as priors when available — improves accuracy. |
| **Storage** | Pinata | `PINATA_JWT`, `PINATA_GATEWAY` | All audio, video, sessions stored here. Use `PINATA_GATEWAY` env var for URLs — never hardcode. |
| **Video generation** | ffmpeg-static (bundled) | none | Writes to `/tmp`, cleans up after each run. |
| **YouTube upload** | Google OAuth2 | `YOUTUBE_REFRESH_TOKEN` | One-time setup: hit `/api/youtube/auth` → `/api/youtube/callback` → copy token to Vercel env. |
| **TikTok upload** | TikTok OAuth2 | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Same pattern: `/api/tiktok/auth` → `/api/tiktok/callback` → save token. |
| **Random images** | museum.ink | none | `https://museum.ink/imagedata.json` |

---

## API Routes

| Route | Method | Purpose | Key params | Returns |
|-------|--------|---------|------------|---------|
| `/api/cobalt` | POST | Download YouTube audio | `{ url }` | Binary MP3 |
| `/api/youtube/search` | GET | Find YouTube video | `q` | `{ videoId, url }` |
| `/api/playlist` | POST | Get playlist videos | `{ url }` | `{ items[] }` |
| `/api/stems` | POST | Demucs stem separation | JSON `{ youtubeUrl }` OR FormData `{ audio }` | `{ vocals, drums, bass, other }` (temp Replicate CDN URLs) |
| `/api/everysong` | GET | BPM+key lookup — single best match | `artist=`, `title=` OR `q=` | `{ found, bpm, key, noteIndex, mode }` |
| `/api/everysong/search` | GET | Multi-result search — batch page only | `q`, `limit` | `{ results[] }` |
| `/api/downbeat` | POST | Beat/downbeat grid detection | `{ youtubeUrl or audioUrl, bpm?, note_index?, mode? }` | `{ first_downbeat_ms, downbeats_ms[], beats_ms[], bpm, key, note_index, mode }` |
| `/api/generate-video` | POST | Render audio + image → MP4 | FormData: `audioCid`, `image`, `artist`, `title`, `watermark` | `{ url }` (Pinata gateway URL) |
| `/api/pinata-upload-url` | POST | Signed upload URL for browser uploads | none | `{ url, gateway }` |
| `/api/save` | POST/GET | Save/list downloaded mixes | POST FormData: `audio`, `filename`, `settings` | `{ id, audioUrl }` |
| `/api/share` | POST/GET | Share session via link | POST FormData: `audio`, `settings` | `{ id, audioUrl }` |
| `/api/session` | POST/GET | Save/restore full two-deck session | POST FormData: `session`, `audioA?`, `audioB?` | `{ id }` |
| `/api/gallery` | GET/DELETE | Video gallery | GET `all=1` for all file types | `{ items[] }` |
| `/api/random-image` | GET | Random cover art from museum.ink | none | Binary image |
| `/api/youtube/auth` | GET | Start YouTube OAuth flow | none | Redirect |
| `/api/youtube/callback` | GET | YouTube OAuth complete | `code` | HTML showing refresh token |
| `/api/youtube/upload` | POST | Upload rendered video to YouTube | `{ url, artist, title }` | `{ videoId, youtubeUrl }` |
| `/api/tiktok/auth` | GET | Start TikTok OAuth flow | none | Redirect |
| `/api/tiktok/callback` | GET | TikTok OAuth complete | `code` | HTML showing refresh token |
| `/api/tiktok/upload` | POST | Upload rendered video to TikTok | `{ url, artist, title }` | `{ publishId }` |

---

## Store Actions (lib/remix-store.ts)

| Action | What it does |
|--------|-------------|
| `loadDeck(id, artist, title, opts?)` | YouTube search → load audio → Everysong lookup → stem separation (skipped if `opts.autoStem === false`). Deck A target stem: `instrumental`. Deck B target stem: `vocals`. |
| `lookupEverysong(id, artist, title)` | Calls `/api/everysong?artist=X&title=Y`, sets `calculatedBPM`, `baseKey`, `baseMode` on the deck. |
| `loadFromYouTube(id, url)` | Calls `/api/cobalt`, decodes MP3, stores `sourceBuffer`. |
| `separateStems(id)` | Calls `/api/stems`, synthesizes `instrumental` = drums+bass+other, stores all stems in `stemBuffers`. |
| `detectDownbeat(id)` | Calls `/api/downbeat` with BPM/key priors, snaps in-point to first downbeat, enables gridlock. |
| `renderToBlob()` | Offline mix render. Both decks through master bus (EQ → compressor → limiter). Returns WAV blob. |
| `syncPlay()` | Sample-aligned dual-deck start. Starts recording if armed. |
| `play(id, forceLoop?)` | Builds Web Audio graph, schedules automation, manages generation counter. |
| `setBPM(id, bpm)` | Stores base BPM: `calculatedBPM = bpm / (1 + speed)`. |

---

## Critical Nuances

### Everysong
- `q=artist+title` returns **0 results**. Always use separate `artist=` and `title=` params.
- `q=` works only for free-form searches (e.g., single title words) — used by batch page multi-result search only.
- No API key required when called from Vercel (requests route through everysong.site Vercel → VPS).
- The Turso DB (`libsql://key-bpm-matcher-wrybak.aws-us-west-2.turso.io`) is a stale 5.6M-row copy. Do not use it.

### BPM
- `calculatedBPM` = base rate (adjusted for speed). Display BPM = `calculatedBPM * (1 + speed)`.
- BPM comes from Everysong only. It is passed as a prior to Modal downbeat detection.

### Stems
- `instrumental` is synthesized as `drums + bass + other`. It is not returned directly by Demucs.
- Replicate CDN stem URLs are temporary — not persisted. Re-separation required on session restore.

### Downbeat detection
- Modal function: beat_this model. Source: `modal_functions/beatnet.py`.
- Pass Everysong BPM + key as priors for better accuracy.
- Snap logic (grid extrapolation beyond detected range) runs client-side in `detectDownbeat` store action.

### YouTube download
- `X-RUN` header = MD5 of `RAPIDAPI_USERNAME`. This is a proxy whitelist mechanism. Never remove it.

### Video generation
- Audio must be uploaded to Pinata first (get CID), then passed to `/api/generate-video` as `audioCid`.
- ffmpeg runs server-side in the Vercel function with ffmpeg-static binary.
