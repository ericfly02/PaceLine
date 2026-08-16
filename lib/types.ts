export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type AverageSpeedZone = {
  id: string;
  name: string;
  directionBearing?: number;
  entry: Coordinate;
  exit: Coordinate;
  corridor: Coordinate[];
  lengthMeters: number;
  enforcementLimitKph: number;
  postedRoadLimitKph: number;
  temporaryLimitKph?: number;
  safetyBufferKph: number;
  entryRadiusMeters: number;
  exitRadiusMeters: number;
};

export type TrackingSample = {
  coordinate: Coordinate;
  timestamp: number;
  speedMps: number | null;
  accuracyMeters?: number;
  headingDegrees?: number | null;
};

export type ZoneState = "upcoming" | "approaching" | "active" | "completed";
export type SignalQuality = "reliable" | "weak";

export type ZoneSession = {
  zoneId: string;
  state: ZoneState;
  enteredAt?: number;
  exitedAt?: number;
  distanceTravelledMeters: number;
  averageSpeedKph: number;
  recommendedMaxKph: number;
  finalAverageSpeedKph?: number;
  lastRouteProgressMeters: number;
  pausedAt?: number;
  pausedDurationMs: number;
  signalQuality: SignalQuality;
};

export type ZoneProgressSpec = {
  zone: AverageSpeedZone;
  startMeters: number;
  endMeters: number;
};

export type PaceResult = {
  averageSpeedKph: number;
  targetAverageKph: number;
  remainingDistanceMeters: number;
  remainingTimeBudgetSeconds: number;
  paceRequiredKph: number;
  recommendedMaxKph: number;
};

export type LiveSnapshot = TrackingSample & {
  routeProgressMeters: number;
  distanceFromRouteMeters: number;
};

export type DestinationResult = {
  id: string;
  label: string;
  coordinate: Coordinate;
};

export type RoutePlan = {
  destination: DestinationResult;
  coordinates: Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
};

export type ZoneLoadResult = {
  zones: AverageSpeedZone[];
  status: "loaded" | "none" | "unavailable";
  source: string;
};

export type DriveStage = "permission" | "setup" | "ready" | "driving" | "summary";
export type ComplianceState = "compliant" | "attention" | "above";

export type CompletedZoneSummary = {
  zoneId: string;
  name: string;
  finalAverageSpeedKph: number;
  limitKph: number;
};
