"""
Driftwave downbeat detector — Modal serverless endpoint.

Uses allin1 (Kim & Won, ISMIR 2023) transformer for beat/downbeat activations,
then re-runs madmom DBNDownBeatTrackingProcessor constrained to the confirmed
BPM from Everysong (±4% window). This eliminates tempo octave errors and
tightens phase search to the one remaining unknown.

If key is supplied from Everysong (music metadata, not inference), it is used
directly rather than allin1's estimated key.

Deploy:
  pip install modal
  modal setup
  modal deploy modal_functions/beatnet.py

Add returned URL to Vercel as MODAL_DOWNBEAT_URL.
"""

import modal

app = modal.App("driftwave-downbeat")

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("allin1", "madmom==0.16.1", "requests", "numpy")
)


@app.function(image=image, timeout=180, memory=8192, gpu="any")
@modal.web_endpoint(method="POST")
def detect_downbeat(item: dict) -> dict:
    """
    POST body:
      {
        "audio_url":  "https://...",
        "bpm":        120.5,      # optional — confirmed BPM from Everysong
        "note_index": 7,          # optional — confirmed key root 0–11 (C=0…B=11)
        "mode":       "major"     # optional — "major" | "minor"
      }

    Returns:
      {
        "first_downbeat_ms": int,
        "downbeats_ms":      [int, ...],
        "beats_ms":          [int, ...],
        "bpm":               float,
        "key":               str | None,
        "note_index":        int | None,
        "mode":              str | None,
      }
    """
    import tempfile, os
    import numpy as np
    import requests as req_lib
    import allin1

    NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    KEY_MAP = {
        "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3,
        "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8,
        "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
    }

    def parse_allin1_key(key_str: str):
        if not key_str:
            return None, None
        parts = key_str.strip().split()
        if len(parts) < 2:
            return None, None
        note_index = KEY_MAP.get(parts[0])
        mode = "major" if parts[1].lower() == "major" else "minor"
        return note_index, mode

    def phase_estimate(beats_arr: np.ndarray, period: float) -> float:
        """Circular mean phase of beats relative to period."""
        phases = beats_arr % period
        sin_m = np.mean(np.sin(2 * np.pi * phases / period))
        cos_m = np.mean(np.cos(2 * np.pi * phases / period))
        phi = np.arctan2(sin_m, cos_m) / (2 * np.pi) * period
        return float(phi if phi >= 0 else phi + period)

    def regrid_beats(beats_arr: np.ndarray, downbeats_arr: np.ndarray,
                     period: float) -> tuple[list[float], list[float]]:
        """
        Build a beat grid at the confirmed BPM period, phased to the detected beats,
        then find downbeat positions using allin1's downbeat anchors.
        Returns (refined_beats, refined_downbeats).
        """
        phi = phase_estimate(beats_arr, period)
        # Walk backward from phi to find first beat >= 0
        first = phi
        while first - period >= 0:
            first -= period
        if first < 0:
            first += period

        end = float(beats_arr[-1]) + period * 2
        grid = []
        t = first
        while t <= end:
            grid.append(t)
            t += period

        if len(downbeats_arr) == 0:
            # No downbeat anchor — assume first grid beat is bar 1
            downbeats = [grid[i] for i in range(0, len(grid), 4)]
            return grid, downbeats

        # Use allin1's first downbeat to find the correct bar phase within the grid
        first_db = float(downbeats_arr[0])
        # Find grid index closest to allin1's first downbeat
        closest_idx = int(np.argmin([abs(g - first_db) for g in grid]))
        # Snap to nearest multiple of 4 (beats_per_bar)
        bar_start = round(closest_idx / 4) * 4
        downbeats = [grid[i] for i in range(bar_start, len(grid), 4)]
        return grid, downbeats

    # ── Input ──────────────────────────────────────────────────────────────
    audio_url = item.get("audio_url")
    if not audio_url:
        return {"error": "No audio_url provided"}

    confirmed_bpm   = item.get("bpm")           # float | None
    confirmed_ni    = item.get("note_index")    # int 0–11 | None
    confirmed_mode  = item.get("mode")          # "major" | "minor" | None

    # ── Download ────────────────────────────────────────────────────────────
    try:
        r = req_lib.get(audio_url, timeout=60)
        r.raise_for_status()
    except Exception as e:
        return {"error": f"Download failed: {e}"}

    url_lower = audio_url.lower()
    suffix = ".wav" if ".wav" in url_lower else ".flac" if ".flac" in url_lower else ".mp3"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(r.content)
        tmp = f.name

    try:
        # ── allin1: transformer feature extraction + default DBN ──────────
        # include_activations=True gives us beat/downbeat probability frames
        # so we can re-run the DBN with BPM constraints if needed
        result = allin1.analyze(tmp, include_activations=True)

        detected_beats     = [float(t) for t in (result.beats or [])]
        detected_downbeats = [float(t) for t in (result.downbeats or [])]
        detected_bpm       = float(result.bpm) if result.bpm else None

        # ── BPM-constrained DBN re-pass ────────────────────────────────────
        if confirmed_bpm and confirmed_bpm > 0 and result.activations is not None:
            try:
                from madmom.features.downbeats import DBNDownBeatTrackingProcessor
                # Tight window: ±4% around confirmed BPM eliminates octave errors
                tolerance = 0.04
                min_bpm = confirmed_bpm * (1 - tolerance)
                max_bpm = confirmed_bpm * (1 + tolerance)

                # allin1 activations shape: [T, 2] — columns are [beat_act, downbeat_act]
                # madmom DBN expects [T, 2] at its fps (allin1 uses 44100/512 ≈ 86 fps)
                acts = np.array(result.activations)
                fps  = getattr(result, "fps", 86)  # allin1 default fps

                dbn = DBNDownBeatTrackingProcessor(
                    beats_per_bar=[3, 4],
                    fps=fps,
                    min_bpm=min_bpm,
                    max_bpm=max_bpm,
                )
                constrained = dbn(acts)
                # constrained: [[time, beat_number], ...]  beat_number==1 → downbeat
                detected_beats     = [float(b[0]) for b in constrained]
                detected_downbeats = [float(b[0]) for b in constrained if int(b[1]) == 1]
                detected_bpm       = confirmed_bpm  # trust Everysong
            except Exception:
                # Activation format incompatible — fall back to phase re-gridding
                if detected_beats:
                    period = 60.0 / confirmed_bpm
                    beats_arr    = np.array(detected_beats)
                    downbeats_arr = np.array(detected_downbeats)
                    bpm_ratio = detected_bpm / confirmed_bpm if detected_bpm else 1.0
                    # Only re-grid if allin1 is off by more than 4% (likely octave error)
                    if abs(bpm_ratio - 1.0) > 0.04:
                        detected_beats, detected_downbeats = regrid_beats(
                            beats_arr, downbeats_arr, period
                        )
                    detected_bpm = confirmed_bpm

        # ── Key: prefer Everysong (metadata > inference) ──────────────────
        if confirmed_ni is not None and confirmed_mode:
            note_index = confirmed_ni
            mode       = confirmed_mode
            key_str    = f"{NOTE_NAMES[confirmed_ni]} {confirmed_mode}"
        else:
            key_str    = result.key or ""
            note_index, mode = parse_allin1_key(key_str)

        return {
            "first_downbeat_ms": round(detected_downbeats[0] * 1000) if detected_downbeats else None,
            "downbeats_ms":      [round(t * 1000) for t in detected_downbeats[:50]],
            "beats_ms":          [round(t * 1000) for t in detected_beats[:200]],
            "bpm":               round(float(detected_bpm), 2) if detected_bpm else None,
            "key":               key_str,
            "note_index":        note_index,
            "mode":              mode,
        }

    except Exception as e:
        return {"error": str(e)}
    finally:
        os.unlink(tmp)
