"use client";

import { useEffect } from "react";
import { getAudioContext } from "../lib/audio-context";

export default function AudioWarmup() {
  useEffect(() => {
    // Create AudioContext on first interaction
    const handler = () => {
      getAudioContext();
    };
    document.addEventListener("touchstart", handler, { once: true });
    document.addEventListener("click", handler, { once: true });

    // Re-resume AudioContext when page returns from background (iOS suspends it)
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        const ctx = getAudioContext();
        if (ctx.state === "suspended") {
          ctx.resume();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("click", handler);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
