import {
  bearingDegrees,
  coordinateAtDistance,
  cumulativeRouteDistances,
  nearestRouteProgress,
  routeSliceAtDistance,
} from "@/lib/geo";
import type {
  AverageSpeedZone,
  Coordinate,
  DestinationResult,
  RoutePlan,
  ZoneLoadResult,
} from "@/lib/types";

const GEOCODER_URL = process.env.NEXT_PUBLIC_GEOCODER_URL ?? "https://photon.komoot.io/api/";
const ROUTING_URL = process.env.NEXT_PUBLIC_ROUTING_URL ?? "https://router.project-osrm.org";
const OVERPASS_URL = process.env.NEXT_PUBLIC_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const ZONE_DATA_URL = process.env.NEXT_PUBLIC_ZONE_DATA_URL;

type PhotonFeature = {
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: Record<string, unknown>;
};

type OsrmResponse = {
  code?: string;
  message?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { type?: string; coordinates?: Array<[number, number]> };
  }>;
};

type OverpassMember = {
  type?: string;
  role?: string;
  lat?: number;
  lon?: number;
  geometry?: Array<{ lat: number; lon: number }>;
};

type OverpassRelation = {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  members?: OverpassMember[];
};

type GeoJsonFeature = {
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: Array<[number, number]> };
};

const finiteCoordinate = (coordinate: Coordinate) =>
  Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude);

function destinationLabel(properties: Record<string, unknown>): string {
  const parts = [
    properties.name,
    properties.street,
    properties.city ?? properties.locality,
    properties.state,
    properties.country,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return [...new Set(parts)].join(", ") || "Selected destination";
}

export async function searchDestinations(
  query: string,
  origin: Coordinate,
  signal?: AbortSignal,
): Promise<DestinationResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const url = new URL(GEOCODER_URL);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("limit", "5");
  url.searchParams.set("lat", String(origin.latitude));
  url.searchParams.set("lon", String(origin.longitude));
  url.searchParams.set("location_bias_scale", "0.35");

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Destination search is unavailable. Try again.");
  const payload = await response.json() as { features?: PhotonFeature[] };

  return (payload.features ?? []).flatMap((feature, index) => {
    const coordinates = feature.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) return [];
    const coordinate = { longitude: coordinates[0], latitude: coordinates[1] };
    if (!finiteCoordinate(coordinate)) return [];
    const properties = feature.properties ?? {};
    return [{
      id: String(properties.osm_id ?? `${coordinates.join(":")}-${index}`),
      label: destinationLabel(properties),
      coordinate,
    }];
  });
}

