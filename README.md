# PaceLine

PaceLine is a mobile-first, live driving companion for staying within legal limits in average-speed enforcement zones. It uses browser geolocation, live route search, route geometry, and mapped OpenStreetMap enforcement relations. There is no simulator, account, backend, analytics, or retained location history.

PaceLine is a driving aid, not an official traffic source. Route and zone data can be incomplete or outdated. Follow posted road signs and local laws, and configure the route while parked.

## Install and run

Requirements: Node.js 20.9 or newer and a browser with the Geolocation API.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Localhost is considered a secure context by current browsers. For testing from another phone or for production, serve the app over HTTPS.

To begin:

1. Allow precise location access.
2. Search for a destination and select a result.
3. Review the route and live zone-coverage status while parked.
4. Select **Start live drive**.

The location watcher is released when the drive ends or the app unmounts.

## Environment

Copy the example configuration if you want to replace any public default:

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_MAP_STYLE_LIGHT=https://basemaps.cartocdn.com/gl/positron-gl-style/style.json
NEXT_PUBLIC_MAP_STYLE_DARK=https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json
NEXT_PUBLIC_GEOCODER_URL=https://photon.komoot.io/api/
NEXT_PUBLIC_ROUTING_URL=https://router.project-osrm.org
NEXT_PUBLIC_OVERPASS_URL=https://overpass-api.de/api/interpreter
# NEXT_PUBLIC_ZONE_DATA_URL=https://data.example.com/average-speed-zones.geojson
```

The included public Photon, OSRM, Overpass, and map-style endpoints are convenient for local evaluation but do not provide a PaceLine service-level guarantee. For production traffic, use providers whose quotas and terms fit the deployment or operate compatible services yourself.

`NEXT_PUBLIC_ZONE_DATA_URL` takes precedence over Overpass. It must return a GeoJSON `FeatureCollection` of directed `LineString` corridors. Each feature needs an enforcement limit and can specify a separate posted limit:

```json
{
  "type": "Feature",
  "id": "corridor-42",
  "properties": {
    "name": "Northern approach",
    "enforcementLimitKph": 80,
    "postedRoadLimitKph": 80
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [[-3.7, 40.4], [-3.69, 40.41]]
  }
}
```

## Live data flow and privacy

- Destination text and the current start coordinate are sent to the configured geocoder when the user searches.
- Start and destination coordinates are sent to the configured routing service once when a destination is selected.
- A route bounding box is sent to the configured zone source to find mapped average-speed corridors.
- Continuous GPS samples, pace calculations, and the active zone session stay in the browser.
- Only the sound preference is stored in `localStorage`; precise location history is not persisted.

## Pace calculation

All calculations use meters, seconds, and meters per second internally. The target average is the enforcement limit minus the configured safety buffer. PaceLine computes the speed required over the remaining corridor to finish at that target, caps it at the enforcement, posted, and temporary limits, then rounds down to a whole km/h. Weak or off-route GPS samples pause the active calculation without presenting stale data as live.

Focused tests cover target pace, above-target recovery, legal-limit caps, zero elapsed time, completion, weak GPS, and duplicate boundary activation:

```bash
npm run test
npm run typecheck
npm run lint
npm run build
```

## Current limitations

- Average-speed-zone coverage depends on correctly tagged OpenStreetMap enforcement relations or the configured GeoJSON source. An empty result is shown honestly and never replaced with invented coverage.
- This browser version does not provide turn instructions, automatic rerouting, background tracking guarantees, offline maps, or official temporary road restrictions.
- Browser GPS quality, background execution, Speech Synthesis, and Vibration support vary by platform.
- The map matcher is intentionally compact and suited to route-adjacent corridors; production deployment should use a maintained, jurisdiction-specific zone feed and stronger route matching.
- Map tiles and all configured live services require a network connection.

## Future route handoff

Google Maps and Waze handoff can be added later as user-initiated deep links from the pre-drive route screen. It should use each provider’s documented URL scheme and must not imply that PaceLine can overlay controls on another navigation app. Continuous background navigation, CarPlay, and Android Auto require a future native application and official platform support.
