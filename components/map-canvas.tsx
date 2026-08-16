"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttributionControl,
  type GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
} from "maplibre-gl";
import { cumulativeRouteDistances, routeSliceAtDistance } from "@/lib/geo";
import { zoneCompliance } from "@/lib/pace";
import type {
  AverageSpeedZone,
  Coordinate,
  LiveSnapshot,
  ZoneProgressSpec,
  ZoneSession,
} from "@/lib/types";

const LIGHT_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT ?? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const DARK_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_DARK ?? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const WORLD_CENTER: Coordinate = { latitude: 20, longitude: 0 };

const lineFeature = (coordinates: Coordinate[], properties: Record<string, unknown> = {}) => {
  const safeCoordinates = coordinates.length >= 2
    ? coordinates
    : [coordinates[0] ?? WORLD_CENTER, coordinates[0] ?? WORLD_CENTER];
  return {
    type: "Feature" as const,
    properties,
    geometry: {
      type: "LineString" as const,
      coordinates: safeCoordinates.map(({ longitude, latitude }) => [longitude, latitude]),
    },
  };
};

const featureCollection = (features: ReturnType<typeof lineFeature>[]) => ({
  type: "FeatureCollection" as const,
  features,
});

function statusColor(zone: AverageSpeedZone, session?: ZoneSession): string {
  if (session?.state === "completed") return "#34C98F";
  if (session?.state === "active") {
    const compliance = zoneCompliance(session.averageSpeedKph, zone);
    return compliance === "above" ? "#F05B50" : compliance === "attention" ? "#F4A62A" : "#34C98F";
  }
  return "#F4A62A";
}

function markerElement(kind: "entry" | "exit", label: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = `boundary-marker boundary-marker--${kind}`;
  element.textContent = label;
  element.setAttribute("aria-label", kind === "entry" ? "Average-speed zone entry" : "Average-speed zone exit");
  return element;
}

function vehicleElement(): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "vehicle-marker";
  element.innerHTML = '<span aria-hidden="true"></span>';
  element.setAttribute("aria-label", "Current vehicle position");
  return element;
}

type MapCanvasProps = {
  route: Coordinate[];
  snapshot: LiveSnapshot | null;
  zones: AverageSpeedZone[];
  zoneSpecs: ZoneProgressSpec[];
  sessions: ZoneSession[];
  driving: boolean;
  followVehicle: boolean;
  onFollowVehicleChange: (following: boolean) => void;
  onMapStatusChange: (status: "loading" | "ready" | "error") => void;
};