export async function fetchRoute(
  origin: Coordinate,
  destination: DestinationResult,
  signal?: AbortSignal,
): Promise<RoutePlan> {
  const base = ROUTING_URL.replace(/\/$/, "");
  const coordinates = `${origin.longitude},${origin.latitude};${destination.coordinate.longitude},${destination.coordinate.latitude}`;
  const url = new URL(`${base}/route/v1/driving/${coordinates}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");

  const response = await fetch(url, { signal });
  const payload = await response.json() as OsrmResponse;
  const route = payload.routes?.[0];
  if (!response.ok || payload.code !== "Ok" || !route?.geometry?.coordinates?.length) {
    throw new Error(payload.message || "A drivable route could not be found.");
  }

  const routeCoordinates = route.geometry.coordinates.map(([longitude, latitude]) => ({
    latitude,
    longitude,
  })).filter(finiteCoordinate);
  if (routeCoordinates.length < 2) throw new Error("The routing service returned an incomplete route.");

  return {
    destination,
    coordinates: routeCoordinates,
    distanceMeters: route.distance ?? 0,
    durationSeconds: route.duration ?? 0,
  };
}

function parseSpeedKph(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== "string") return null;
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(value.toLowerCase().includes("mph") ? numeric * 1.609344 : numeric);
}

function coordinateFromMember(member?: OverpassMember): Coordinate | null {
  if (!member || !Number.isFinite(member.lat) || !Number.isFinite(member.lon)) return null;
  return { latitude: member.lat!, longitude: member.lon! };
}

function mapZoneToRoute({
  id,
  name,
  entry,
  exit,
  section,
  enforcementLimitKph,
  postedRoadLimitKph,
  route,
  directional,
}: {
  id: string;
  name: string;
  entry: Coordinate;
  exit: Coordinate;
  section?: Coordinate[];
  enforcementLimitKph: number;
  postedRoadLimitKph: number;
  route: Coordinate[];
  directional: boolean;
}): AverageSpeedZone | null {
  const cumulative = cumulativeRouteDistances(route);
  let entryMatch = nearestRouteProgress(route, cumulative, entry);
  let exitMatch = nearestRouteProgress(route, cumulative, exit);
  let routeEntry = entry;
  let routeExit = exit;

  if (entryMatch.distanceFromRouteMeters > 90 || exitMatch.distanceFromRouteMeters > 90) return null;
  if (entryMatch.progressMeters > exitMatch.progressMeters) {
    if (directional) return null;
    [entryMatch, exitMatch] = [exitMatch, entryMatch];
    [routeEntry, routeExit] = [routeExit, routeEntry];
  }
  if (exitMatch.progressMeters - entryMatch.progressMeters < 100) return null;

  if (section && section.length > 1) {
    const sampleStep = Math.max(1, Math.floor(section.length / 8));
    const sectionFitsRoute = section
      .filter((_, index) => index % sampleStep === 0)
      .every((coordinate) => nearestRouteProgress(route, cumulative, coordinate).distanceFromRouteMeters <= 100);
    if (!sectionFitsRoute) return null;
  }

  const corridor = routeSliceAtDistance(
    route,
    cumulative,
    entryMatch.progressMeters,
    exitMatch.progressMeters,
  );
  const bearingTarget = coordinateAtDistance(
    route,
    cumulative,
    Math.min(exitMatch.progressMeters, entryMatch.progressMeters + 80),
  ).coordinate;

  return {
    id,
    name,
    entry: routeEntry,
    exit: routeExit,
    corridor,
    lengthMeters: exitMatch.progressMeters - entryMatch.progressMeters,
    directionBearing: bearingDegrees(routeEntry, bearingTarget),
    enforcementLimitKph,
    postedRoadLimitKph,
    safetyBufferKph: 2,
    entryRadiusMeters: 35,
    exitRadiusMeters: 40,
  };
}

function zonesFromOverpass(payload: { elements?: OverpassRelation[] }, route: Coordinate[]): AverageSpeedZone[] {
  return (payload.elements ?? []).flatMap((relation) => {
    if (relation.type !== "relation" || !relation.id) return [];
    const limit = parseSpeedKph(relation.tags?.maxspeed);
    if (!limit) return [];
    const members = relation.members ?? [];
    const entry = coordinateFromMember(members.find((member) => member.role === "from"));
    const exit = coordinateFromMember(
      members.find((member) => member.role === "to") ??
      members.findLast((member) => member.role === "device"),
    );
    if (!entry || !exit) return [];
    const sectionMember = members.find((member) => member.role === "section");
    const section = sectionMember?.geometry?.map(({ lat, lon }) => ({ latitude: lat, longitude: lon }));
    const mapped = mapZoneToRoute({
      id: `osm-${relation.id}`,
      name: relation.tags?.name || "Average-speed zone",
      entry,
      exit,
      section,
      enforcementLimitKph: limit,
      postedRoadLimitKph: limit,
      route,
      directional: true,
    });
    return mapped ? [mapped] : [];
  });
}

function zonesFromGeoJson(payload: { features?: GeoJsonFeature[] }, route: Coordinate[]): AverageSpeedZone[] {
  return (payload.features ?? []).flatMap((feature, index) => {
    if (feature.geometry?.type !== "LineString" || !feature.geometry.coordinates?.length) return [];
    const corridor = feature.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
    const properties = feature.properties ?? {};
    const limit = parseSpeedKph(
      properties.enforcementLimitKph ?? properties.maxspeed ?? properties.limit,
    );
    if (!limit || corridor.length < 2) return [];
    const posted = parseSpeedKph(properties.postedRoadLimitKph) ?? limit;
    const mapped = mapZoneToRoute({
      id: String(feature.id ?? properties.id ?? `feed-zone-${index}`),
      name: typeof properties.name === "string" ? properties.name : "Average-speed zone",
      entry: corridor[0],
      exit: corridor.at(-1)!,
      section: corridor,
      enforcementLimitKph: limit,
      postedRoadLimitKph: posted,
      route,
      directional: false,
    });
    return mapped ? [mapped] : [];
  });
}

export async function fetchAverageSpeedZones(
  route: RoutePlan,
  signal?: AbortSignal,
): Promise<ZoneLoadResult> {
  try {
    if (ZONE_DATA_URL) {
      const response = await fetch(ZONE_DATA_URL, { signal });
      if (!response.ok) throw new Error("Zone feed unavailable");
      const zones = zonesFromGeoJson(await response.json() as { features?: GeoJsonFeature[] }, route.coordinates);
      return { zones, status: zones.length ? "loaded" : "none", source: "Configured zone feed" };
    }

    const latitudes = route.coordinates.map((point) => point.latitude);
    const longitudes = route.coordinates.map((point) => point.longitude);
    const south = Math.min(...latitudes) - 0.012;
    const north = Math.max(...latitudes) + 0.012;
    const west = Math.min(...longitudes) - 0.018;
    const east = Math.max(...longitudes) + 0.018;
    if (route.distanceMeters > 150_000 || (north - south) * (east - west) > 1.5) {
      return { zones: [], status: "unavailable", source: "OpenStreetMap" };
    }

    const query = `[out:json][timeout:18];relation["type"="enforcement"]["enforcement"="average_speed"](${south},${west},${north},${east});out body geom;`;
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ data: query }),
      signal,
    });
    if (!response.ok) throw new Error("Zone lookup unavailable");
    const zones = zonesFromOverpass(await response.json() as { elements?: OverpassRelation[] }, route.coordinates);
    return { zones, status: zones.length ? "loaded" : "none", source: "OpenStreetMap" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { zones: [], status: "unavailable", source: ZONE_DATA_URL ? "Configured zone feed" : "OpenStreetMap" };
  }
}
