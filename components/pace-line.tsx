"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapCanvas } from "@/components/map-canvas";
import {
  DriveInstrumentPanel,
  DriveSetup,
  PermissionState,
  RecenterControl,
  SoundControl,
  TripSummary,
  type DrivePanelMode,
} from "@/components/instruments";
import { bearingDifference, cumulativeRouteDistances, formatDistance, nearestRouteProgress } from "@/lib/geo";
import { fetchAverageSpeedZones, fetchRoute, searchDestinations } from "@/lib/live-services";
import { advanceZoneSession, initialZoneSession, smoothRecommendation, zoneCompliance } from "@/lib/pace";
import type {
  AverageSpeedZone,
  CompletedZoneSummary,
  DestinationResult,
  DriveStage,
  LiveSnapshot,
  RoutePlan,
  ZoneLoadResult,
  ZoneProgressSpec,
  ZoneSession,
} from "@/lib/types";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useSpeechAnnouncements } from "@/hooks/use-speech-announcements";

const EMPTY_ROUTE: RoutePlan["coordinates"] = [];

function buildZoneSpecs(route: RoutePlan | null, zones: AverageSpeedZone[]): ZoneProgressSpec[] {
  if (!route) return [];
  const cumulative = cumulativeRouteDistances(route.coordinates);
  return zones.flatMap((zone) => {
    const start = nearestRouteProgress(route.coordinates, cumulative, zone.entry).progressMeters;
    const end = nearestRouteProgress(route.coordinates, cumulative, zone.exit).progressMeters;
    return end > start ? [{ zone, startMeters: start, endMeters: end }] : [];
  });
}

