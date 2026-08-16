"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "paceline-sound-enabled";

export function useSpeechAnnouncements() {
  const [enabled, setEnabled] = useState(false);
  const announcedRef = useRef(new Set<string>());
  const lastSpokenAtRef = useRef(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setEnabled(window.localStorage.getItem(STORAGE_KEY) === "true");
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        if (next) window.speechSynthesis.speak(new SpeechSynthesisUtterance("Sound on."));
      }
      return next;
    });
  }, []);

  const announce = useCallback(
    (key: string, message: string, vibrate = false) => {
      if (!enabled || announcedRef.current.has(key)) return;
      const now = Date.now();
      if (now - lastSpokenAtRef.current < 1_500) return;

      announcedRef.current.add(key);
      lastSpokenAtRef.current = now;
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 0.96;
        utterance.pitch = 0.94;
        window.speechSynthesis.speak(utterance);
      }
      if (vibrate && "vibrate" in navigator) navigator.vibrate(60);
    },
    [enabled],
  );

  const resetAnnouncements = useCallback(() => {
    announcedRef.current.clear();
    lastSpokenAtRef.current = 0;
  }, []);

  return { enabled, toggle, announce, resetAnnouncements };
}
