"use client";

import type { FormEvent, ReactNode } from "react";
import { formatDistance, formatDuration } from "@/lib/geo";
import type {
  AverageSpeedZone,
  CompletedZoneSummary,
  ComplianceState,
  DestinationResult,
  RoutePlan,
  ZoneLoadResult,
  ZoneSession,
} from "@/lib/types";
import type { GeolocationStatus } from "@/hooks/use-geolocation";

function Icon({ name }: { name: "location" | "sound" | "mute" | "stop" | "search" | "route" }) {
  const paths: Record<typeof name, ReactNode> = {
    location: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></>,
    sound: <><path d="M5 10v4h3l4 3V7L8 10H5Z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></>,
    mute: <><path d="M5 10v4h3l4 3V7L8 10H5Z" /><path d="m16 10 5 5M21 10l-5 5" /></>,
    stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h2a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3" /></>,
  };
  return <svg className={`icon-${name}`} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function SoundControl({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button className="top-control" type="button" onClick={onToggle} aria-label={enabled ? "Turn spoken warnings off" : "Turn spoken warnings on"} aria-pressed={enabled}>
      <Icon name={enabled ? "sound" : "mute"} />
      <span>{enabled ? "Sound on" : "Sound off"}</span>
    </button>
  );
}

export function RecenterControl({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  if (!visible) return null;
  return (
    <button className="recenter-control alert-arrival" type="button" onClick={onClick} aria-label="Recenter map on vehicle">
      <Icon name="location" />
      <span>Recenter</span>
    </button>
  );
}

export function PermissionState({
  status,
  onAllow,
  onContinue,
}: {
  status: GeolocationStatus;
  onAllow: () => void;
  onContinue: () => void;
}) {
  const denied = status === "denied";
  const unavailable = status === "unavailable";
  const granted = status === "granted";
  return (
    <section className="instrument-panel permission-panel" aria-labelledby="permission-title">
      <div className="panel-grip" aria-hidden="true" />
      <div className="permission-symbol"><Icon name="location" /></div>
      <p className="instrument-kicker">Live location · processed in your browser</p>
      <h1 id="permission-title">{granted ? "Location is ready" : "Allow location before driving"}</h1>
      <p>
        {granted
          ? "Choose a destination next. PaceLine will keep tracking only while this journey is active."
          : "PaceLine needs precise position, speed, direction, and accuracy to calculate your live pace."}
      </p>
      {denied && <p className="permission-error">Location access is off. Enable it in browser settings, then retry.</p>}
      {unavailable && <p className="permission-error">A reliable location could not be obtained. Move outdoors and retry.</p>}
      <div className="setup-actions setup-actions--single">
        {granted
          ? <button className="primary-action" type="button" onClick={onContinue}>Choose destination <Icon name="route" /></button>
          : <button className="primary-action" type="button" onClick={onAllow} disabled={status === "requesting"}>{status === "requesting" ? "Acquiring location…" : denied || unavailable ? "Retry location" : "Allow location"}</button>}
      </div>
      <p className="safety-notice">Set up your route before driving. Do not interact with PaceLine while the vehicle is moving.</p>
    </section>
  );
}

export function DriveSetup({
  mapStatus,
  query,
  results,
  searching,
  planning,
  error,
  route,
  zoneResult,
  onQueryChange,
  onSearch,
  onSelect,
  onStart,
  onClearRoute,
}: {
  mapStatus: "loading" | "ready" | "error";
  query: string;
  results: DestinationResult[];
  searching: boolean;
  planning: boolean;
  error: string | null;
  route: RoutePlan | null;
  zoneResult: ZoneLoadResult | null;
  onQueryChange: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSelect: (result: DestinationResult) => void;
  onStart: () => void;
  onClearRoute: () => void;
}) {
  if (route) {
    return (
      <section className="instrument-panel setup-panel" aria-labelledby="route-title">
        <div className="panel-grip" aria-hidden="true" />
        <div className="setup-heading">
          <div>
            <p className="instrument-kicker">Route ready · live data</p>
            <h1 id="route-title">{route.destination.label}</h1>
          </div>
          <div className="route-bearing"><Icon name="route" /></div>
        </div>
        <div className="route-facts" aria-label="Journey overview">
          <span><strong>{formatDistance(route.distanceMeters)}</strong> distance</span>
          <span><strong>{Math.max(1, Math.ceil(route.durationSeconds / 60))} min</strong> estimated</span>
          <span><strong>{zoneResult?.zones.length ?? 0}</strong> pace zones</span>
        </div>
        <div className={`zone-coverage zone-coverage--${zoneResult?.status ?? "unavailable"}`}>
          <span />
          {zoneResult?.status === "loaded" && `${zoneResult.zones.length} average-speed ${zoneResult.zones.length === 1 ? "zone" : "zones"} found in ${zoneResult.source}.`}
          {zoneResult?.status === "none" && `No average-speed zones are mapped for this route in ${zoneResult.source}.`}
          {zoneResult?.status === "unavailable" && "Live average-speed-zone coverage could not be verified for this route."}
        </div>
        {mapStatus === "loading" && <p className="map-state"><span className="map-state-dot" />Preparing the map…</p>}
        {mapStatus === "error" && <p className="map-state map-state--error">Live map tiles are unavailable. Route tracking can still use the schematic.</p>}
        <div className="setup-actions">
          <button className="primary-action" type="button" onClick={onStart}>Start live drive <Icon name="location" /></button>
          <button className="secondary-action" type="button" onClick={onClearRoute}>Change route</button>
        </div>
        <p className="safety-notice"><strong>Check posted signs.</strong> Live map data can be incomplete or outdated. PaceLine is not an official traffic source.</p>
      </section>
    );
  }

  return (
    <section className="instrument-panel setup-panel" aria-labelledby="setup-title">
      <div className="panel-grip" aria-hidden="true" />
      <div className="setup-heading">
        <div>
          <p className="instrument-kicker">Current position ready</p>
          <h1 id="setup-title">Choose a destination</h1>
        </div>
        <div className="location-ready-mark"><span />GPS</div>
      </div>
      <form className="destination-form" onSubmit={onSearch}>
        <label htmlFor="destination">Destination</label>
        <div>
          <input id="destination" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Address, place, or city" autoComplete="off" enterKeyHint="search" />
          <button type="submit" aria-label="Search destinations" disabled={searching || query.trim().length < 2}><Icon name="search" /></button>
        </div>
      </form>
      {searching && <p className="map-state"><span className="map-state-dot" />Searching destinations…</p>}
      {planning && <p className="map-state"><span className="map-state-dot" />Building the live route and checking zone data…</p>}
      {error && <p className="permission-error">{error}</p>}
      {!!results.length && (
        <div className="destination-results" aria-label="Destination results">
          {results.map((result) => <button key={result.id} type="button" onClick={() => onSelect(result)}><Icon name="location" /><span>{result.label}</span><i>›</i></button>)}
        </div>
      )}
      {!results.length && !searching && !planning && <p className="route-search-hint">Search is sent once to the configured geocoder. Continuous location remains in this browser.</p>}
      <p className="safety-notice"><strong>Plan while parked.</strong> Follow road signs and local laws at all times.</p>
    </section>
  );
}

export function PaceRibbon({
  progress,
  targetProgress,
  remainingMeters,
  compliance,
}: {
  progress: number;
  targetProgress: number;
  remainingMeters: number;
  compliance: ComplianceState;
}) {
  const safeProgress = Math.max(0, Math.min(1, progress));
  const safeTarget = Math.max(0, Math.min(1, targetProgress));
  return (
    <div className={`pace-ribbon pace-ribbon--${compliance}`} aria-label={`Zone progress ${Math.round(safeProgress * 100)} percent. ${formatDistance(remainingMeters)} remaining.`}>
      <div className="ribbon-labels"><span>Point A</span><strong>{formatDistance(remainingMeters)} remaining</strong><span>Point B</span></div>
      <div className="ribbon-track">
        <span className="ribbon-complete" style={{ width: `${safeProgress * 100}%` }} />
        <span className="ribbon-target" style={{ left: `${safeTarget * 100}%` }}><i>Target</i></span>
        <span className="ribbon-vehicle" style={{ left: `${safeProgress * 100}%` }}><i /></span>
        <span className="ribbon-end ribbon-end--a">A</span>
        <span className="ribbon-end ribbon-end--b">B</span>
      </div>
    </div>
  );
}

export type DrivePanelMode = "route" | "approaching" | "active" | "complete";

export function DriveInstrumentPanel({
  mode,
  destinationName,
  currentSpeedKph,
  routeRemainingMeters,
  nextZoneDistanceMeters,
  mappedZoneCount,
  zone,
  session,
  elapsedSeconds,
  weakGps,
  completionAverageKph,
  onEnd,
}: {
  mode: DrivePanelMode;
  destinationName: string;
  currentSpeedKph: number | null;
  routeRemainingMeters: number;
  nextZoneDistanceMeters?: number;
  mappedZoneCount: number;
  zone?: AverageSpeedZone;
  session?: ZoneSession;
  elapsedSeconds: number;
  weakGps: boolean;
  completionAverageKph?: number;
  onEnd: () => void;
}) {
  const zoneProgress = zone && session ? session.distanceTravelledMeters / zone.lengthMeters : 0;
  const targetTotalSeconds = zone ? zone.lengthMeters / ((zone.enforcementLimitKph - zone.safetyBufferKph) / 3.6) : 1;
  const targetProgress = elapsedSeconds / targetTotalSeconds;
  const target = zone ? zone.enforcementLimitKph - zone.safetyBufferKph : 0;
  const average = session?.averageSpeedKph ?? 0;
  const compliance: ComplianceState = average > target + 0.5 ? "above" : average > target - 1.5 ? "attention" : "compliant";
  const remainingMeters = zone ? Math.max(0, zone.lengthMeters - (session?.distanceTravelledMeters ?? 0)) : 0;
  const estimatedExitSeconds = session?.recommendedMaxKph ? remainingMeters / (session.recommendedMaxKph / 3.6) : 0;
  const statusCopy = compliance === "above" ? "Slow gradually" : compliance === "attention" ? "Hold a steady pace" : "Pace is within the target";
  const currentSpeedLabel = currentSpeedKph === null ? "—" : Math.floor(currentSpeedKph);

  return (
    <section className={`instrument-panel drive-panel drive-panel--${mode} drive-panel--${compliance}`} aria-label="Drive instrument panel">
      <div className="panel-grip" aria-hidden="true" />
      {weakGps && <div className="gps-warning alert-arrival"><span />GPS signal is weak. Pace calculation is paused.</div>}
      {mode === "route" && (
        <div className="route-driving-state">
          <div><p className="instrument-kicker">Following live route</p><h2>{destinationName}</h2><p>{formatDistance(routeRemainingMeters)} to destination · {nextZoneDistanceMeters !== undefined ? `Zone in ${formatDistance(nextZoneDistanceMeters)}` : mappedZoneCount ? "No more pace zones" : "No mapped pace zones"}</p></div>
          <div className="current-speed-compact"><strong>{currentSpeedLabel}</strong><span>km/h</span></div>
        </div>
      )}
      {mode === "approaching" && zone && (
        <div className="approach-state alert-arrival">
          <div className="approach-mark">A</div>
          <div><p className="instrument-kicker">Average-speed zone ahead</p><h2>Starts in {formatDistance(nextZoneDistanceMeters ?? 0)}</h2><p>{zone.name} · Limit {zone.enforcementLimitKph} km/h</p></div>
          <div className="limit-sign" aria-label={`Limit ${zone.enforcementLimitKph}`}>{zone.enforcementLimitKph}</div>
        </div>
      )}
      {mode === "active" && zone && session && (
        <div className="active-state">
          <header className="active-zone-header"><div><p className="instrument-kicker">Average-speed zone</p><h2>{zone.name}</h2></div><div className="current-speed-label"><span>Current speed</span><strong>{currentSpeedLabel} <i>km/h</i></strong></div></header>
          <div className="primary-speed"><strong>{session.recommendedMaxKph}</strong><span>km/h</span><p>Recommended maximum</p></div>
          <div className="pace-status"><span className="pace-status-dot" />{statusCopy}</div>
          <div className="metric-row">
            <div><span>Average speed</span><strong>{Math.round(average)} <i>km/h</i></strong></div>
            <div><span>Zone limit</span><strong>{zone.enforcementLimitKph} <i>km/h</i></strong></div>
            <div><span>Distance left</span><strong>{formatDistance(remainingMeters)}</strong></div>
            <div><span>Time to exit</span><strong>{formatDuration(estimatedExitSeconds)}</strong></div>
          </div>
          <PaceRibbon progress={zoneProgress} targetProgress={targetProgress} remainingMeters={remainingMeters} compliance={compliance} />
        </div>
      )}
      {mode === "complete" && zone && (
        <div className="completion-state alert-arrival"><div className="completion-mark">A<span />B</div><div><p className="instrument-kicker">Average-speed zone complete</p><h2>{zone.name}</h2><p>Final average <strong>{Math.round(completionAverageKph ?? 0)} km/h</strong></p></div></div>
      )}
      <div className="drive-footer drive-footer--live"><span>Live tracking</span><button className="end-drive" type="button" onClick={onEnd}><Icon name="stop" /> End drive</button></div>
      <span className="sr-only" aria-live="polite">{weakGps ? "GPS signal is weak. Pace calculation is paused." : mode === "complete" ? "Average-speed zone complete." : mode === "active" ? statusCopy : ""}</span>
    </section>
  );
}

export function TripSummary({
  travelSeconds,
  zones,
  zoneSource,
  onPlanAnother,
}: {
  travelSeconds: number;
  zones: CompletedZoneSummary[];
  zoneSource: string;
  onPlanAnother: () => void;
}) {
  return (
    <section className="instrument-panel summary-panel" aria-labelledby="summary-title">
      <div className="panel-grip" aria-hidden="true" />
      <p className="instrument-kicker">Tracking stopped</p>
      <h1 id="summary-title">Drive summary</h1>
      <p className="summary-privacy">Only this summary is shown. Precise location history was not retained.</p>
      <div className="summary-total"><span>Travel time</span><strong>{formatDuration(travelSeconds)}</strong></div>
      <div className="summary-zones">
        <h2>{zones.length} average-speed zones completed</h2>
        {zones.map((zone) => <div key={zone.zoneId}><span className="summary-check">✓</span><span><strong>{zone.name}</strong><small>Final average · Limit {zone.limitKph} km/h</small></span><b>{Math.round(zone.finalAverageSpeedKph)} <i>km/h</i></b></div>)}
      </div>
      <button className="primary-action" type="button" onClick={onPlanAnother}>Plan another route <Icon name="route" /></button>
      <p className="safety-notice">Zone coverage source: {zoneSource}. Always follow posted signs.</p>
    </section>
  );
}