export function PaceLine() {
  const {
    status: geolocationStatus,
    sample: geolocationSample,
    request: requestLocation,
    stop: stopLocation,
  } = useGeolocation();
  const {
    enabled: soundEnabled,
    toggle: toggleSound,
    announce,
    resetAnnouncements,
  } = useSpeechAnnouncements();
  const [stage, setStage] = useState<DriveStage>("permission");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DestinationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [route, setRoute] = useState<RoutePlan | null>(null);
  const [zoneResult, setZoneResult] = useState<ZoneLoadResult | null>(null);
  const [sessions, setSessions] = useState<ZoneSession[]>([]);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");
  const [followVehicle, setFollowVehicle] = useState(true);
  const [completionZoneId, setCompletionZoneId] = useState<string | null>(null);
  const [travelSeconds, setTravelSeconds] = useState(0);
  const lastMetricAtRef = useRef(0);
  const journeyStartedAtRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const previousStatesRef = useRef(new Map<string, ZoneSession["state"]>());

  const routeCoordinates = route?.coordinates ?? EMPTY_ROUTE;
  const routeCumulative = useMemo(
    () => cumulativeRouteDistances(routeCoordinates),
    [routeCoordinates],
  );
  const zoneSpecs = useMemo(
    () => buildZoneSpecs(route, zoneResult?.zones ?? []),
    [route, zoneResult],
  );
  const liveSnapshot = useMemo<LiveSnapshot | null>(() => {
    if (!geolocationSample) return null;
    if (routeCoordinates.length < 2) {
      return { ...geolocationSample, routeProgressMeters: 0, distanceFromRouteMeters: 0 };
    }
    const match = nearestRouteProgress(routeCoordinates, routeCumulative, geolocationSample.coordinate);
    return { ...geolocationSample, routeProgressMeters: match.progressMeters, distanceFromRouteMeters: match.distanceFromRouteMeters };
  }, [geolocationSample, routeCoordinates, routeCumulative]);

  useEffect(() => () => searchAbortRef.current?.abort(), []);

  const handleSearch = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!geolocationSample || query.trim().length < 2) return;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearching(true);
    setRouteError(null);
    setResults([]);
    try {
      const found = await searchDestinations(query, geolocationSample.coordinate, controller.signal);
      setResults(found);
      if (!found.length) setRouteError("No matching destinations were found. Try a more specific address.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setRouteError(error instanceof Error ? error.message : "Destination search is unavailable.");
      }
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }, [geolocationSample, query]);

  const handleDestination = useCallback(async (destination: DestinationResult) => {
    if (!geolocationSample) return;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setPlanning(true);
    setRouteError(null);
    setResults([]);
    try {
      const nextRoute = await fetchRoute(geolocationSample.coordinate, destination, controller.signal);
      const nextZoneResult = await fetchAverageSpeedZones(nextRoute, controller.signal);
      const nextSpecs = buildZoneSpecs(nextRoute, nextZoneResult.zones);
      const nextSessions = nextSpecs.map(initialZoneSession);
      setRoute(nextRoute);
      setZoneResult(nextZoneResult);
      setSessions(nextSessions);
      previousStatesRef.current = new Map(nextSessions.map((session) => [session.zoneId, session.state]));
      setStage("ready");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setRouteError(error instanceof Error ? error.message : "This route could not be loaded.");
      }
    } finally {
      if (!controller.signal.aborted) setPlanning(false);
    }
  }, [geolocationSample]);

  const startDrive = useCallback(() => {
    if (!route || !geolocationSample) return;
    const nextSessions = zoneSpecs.map(initialZoneSession);
    setSessions(nextSessions);
    previousStatesRef.current = new Map(nextSessions.map((session) => [session.zoneId, session.state]));
    lastMetricAtRef.current = 0;
    journeyStartedAtRef.current = Date.now();
    setCompletionZoneId(null);
    setFollowVehicle(true);
    resetAnnouncements();
    setStage("driving");
  }, [geolocationSample, resetAnnouncements, route, zoneSpecs]);

  useEffect(() => {
    if (stage !== "driving" || !liveSnapshot) return;
    if (liveSnapshot.timestamp - lastMetricAtRef.current < 900) return;
    lastMetricAtRef.current = liveSnapshot.timestamp;
    const sampleIsOffRoute = liveSnapshot.distanceFromRouteMeters > 65;
    const metricSample = sampleIsOffRoute
      ? { ...liveSnapshot, accuracyMeters: 120 }
      : liveSnapshot;

    setSessions((current) => current.map((session, index) => {
      const spec = zoneSpecs[index];
      if (!spec) return session;
      const heading = liveSnapshot.headingDegrees;
      const directionIsValid = spec.zone.directionBearing === undefined || heading === null || heading === undefined
        ? liveSnapshot.routeProgressMeters >= session.lastRouteProgressMeters
        : bearingDifference(heading, spec.zone.directionBearing) <= 65;
      const next = advanceZoneSession(
        spec,
        session,
        metricSample,
        liveSnapshot.routeProgressMeters,
        liveSnapshot.distanceFromRouteMeters,
        directionIsValid,
      );
      if (next.state !== "active") return next;
      const legalLimit = Math.min(spec.zone.enforcementLimitKph, spec.zone.postedRoadLimitKph, spec.zone.temporaryLimitKph ?? Number.POSITIVE_INFINITY);
      return { ...next, recommendedMaxKph: Math.min(legalLimit, smoothRecommendation(session.recommendedMaxKph, next.recommendedMaxKph)) };
    }));
  }, [liveSnapshot, stage, zoneSpecs]);

  useEffect(() => {
    if (stage !== "driving") return;
    sessions.forEach((session) => {
      const previous = previousStatesRef.current.get(session.zoneId);
      const zone = zoneResult?.zones.find((candidate) => candidate.id === session.zoneId);
      if (!zone) return;
      if (session.state === "active" && previous !== "active") announce(`${zone.id}-started`, "Average-speed zone started.", true);
      if (session.state === "completed" && previous !== "completed") {
        announce(`${zone.id}-complete`, "Average-speed zone complete.", true);
        setCompletionZoneId(zone.id);
      }
      if (session.state === "active" && zoneCompliance(session.averageSpeedKph, zone) === "above") {
        announce(`${zone.id}-above`, "Average speed is above the target. Slow gradually.", true);
      }
      previousStatesRef.current.set(session.zoneId, session.state);
    });
  }, [announce, sessions, stage, zoneResult]);

  useEffect(() => {
    if (!completionZoneId) return;
    const timeout = window.setTimeout(() => setCompletionZoneId(null), 3_000);
    return () => window.clearTimeout(timeout);
  }, [completionZoneId]);

  useEffect(() => {
    if (stage !== "driving" || !liveSnapshot) return;
    const nextSpec = zoneSpecs.find((spec, index) => sessions[index]?.state !== "completed" && spec.startMeters > liveSnapshot.routeProgressMeters);
    if (!nextSpec) return;
    const distance = nextSpec.startMeters - liveSnapshot.routeProgressMeters;
    if (distance <= 1_000) announce(`${nextSpec.zone.id}-ahead-1000`, `Average-speed zone ahead. Limit ${nextSpec.zone.enforcementLimitKph}.`);
    if (distance <= 300) announce(`${nextSpec.zone.id}-ahead-300`, "Zone starts in 300 meters.");
  }, [announce, liveSnapshot, sessions, stage, zoneSpecs]);

  const finishDrive = useCallback(() => {
    stopLocation();
    setTravelSeconds(journeyStartedAtRef.current ? Math.max(0, (Date.now() - journeyStartedAtRef.current) / 1000) : 0);
    setStage("summary");
  }, [stopLocation]);

  useEffect(() => {
    const routeEnd = routeCumulative.at(-1) ?? 0;
    if (stage !== "driving" || !liveSnapshot || routeEnd - liveSnapshot.routeProgressMeters > 25) return;
    const timeout = window.setTimeout(finishDrive, 850);
    return () => window.clearTimeout(timeout);
  }, [finishDrive, liveSnapshot, routeCumulative, stage]);

  const planAnotherRoute = useCallback(() => {
    setRoute(null);
    setZoneResult(null);
    setSessions([]);
    setQuery("");
    setResults([]);
    setRouteError(null);
    setStage("permission");
    requestLocation();
  }, [requestLocation]);

  const activeSession = sessions.find((session) => session.state === "active");
  const activeIndex = activeSession ? sessions.findIndex((session) => session.zoneId === activeSession.zoneId) : -1;
  const approachingIndex = sessions.findIndex((session) => session.state === "approaching");
  const completionIndex = completionZoneId ? sessions.findIndex((session) => session.zoneId === completionZoneId) : -1;
  let panelMode: DrivePanelMode = "route";
  let displayZone: AverageSpeedZone | undefined;
  let displaySession: ZoneSession | undefined;
  let nextZoneDistanceMeters: number | undefined;

  if (completionIndex >= 0) {
    panelMode = "complete";
    displayZone = zoneSpecs[completionIndex]?.zone;
    displaySession = sessions[completionIndex];
  } else if (activeSession && activeIndex >= 0) {
    panelMode = "active";
    displayZone = zoneSpecs[activeIndex]?.zone;
    displaySession = activeSession;
  } else if (approachingIndex >= 0 && liveSnapshot) {
    panelMode = "approaching";
    displayZone = zoneSpecs[approachingIndex]?.zone;
    nextZoneDistanceMeters = Math.max(0, zoneSpecs[approachingIndex].startMeters - liveSnapshot.routeProgressMeters);
  } else if (liveSnapshot) {
    const nextIndex = sessions.findIndex((session, index) => session.state !== "completed" && zoneSpecs[index]?.startMeters > liveSnapshot.routeProgressMeters);
    nextZoneDistanceMeters = nextIndex >= 0 ? zoneSpecs[nextIndex].startMeters - liveSnapshot.routeProgressMeters : undefined;
  }

  const routeEnd = routeCumulative.at(-1) ?? route?.distanceMeters ?? 0;
  const routeRemainingMeters = Math.max(0, routeEnd - (liveSnapshot?.routeProgressMeters ?? 0));
  const weakGps = stage === "driving" && (
    geolocationStatus !== "granted" ||
    !!liveSnapshot && ((liveSnapshot.accuracyMeters ?? 0) > 50 || liveSnapshot.distanceFromRouteMeters > 65)
  );
  const elapsedSeconds = displaySession?.enteredAt && liveSnapshot
    ? Math.max(0, (liveSnapshot.timestamp - displaySession.enteredAt - displaySession.pausedDurationMs) / 1000)
    : 0;
  const completedZones: CompletedZoneSummary[] = sessions.filter((session) => session.state === "completed").flatMap((session) => {
    const zone = zoneResult?.zones.find((candidate) => candidate.id === session.zoneId);
    return zone ? [{ zoneId: zone.id, name: zone.name, finalAverageSpeedKph: session.finalAverageSpeedKph ?? session.averageSpeedKph, limitKph: zone.enforcementLimitKph }] : [];
  });

  return (
    <main className="paceline-app">
      <MapCanvas route={routeCoordinates} snapshot={liveSnapshot} zones={zoneResult?.zones ?? []} zoneSpecs={zoneSpecs} sessions={sessions} driving={stage === "driving"} followVehicle={followVehicle} onFollowVehicleChange={setFollowVehicle} onMapStatusChange={setMapStatus} />
      <header className="app-chrome">
        <div className="brand-lockup"><span className="brand-mark"><i /><i /></span><strong>PaceLine</strong></div>
        <div className="top-status-group">
          <div className={`gps-status ${weakGps ? "gps-status--weak" : ""}`}><span />{stage === "driving" ? weakGps ? "Pace paused" : "Live GPS" : geolocationStatus === "granted" ? "GPS ready" : "GPS required"}</div>
          <SoundControl enabled={soundEnabled} onToggle={toggleSound} />
        </div>
      </header>
      {stage === "driving" && panelMode === "approaching" && displayZone && <div className="map-zone-banner alert-arrival">Zone starts in {formatDistance(nextZoneDistanceMeters ?? 0)} <span>Limit {displayZone.enforcementLimitKph}</span></div>}
      {mapStatus === "error" && stage === "driving" && <div className="map-error-banner">Live map unavailable · pace tracking continues</div>}
      <RecenterControl visible={stage === "driving" && !followVehicle} onClick={() => setFollowVehicle(true)} />
      <div className={`panel-dock panel-dock--${stage}`}>
        {stage === "permission" && <PermissionState status={geolocationStatus} onAllow={requestLocation} onContinue={() => setStage("setup")} />}
        {(stage === "setup" || stage === "ready") && <DriveSetup mapStatus={mapStatus} query={query} results={results} searching={searching} planning={planning} error={routeError} route={route} zoneResult={zoneResult} onQueryChange={setQuery} onSearch={handleSearch} onSelect={handleDestination} onStart={startDrive} onClearRoute={() => { setRoute(null); setZoneResult(null); setSessions([]); setStage("setup"); }} />}
        {stage === "driving" && route && <DriveInstrumentPanel mode={panelMode} destinationName={route.destination.label} currentSpeedKph={liveSnapshot?.speedMps == null ? null : Math.max(0, liveSnapshot.speedMps * 3.6)} routeRemainingMeters={routeRemainingMeters} nextZoneDistanceMeters={nextZoneDistanceMeters} mappedZoneCount={zoneSpecs.length} zone={displayZone} session={displaySession} elapsedSeconds={elapsedSeconds} weakGps={weakGps} completionAverageKph={displaySession?.finalAverageSpeedKph} onEnd={finishDrive} />}
        {stage === "summary" && <TripSummary travelSeconds={travelSeconds} zones={completedZones} zoneSource={zoneResult?.source ?? "Unavailable"} onPlanAnother={planAnotherRoute} />}
      </div>
      <div className="data-source-label">Live route · OpenStreetMap data</div>
    </main>
  );
}
