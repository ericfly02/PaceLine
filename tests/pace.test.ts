import { describe, expect, it } from "vitest";
import { advanceZoneSession, calculatePace, initialZoneSession, smoothRecommendation } from "@/lib/pace";
import type { AverageSpeedZone, TrackingSample, ZoneProgressSpec } from "@/lib/types";

const zone: AverageSpeedZone = {
  id: "test-zone",
  name: "Test zone",
  entry: { latitude: 0, longitude: 0 },
  exit: { latitude: 0, longitude: 0.01 },
  corridor: [],
  lengthMeters: 1_000,
  enforcementLimitKph: 80,
  postedRoadLimitKph: 80,
  safetyBufferKph: 2,
  entryRadiusMeters: 35,
  exitRadiusMeters: 40,
};

const spec: ZoneProgressSpec = { zone, startMeters: 1_000, endMeters: 2_000 };
const sample = (timestamp: number, accuracyMeters = 5): TrackingSample => ({
  coordinate: { latitude: 0, longitude: 0 },
  timestamp,
  speedMps: 20,
  accuracyMeters,
});

describe("calculatePace", () => {
  it("recommends the target pace when the average is exactly on target", () => {
    const result = calculatePace({
      zoneLengthMeters: 10_000,
      distanceTravelledMeters: 5_000,
      elapsedSeconds: 5_000 / (78 / 3.6),
      enforcementLimitKph: 80,
      postedRoadLimitKph: 80,
      safetyBufferKph: 2,
    });
    expect(result.averageSpeedKph).toBeCloseTo(78);
    expect(result.recommendedMaxKph).toBe(78);
  });

  it("lowers the recommendation when the average is above target", () => {
    const result = calculatePace({
      zoneLengthMeters: 10_000,
      distanceTravelledMeters: 5_000,
      elapsedSeconds: 5_000 / (84 / 3.6),
      enforcementLimitKph: 80,
      postedRoadLimitKph: 80,
      safetyBufferKph: 2,
    });
    expect(result.recommendedMaxKph).toBeLessThan(78);
  });

  it("never exceeds the posted limit when well below target", () => {
    const result = calculatePace({
      zoneLengthMeters: 10_000,
      distanceTravelledMeters: 1_000,
      elapsedSeconds: 100,
      enforcementLimitKph: 100,
      postedRoadLimitKph: 70,
      safetyBufferKph: 2,
    });
    expect(result.recommendedMaxKph).toBe(70);
  });

  it("handles zero elapsed time without division by zero", () => {
    const result = calculatePace({
      zoneLengthMeters: 10_000,
      distanceTravelledMeters: 0,
      elapsedSeconds: 0,
      enforcementLimitKph: 80,
      postedRoadLimitKph: 80,
      safetyBufferKph: 2,
    });
    expect(result.averageSpeedKph).toBe(0);
    expect(result.recommendedMaxKph).toBe(78);
    expect(Number.isFinite(result.paceRequiredKph)).toBe(true);
  });

  it("returns zero remaining distance for a completed zone", () => {
    const result = calculatePace({
      zoneLengthMeters: 1_000,
      distanceTravelledMeters: 1_500,
      elapsedSeconds: 60,
      enforcementLimitKph: 80,
      postedRoadLimitKph: 80,
    });
    expect(result.remainingDistanceMeters).toBe(0);
    expect(result.recommendedMaxKph).toBe(0);
  });

  it("lets a smoothed whole-number recommendation move in both directions", () => {
    expect(smoothRecommendation(68, 70)).toBe(69);
    expect(smoothRecommendation(70, 68)).toBe(69);
  });
});

describe("zone session transitions", () => {
  it("does not activate from a first sample far beyond the entry boundary", () => {
    const late = advanceZoneSession(spec, initialZoneSession(spec), sample(1_000), 1_500);

    expect(late.state).not.toBe("active");
    expect(late.enteredAt).toBeUndefined();
  });

  it("does not let a poor GPS sample corrupt an active session", () => {
    const entered = advanceZoneSession(spec, initialZoneSession(spec), sample(1_000), 1_000);
    const reliable = advanceZoneSession(spec, entered, sample(11_000), 1_200);
    const weak = advanceZoneSession(spec, reliable, sample(21_000, 120), 1_500);

    expect(reliable.state).toBe("active");
    expect(weak.signalQuality).toBe("weak");
    expect(weak.distanceTravelledMeters).toBe(reliable.distanceTravelledMeters);
    expect(weak.averageSpeedKph).toBe(reliable.averageSpeedKph);
  });

  it("keeps a completed zone terminal through boundary jitter", () => {
    const entered = advanceZoneSession(spec, initialZoneSession(spec), sample(1_000), 1_000);
    const completed = advanceZoneSession(spec, entered, sample(61_000), 1_970);
    const jitteredBack = advanceZoneSession(spec, completed, sample(62_000), 1_920);
    const jitteredForward = advanceZoneSession(spec, jitteredBack, sample(63_000), 1_980);

    expect(completed.state).toBe("completed");
    expect(jitteredBack).toEqual(completed);
    expect(jitteredForward).toEqual(completed);
    expect(jitteredForward.enteredAt).toBe(entered.enteredAt);
  });
});
