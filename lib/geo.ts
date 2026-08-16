import type { Coordinate } from "@/lib/types";

const EARTH_RADIUS_METERS = 6_371_000;

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (radiansValue: number) => (radiansValue * 180) / Math.PI;

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const latitudeA = radians(a.latitude);
  const latitudeB = radians(b.latitude);
  const h =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function bearingDegrees(a: Coordinate, b: Coordinate): number {
  const latitudeA = radians(a.latitude);
  const latitudeB = radians(b.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(latitudeB);
  const x =
    Math.cos(latitudeA) * Math.sin(latitudeB) -
    Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta);

  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

export function bearingDifference(a: number, b: number): number {
  const difference = Math.abs(((a - b + 540) % 360) - 180);
  return Math.min(difference, 180);
}

export function cumulativeRouteDistances(route: Coordinate[]): number[] {
  const distances = [0];
  for (let index = 1; index < route.length; index += 1) {
    distances.push(distances[index - 1] + distanceMeters(route[index - 1], route[index]));
  }
  return distances;
}

export function coordinateAtDistance(
  route: Coordinate[],
  cumulative: number[],
  requestedDistance: number,
): { coordinate: Coordinate; headingDegrees: number } {
  const distance = Math.max(0, Math.min(requestedDistance, cumulative.at(-1) ?? 0));
  let segment = 1;
  while (segment < cumulative.length - 1 && cumulative[segment] < distance) segment += 1;

  const from = route[Math.max(0, segment - 1)];
  const to = route[segment] ?? from;
  const segmentLength = Math.max(cumulative[segment] - cumulative[segment - 1], 1);
  const progress = Math.max(0, Math.min(1, (distance - cumulative[segment - 1]) / segmentLength));

  return {
    coordinate: {
      latitude: from.latitude + (to.latitude - from.latitude) * progress,
      longitude: from.longitude + (to.longitude - from.longitude) * progress,
    },
    headingDegrees: bearingDegrees(from, to),
  };
}

export function routeSliceAtDistance(
  route: Coordinate[],
  cumulative: number[],
  startDistance: number,
  endDistance: number,
): Coordinate[] {
  const start = coordinateAtDistance(route, cumulative, startDistance).coordinate;
  const end = coordinateAtDistance(route, cumulative, endDistance).coordinate;
  const middle = route.filter(
    (_, index) => cumulative[index] > startDistance && cumulative[index] < endDistance,
  );
  return [start, ...middle, end];
}

export function nearestRouteProgress(
  route: Coordinate[],
  cumulative: number[],
  coordinate: Coordinate,
): { progressMeters: number; distanceFromRouteMeters: number } {
  // Local equirectangular projection is accurate enough for short road corridors.
  const latitudeScale = 111_320;
  const longitudeScale = latitudeScale * Math.cos(radians(coordinate.latitude));
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;

  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    const ax = (from.longitude - coordinate.longitude) * longitudeScale;
    const ay = (from.latitude - coordinate.latitude) * latitudeScale;
    const bx = (to.longitude - coordinate.longitude) * longitudeScale;
    const by = (to.latitude - coordinate.latitude) * latitudeScale;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy || 1;
    const projection = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    const px = ax + projection * dx;
    const py = ay + projection * dy;
    const projectedDistance = Math.hypot(px, py);

    if (projectedDistance < bestDistance) {
      bestDistance = projectedDistance;
      bestProgress =
        cumulative[index - 1] + projection * (cumulative[index] - cumulative[index - 1]);
    }
  }

  return { progressMeters: bestProgress, distanceFromRouteMeters: bestDistance };
}

export function formatDistance(meters: number): string {
  if (meters < 950) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}