export function MapCanvas({
  route,
  snapshot,
  zones,
  zoneSpecs,
  sessions,
  driving,
  followVehicle,
  onFollowVehicleChange,
  onMapStatusChange,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleMarkerRef = useRef<Marker | null>(null);
  const boundaryMarkersRef = useRef<Array<{ marker: Marker; zoneId: string; element: HTMLDivElement }>>([]);
  const lastFollowAtRef = useRef(0);
  const fittedRouteRef = useRef("");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const cumulative = useMemo(() => cumulativeRouteDistances(route), [route]);
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.zoneId, session])),
    [sessions],
  );

  const fallbackProjection = useMemo(() => {
    const basis = route.length >= 2
      ? route
      : snapshot
        ? [
            { latitude: snapshot.coordinate.latitude - 0.01, longitude: snapshot.coordinate.longitude - 0.01 },
            { latitude: snapshot.coordinate.latitude + 0.01, longitude: snapshot.coordinate.longitude + 0.01 },
          ]
        : [{ latitude: -1, longitude: -1 }, { latitude: 1, longitude: 1 }];
    const longitudes = basis.map((point) => point.longitude);
    const latitudes = basis.map((point) => point.latitude);
    const minLongitude = Math.min(...longitudes);
    const maxLongitude = Math.max(...longitudes);
    const minLatitude = Math.min(...latitudes);
    const maxLatitude = Math.max(...latitudes);
    const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.0001);
    const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.0001);
    const project = ({ longitude, latitude }: Coordinate) => ({
      x: 100 + ((longitude - minLongitude) / longitudeSpan) * 800,
      y: 100 + (1 - (latitude - minLatitude) / latitudeSpan) * 800,
    });
    const points = (coordinates: Coordinate[]) =>
      coordinates.map((coordinate) => {
        const point = project(coordinate);
        return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
      }).join(" ");
    return { project, points };
  }, [route, snapshot]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: dark ? DARK_STYLE : LIGHT_STYLE,
        center: snapshot
          ? [snapshot.coordinate.longitude, snapshot.coordinate.latitude]
          : [WORLD_CENTER.longitude, WORLD_CENTER.latitude],
        zoom: snapshot ? 13 : 2.2,
        pitch: 18,
        attributionControl: false,
        cooperativeGestures: true,
      });
    } catch {
      requestAnimationFrame(() => {
        setFailed(true);
        onMapStatusChange("error");
      });
      return;
    }

    mapRef.current = map;
    map.addControl(new AttributionControl({ compact: true }), "bottom-left");
    const loadingTimeout = window.setTimeout(() => {
      if (!map.loaded()) {
        setFailed(true);
        onMapStatusChange("error");
      }
    }, 12_000);

    map.on("load", () => {
      window.clearTimeout(loadingTimeout);
      map.addSource("route-base", { type: "geojson", data: lineFeature([]) });
      map.addSource("zones", { type: "geojson", data: featureCollection([]) });
      map.addSource("zone-progress", { type: "geojson", data: featureCollection([]) });
      map.addSource("route-active", { type: "geojson", data: lineFeature([]) });
      map.addSource("zone-remaining", { type: "geojson", data: lineFeature([], { color: "#34C98F" }) });
      const firstLabelLayer = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;

      map.addLayer({ id: "route-shadow", type: "line", source: "route-base", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#111317", "line-width": 10, "line-opacity": 0.2, "line-blur": 1.5 } }, firstLabelLayer);
      map.addLayer({ id: "route-base-line", type: "line", source: "route-base", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": dark ? "#69717E" : "#AAB0B9", "line-width": 6, "line-opacity": 0.9 } }, firstLabelLayer);
      map.addLayer({ id: "zone-corridor-outer", type: "line", source: "zones", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 14, "line-opacity": 0.16, "line-blur": 0.5 } }, firstLabelLayer);
      map.addLayer({ id: "zone-corridor", type: "line", source: "zones", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.78 } }, firstLabelLayer);
      map.addLayer({ id: "zone-progress-line", type: "line", source: "zone-progress", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 8, "line-opacity": 0.54 } }, firstLabelLayer);
      map.addLayer({ id: "route-active-line", type: "line", source: "route-active", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2768F5", "line-width": 5, "line-opacity": 1 } }, firstLabelLayer);
      map.addLayer({ id: "zone-remaining-line", type: "line", source: "zone-remaining", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 7, "line-opacity": 0.98 } }, firstLabelLayer);

      setLoaded(true);
      setFailed(false);
      onMapStatusChange("ready");
    });

    map.on("dragstart", () => onFollowVehicleChange(false));
    map.on("error", () => {
      if (!map.loaded()) {
        setFailed(true);
        onMapStatusChange("error");
      }
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);
    return () => {
      window.clearTimeout(loadingTimeout);
      resizeObserver.disconnect();
      boundaryMarkersRef.current.forEach(({ marker }) => marker.remove());
      boundaryMarkersRef.current = [];
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // Map creation is one-time; route and position updates use sources below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const map = mapRef.current;
    boundaryMarkersRef.current.forEach(({ marker }) => marker.remove());
    boundaryMarkersRef.current = [];
    zones.forEach((zone) => {
      const entryElement = markerElement("entry", "A");
      const exitElement = markerElement("exit", "B");
      boundaryMarkersRef.current.push({ marker: new Marker({ element: entryElement }).setLngLat([zone.entry.longitude, zone.entry.latitude]).addTo(map), zoneId: zone.id, element: entryElement });
      boundaryMarkersRef.current.push({ marker: new Marker({ element: exitElement }).setLngLat([zone.exit.longitude, zone.exit.latitude]).addTo(map), zoneId: zone.id, element: exitElement });
    });
  }, [loaded, zones]);

  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const map = mapRef.current;
    const routeEnd = cumulative.at(-1) ?? 0;
    (map.getSource("route-base") as GeoJSONSource | undefined)?.setData(lineFeature(route));
    (map.getSource("route-active") as GeoJSONSource | undefined)?.setData(
      lineFeature(route.length >= 2 && snapshot
        ? routeSliceAtDistance(route, cumulative, snapshot.routeProgressMeters, routeEnd)
        : route),
    );
    (map.getSource("zones") as GeoJSONSource | undefined)?.setData(featureCollection(
      zones.map((zone) => lineFeature(zone.corridor, { zoneId: zone.id, color: statusColor(zone, sessionById.get(zone.id)) })),
    ));

    const progressFeatures = zoneSpecs.flatMap((spec) => {
      const session = sessionById.get(spec.zone.id);
      if (!session || (session.state !== "active" && session.state !== "completed")) return [];
      const end = session.state === "completed" ? spec.endMeters : snapshot?.routeProgressMeters ?? spec.startMeters;
      return [lineFeature(routeSliceAtDistance(route, cumulative, spec.startMeters, end), { color: statusColor(spec.zone, session) })];
    });
    (map.getSource("zone-progress") as GeoJSONSource | undefined)?.setData(featureCollection(progressFeatures));

    const activeSpec = zoneSpecs.find((spec) => sessionById.get(spec.zone.id)?.state === "active");
    const activeSession = activeSpec ? sessionById.get(activeSpec.zone.id) : undefined;
    (map.getSource("zone-remaining") as GeoJSONSource | undefined)?.setData(
      lineFeature(activeSpec && activeSession && snapshot
        ? routeSliceAtDistance(route, cumulative, snapshot.routeProgressMeters, activeSpec.endMeters)
        : [], { color: activeSpec ? statusColor(activeSpec.zone, activeSession) : "#34C98F" }),
    );
    boundaryMarkersRef.current.forEach(({ zoneId, element }) => {
      element.dataset.state = sessionById.get(zoneId)?.state ?? "upcoming";
    });

    if (snapshot) {
      if (!vehicleMarkerRef.current) {
        vehicleMarkerRef.current = new Marker({ element: vehicleElement(), rotationAlignment: "map" })
          .setLngLat([snapshot.coordinate.longitude, snapshot.coordinate.latitude]).addTo(map);
      }
      vehicleMarkerRef.current.setLngLat([snapshot.coordinate.longitude, snapshot.coordinate.latitude]).setRotation(snapshot.headingDegrees ?? 0);
      if (driving && followVehicle && performance.now() - lastFollowAtRef.current > 450) {
        lastFollowAtRef.current = performance.now();
        map.easeTo({ center: [snapshot.coordinate.longitude, snapshot.coordinate.latitude], zoom: 14.4, pitch: 42, bearing: snapshot.headingDegrees ?? map.getBearing(), offset: [window.innerWidth >= 700 ? -190 : 0, Math.min(window.innerHeight * 0.13, 110)], duration: 600, essential: false });
      } else if (!route.length && !driving) {
        map.easeTo({ center: [snapshot.coordinate.longitude, snapshot.coordinate.latitude], zoom: 13, duration: 450 });
      }
    }

    if (route.length >= 2 && !driving) {
      const routeKey = `${route.length}:${route[0].latitude}:${route.at(-1)?.latitude}`;
      if (fittedRouteRef.current !== routeKey) {
        fittedRouteRef.current = routeKey;
        const bounds = new LngLatBounds();
        route.forEach(({ longitude, latitude }) => bounds.extend([longitude, latitude]));
        const hasInstrumentRail = window.innerWidth >= 700;
        map.fitBounds(bounds, { padding: { top: 96, right: hasInstrumentRail ? 430 : 48, bottom: hasInstrumentRail ? 48 : 330, left: 48 }, duration: 550 });
      }
    }
  }, [cumulative, driving, followVehicle, loaded, route, sessionById, snapshot, zoneSpecs, zones]);

  const fallbackVehicle = snapshot ? fallbackProjection.project(snapshot.coordinate) : null;

  return (
    <div className="map-shell" aria-label="PaceLine route map" role="region">
      <div className="map-fallback" aria-hidden="true">
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
          <g className="fallback-roads">
            <path d="M-80 175C180 240 215 70 480 180S775 390 1080 270" />
            <path d="M-60 540C205 440 340 565 540 520S765 345 1070 480" />
            <path d="M40 940C270 740 370 800 510 690S805 625 1040 745" />
            <path d="M145 -50C230 190 420 300 330 535S230 810 330 1050" />
            <path d="M720 -40C620 165 770 320 680 520S520 775 650 1040" />
          </g>
          {route.length >= 2 && <>
            <polyline className="fallback-route-shadow" points={fallbackProjection.points(route)} />
            <polyline className="fallback-route" points={fallbackProjection.points(route)} />
            {zones.map((zone) => <polyline key={zone.id} className="fallback-zone" points={fallbackProjection.points(zone.corridor)} />)}
            {zones.flatMap((zone) => [
              <g key={`${zone.id}-a`} className="fallback-boundary" transform={`translate(${fallbackProjection.project(zone.entry).x.toFixed(2)} ${fallbackProjection.project(zone.entry).y.toFixed(2)})`}><circle r="16" /><text>A</text></g>,
              <g key={`${zone.id}-b`} className="fallback-boundary fallback-boundary--exit" transform={`translate(${fallbackProjection.project(zone.exit).x.toFixed(2)} ${fallbackProjection.project(zone.exit).y.toFixed(2)})`}><rect x="-15" y="-15" width="30" height="30" rx="7" /><text>B</text></g>,
            ])}
          </>}
          {fallbackVehicle && <g className="fallback-vehicle" transform={`translate(${fallbackVehicle.x.toFixed(2)} ${fallbackVehicle.y.toFixed(2)}) rotate(${((snapshot?.headingDegrees ?? 0) + 45).toFixed(2)})`}><path d="M0-20 14 17 0 11-14 17Z" /></g>}
        </svg>
        <span>{failed ? "Route schematic · offline map fallback" : route.length ? "Route schematic · map loading" : snapshot ? "Current position · map loading" : "Waiting for location"}</span>
      </div>
      <div ref={containerRef} className={`map-canvas ${loaded ? "map-canvas--loaded" : ""}`} />
    </div>
  );
}
