"""
Driftwave downbeat detector — Modal serverless endpoint.

Uses librosa beat tracking + madmom DBNDownBeatTrackingProcessor.
If a confirmed BPM is supplied (from Everysong), the DBN is constrained
to a ±4% window around it to eliminate tempo octave errors.

Deploy:
  modal deploy modal_functions/beatnet.py
"""

import modal

app = modal.App("driftwave-downbeat")

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("numpy<2.0", "scipy", "cython")
    .pip_install("librosa==0.10.2", "requests", "fastapi[standard]")
    .pip_install("madmom==0.16.1")
)


@app.function(image=image, timeout=180, memory=4096, min_containers=1)
@modal.fastapi_endpoint(method="POST")
def detect_downbeat(item: dict) -> dict:
    """
    POST body:
      {
        "audio_url":  "https://...",
        "bpm":        120.5,      # optional — confirmed BPM from Everysong
        "note_index": 7,          # optional — 0-11 (C=0…B=11)
        "mode":       "major"     # optional
      }
    """
    # madmom 0.16.1 uses collections ABCs and np aliases removed in Python 3.10/NumPy 1.24.
    # Patch both before importing madmom.
    import collections, collections.abc
    for _a in dir(collections.abc):
        if not hasattr(collections, _a):
            setattr(collections, _a, getattr(collections.abc, _a))

    import numpy as np
    for _alias in ("float", "int", "complex", "bool", "object", "str"):
        if not hasattr(np, _alias):
            setattr(np, _alias, __builtins__[_alias] if isinstance(__builtins__, dict) else getattr(__builtins__, _alias))

    import tempfile, os
    import requests as req_lib
    import librosa

    NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    # ── Input ──────────────────────────────────────────────────────────────
    audio_url = item.get("audio_url")
    if not audio_url:
        return {"error": "No audio_url provided"}

    confirmed_bpm   = item.get("bpm")
    confirmed_ni    = item.get("note_index")
    confirmed_mode  = item.get("mode")

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
        # ── Load audio (mono, native SR) ────────────────────────────────────
        y, sr = librosa.load(tmp, sr=None, mono=True)

        # ── Beat tracking ───────────────────────────────────────────────────
        if confirmed_bpm and confirmed_bpm > 0:
            # Constrain tempo to confirmed BPM ±4% to eliminate octave errors
            tempo_prior = librosa.beat.tempo(y=y, sr=sr, start_bpm=confirmed_bpm)
            detected_bpm = float(confirmed_bpm)
        else:
            tempo_arr = librosa.beat.tempo(y=y, sr=sr)
            detected_bpm = float(tempo_arr[0])

        _, beat_frames = librosa.beat.beat_track(
            y=y, sr=sr, bpm=detected_bpm, tightness=100, trim=False
        )
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

        if len(beat_times) == 0:
            return {"error": "No beats detected"}

        # ── Downbeat estimation via madmom DBN ──────────────────────────────
        downbeat_times = []
        try:
            from madmom.features.downbeats import RNNDownBeatProcessor, DBNDownBeatTrackingProcessor

            rnn = RNNDownBeatProcessor()(tmp)

            tolerance = 0.04
            min_bpm = detected_bpm * (1 - tolerance)
            max_bpm = detected_bpm * (1 + tolerance)

            dbn = DBNDownBeatTrackingProcessor(
                beats_per_bar=[3, 4],
                min_bpm=min_bpm,
                max_bpm=max_bpm,
            )
            result = dbn(rnn)
            # result: [[time, beat_number], ...]  beat_number==1 → downbeat
            downbeat_times = [float(b[0]) for b in result if int(b[1]) == 1]
        except Exception:
            # Fallback: assume 4/4, first beat is downbeat, every 4th beat after
            downbeat_times = [beat_times[i] for i in range(0, len(beat_times), 4)]

        first_downbeat_ms = round(downbeat_times[0] * 1000) if downbeat_times else round(beat_times[0] * 1000)

        # ── Key: use Everysong if provided ──────────────────────────────────
        if confirmed_ni is not None and confirmed_mode:
            key_str = f"{NOTE_NAMES[confirmed_ni]} {confirmed_mode}"
            note_index = confirmed_ni
            mode = confirmed_mode
        else:
            key_str = None
            note_index = None
            mode = None

        return {
            "first_downbeat_ms": first_downbeat_ms,
            "downbeats_ms":      [round(t * 1000) for t in downbeat_times[:50]],
            "beats_ms":          [round(t * 1000) for t in beat_times[:200]],
            "bpm":               round(detected_bpm, 2),
            "key":               key_str,
            "note_index":        note_index,
            "mode":              mode,
        }

    except Exception as e:
        return {"error": str(e)}
    finally:
        os.unlink(tmp)
