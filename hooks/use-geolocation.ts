"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bearingDegrees, distanceMeters } from "@/lib/geo";
import type { TrackingSample } from "@/lib/types";

export type GeolocationStatus = "idle" | "requesting" | "granted" | "denied" | "unavailable";

export function useGeolocation() {
  const [status, setStatus] = useState<GeolocationStatus>("idle");
  const [sample, setSample] = useState<TrackingSample | null>(null);
  const watcherRef = useRef<number | null>(null);
  const previousReliableRef = useRef<TrackingSample | null>(null);

  const stop = useCallback(() => {
    if (watcherRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watcherRef.current);
      watcherRef.current = null;
    }
    previousReliableRef.current = null;
  }, []);

  const request = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }

    stop();
    setSample(null);
    setStatus("requesting");
    watcherRef.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        setStatus("granted");
        const coordinate = { latitude: coords.latitude, longitude: coords.longitude };
        const previous = previousReliableRef.current;
        const elapsedSeconds = previous ? (timestamp - previous.timestamp) / 1000 : 0;
        const derivedSpeed = previous && elapsedSeconds >= 0.25 && elapsedSeconds <= 12
          ? distanceMeters(previous.coordinate, coordinate) / elapsedSeconds
          : null;
        const rawSpeed = coords.speed !== null && Number.isFinite(coords.speed)
          ? coords.speed
          : derivedSpeed;
        const speedMps = rawSpeed !== null && rawSpeed >= 0 && rawSpeed <= 80
          ? previous?.speedMps !== null && previous?.speedMps !== undefined
            ? previous.speedMps * 0.62 + rawSpeed * 0.38
            : rawSpeed
          : null;
        const suppliedHeading = coords.heading !== null && Number.isFinite(coords.heading)
          ? coords.heading
          : null;
        const next: TrackingSample = {
          coordinate,
          timestamp,
          speedMps,
          accuracyMeters: coords.accuracy,
          headingDegrees: suppliedHeading ?? (previous ? bearingDegrees(previous.coordinate, coordinate) : null),
        };
        if (coords.accuracy <= 50) previousReliableRef.current = next;
        setSample(next);
      },
      (error) => {
        setStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 },
    );
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { status, sample, request, stop };
}
