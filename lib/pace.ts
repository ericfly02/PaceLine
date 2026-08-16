import type {
  AverageSpeedZone,
  ComplianceState,
  PaceResult,
  TrackingSample,
  ZoneProgressSpec,
  ZoneSession,
} from "@/lib/types";

export function calculatePace({
  zoneLengthMeters,
  distanceTravelledMeters,
  elapsedSeconds,
  enforcementLimitKph,
  postedRoadLimitKph,
  temporaryLimitKph,
  safetyBufferKph = 2,
}: {
  zoneLengthMeters: number;
  distanceTravelledMeters: number;
  elapsedSeconds: number;
  enforcementLimitKph: number;
  postedRoadLimitKph: number;
  temporaryLimitKph?: number;
  safetyBufferKph?: number;
}): PaceResult {
  const distance = Math.max(0, Math.min(distanceTravelledMeters, zoneLengthMeters));
  const elapsed = Math.max(0, elapsedSeconds);
  const remainingDistanceMeters = Math.max(0, zoneLengthMeters - distance);
  const averageSpeedKph = elapsed > 0 ? (distance / elapsed) * 3.6 : 0;
  const targetAverageKph = Math.max(enforcementLimitKph - safetyBufferKph, 1);
  const targetTotalSeconds = zoneLengthMeters / (targetAverageKph / 3.6);
  const remainingTimeBudgetSeconds = targetTotalSeconds - elapsed;
  const legalMaximumKph = Math.min(
    enforcementLimitKph,
    postedRoadLimitKph,
    temporaryLimitKph ?? Number.POSITIVE_INFINITY,
  );
  const paceRequiredKph =
    remainingDistanceMeters === 0
      ? 0
      : remainingTimeBudgetSeconds > 0
        ? (remainingDistanceMeters / remainingTimeBudgetSeconds) * 3.6
        : legalMaximumKph;
  const recommendedMaxKph = Math.floor(
    Math.max(0, Math.min(paceRequiredKph, legalMaximumKph)),
  );

  return {
    averageSpeedKph,
    targetAverageKph,
    remainingDistanceMeters,
    remainingTimeBudgetSeconds,
    paceRequiredKph,
    recommendedMaxKph,
  };
}

export function initialZoneSession(spec: ZoneProgressSpec): ZoneSession {
  return {
    zoneId: spec.zone.id,
    state: "upcoming",
    distanceTravelledMeters: 0,
    averageSpeedKph: 0,
    recommendedMaxKph: Math.floor(Math.max(0, Math.min(
      spec.zone.enforcementLimitKph - spec.zone.safetyBufferKph,
      spec.zone.postedRoadLimitKph,
      spec.zone.temporaryLimitKph ?? Number.POSITIVE_INFINITY,
    ))),
    lastRouteProgressMeters: 0,
    pausedDurationMs: 0,
    signalQuality: "reliable",
  };
}

export function advanceZoneSession(
  spec: ZoneProgressSpec,
  session: ZoneSession,
  sample: TrackingSample,
  routeProgressMeters: number,
  distanceFromCorridorMeters = 0,
  directionIsValid = true,
): ZoneSession {
  if (session.state === "completed") return session;

  const accuracyIsPoor = (sample.accuracyMeters ?? 0) > 50;
  if (accuracyIsPoor) {
    return {
      ...session,
      pausedAt: session.state === "active" ? (session.pausedAt ?? sample.timestamp) : session.pausedAt,
      signalQuality: "weak",
    };
  }

  const recoveredPauseMs = session.pausedAt ? Math.max(0, sample.timestamp - session.pausedAt) : 0;
  const pausedDurationMs = session.pausedDurationMs + recoveredPauseMs;
  const reliableBase: ZoneSession = {
    ...session,
    pausedAt: undefined,
    pausedDurationMs,
    signalQuality: "reliable",
    lastRouteProgressMeters: Math.max(session.lastRouteProgressMeters, routeProgressMeters),
  };

  if (session.state === "upcoming" && routeProgressMeters >= spec.startMeters - 1_000) {
    reliableBase.state = "approaching";
  }

  const nearCorridor = distanceFromCorridorMeters <= Math.max(spec.zone.entryRadiusMeters, 45);
  const insideEntryBoundary =
    routeProgressMeters >= spec.startMeters - spec.zone.entryRadiusMeters &&
    routeProgressMeters <= spec.startMeters + spec.zone.entryRadiusMeters;
  const crossingWindowMeters = Math.max(300, spec.zone.entryRadiusMeters * 4);
  const crossedEntryBetweenSamples =
    session.lastRouteProgressMeters >= spec.startMeters - crossingWindowMeters &&
    session.lastRouteProgressMeters < spec.startMeters &&
    routeProgressMeters > spec.startMeters &&
    routeProgressMeters <= spec.startMeters + crossingWindowMeters;
  const crossesEntry = insideEntryBoundary || crossedEntryBetweenSamples;

  if (
    (reliableBase.state === "upcoming" || reliableBase.state === "approaching") &&
    directionIsValid &&
    nearCorridor &&
    crossesEntry
  ) {
    reliableBase.state = "active";
    reliableBase.enteredAt = sample.timestamp;
    reliableBase.distanceTravelledMeters = Math.max(0, routeProgressMeters - spec.startMeters);
  }

  if (reliableBase.state !== "active" || reliableBase.enteredAt === undefined) return reliableBase;

  const distanceTravelledMeters = Math.max(
    reliableBase.distanceTravelledMeters,
    Math.min(spec.zone.lengthMeters, routeProgressMeters - spec.startMeters),
  );
  const elapsedSeconds = Math.max(
    0,
    (sample.timestamp - reliableBase.enteredAt - pausedDurationMs) / 1000,
  );
  const reachedExit = routeProgressMeters >= spec.endMeters - spec.zone.exitRadiusMeters;
  const measuredDistanceMeters = reachedExit ? spec.zone.lengthMeters : distanceTravelledMeters;
  const pace = calculatePace({
    zoneLengthMeters: spec.zone.lengthMeters,
    distanceTravelledMeters: measuredDistanceMeters,
    elapsedSeconds,
    enforcementLimitKph: spec.zone.enforcementLimitKph,
    postedRoadLimitKph: spec.zone.postedRoadLimitKph,
    temporaryLimitKph: spec.zone.temporaryLimitKph,
    safetyBufferKph: spec.zone.safetyBufferKph,
  });
  return {
    ...reliableBase,
    state: reachedExit ? "completed" : "active",
    exitedAt: reachedExit ? sample.timestamp : undefined,
    distanceTravelledMeters: measuredDistanceMeters,
    averageSpeedKph: pace.averageSpeedKph,
    recommendedMaxKph: pace.recommendedMaxKph,
    finalAverageSpeedKph: reachedExit ? pace.averageSpeedKph : undefined,
  };
}

export function zoneCompliance(
  averageSpeedKph: number,
  zone: Pick<AverageSpeedZone, "enforcementLimitKph" | "safetyBufferKph">,
): ComplianceState {
  const target = zone.enforcementLimitKph - zone.safetyBufferKph;
  if (averageSpeedKph > target + 0.5) return "above";
  if (averageSpeedKph > target - 1.5) return "attention";
  return "compliant";
}

export function smoothRecommendation(previous: number, next: number): number {
  const clampedNext = Math.max(0, next);
  if (!Number.isFinite(previous) || Math.abs(clampedNext - previous) >= 6) return clampedNext;
  const blended = Math.floor(previous + (clampedNext - previous) * 0.42);
  return clampedNext > previous
    ? Math.min(clampedNext, Math.max(previous + 1, blended))
    : Math.max(clampedNext, blended);
}
