// src/lib/logistics/ors.ts
// OpenRouteService client. Reads the API key from a parameter (never from env at module
// top-level) — callers pull it from the Worker secret ORS_API_KEY via getCloudflareContext()
// in the route handler. ORS uses [lng, lat] coordinate order.

export interface GeoPoint {
  lat: number;
  lng: number;
  label?: string;
  confidence?: number;
}

// Pelias geocode. Returns null on no result / error / missing key (caller marks the line
// geocode_failed — feature degrades to "mileage unavailable", never a crash).
export async function geocode(address: string, apiKey: string): Promise<GeoPoint | null> {
  if (!apiKey) return null;
  try {
    const url = `https://api.openrouteservice.org/geocode/search?text=${encodeURIComponent(
      address
    )}&boundary.country=US&size=1`;
    const res = await fetch(url, { headers: { Authorization: apiKey } });
    if (!res.ok) return null;
    const body: any = await res.json();
    const feature = body?.features?.[0];
    if (!feature) return null;
    const [lng, lat] = feature.geometry.coordinates;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return {
      lat,
      lng,
      label: feature.properties?.label,
      confidence: feature.properties?.confidence,
    };
  } catch {
    return null;
  }
}

export interface DrivingResult {
  miles: number;
  durationSec: number;
}

// Matrix (driving-car), one source -> one destination, distance (mi) + duration (sec).
// `units` only scales the distances array -- durations are always returned in seconds,
// regardless of units. Duration is a free-flow car-profile ETA (no traffic) -- callers
// displaying it to freight/trailer users should label it as such, not as a truck ETA.
// Returns null on error / missing key (caller marks route_failed).
export async function drivingMilesAndDuration(
  origin: GeoPoint,
  dest: GeoPoint,
  apiKey: string
): Promise<DrivingResult | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.openrouteservice.org/v2/matrix/driving-car", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: [
          [origin.lng, origin.lat],
          [dest.lng, dest.lat],
        ],
        sources: [0],
        destinations: [1],
        metrics: ["distance", "duration"],
        units: "mi",
      }),
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    const miles = body?.distances?.[0]?.[0];
    const durationSec = body?.durations?.[0]?.[0];
    if (typeof miles !== "number" || typeof durationSec !== "number") return null;
    return { miles, durationSec };
  } catch {
    return null;
  }
}

// Distance-only convenience wrapper -- kept for the existing callers (routePathMiles,
// both invoice routes) that only ever consumed the miles value. Behavior-preserving:
// requesting the extra "duration" metric doesn't change the distances array ORS returns.
export async function drivingMiles(origin: GeoPoint, dest: GeoPoint, apiKey: string): Promise<number | null> {
  const r = await drivingMilesAndDuration(origin, dest, apiKey);
  return r?.miles ?? null;
}

// Total distance in miles for an ordered path of >=2 points, computed by summing sequential
// matrix legs (origin -> stop 1 -> stop 2 -> ...) instead of calling the Directions endpoint,
// which returns nothing for this account (0 PATH: cache rows ever written — verified against
// prod). The matrix endpoint is the proven call (drivingMiles already resolves single-destination
// lines). Returns null on error / missing key (caller keeps the line resolved-but-unrouted).
export async function routePathMiles(points: GeoPoint[], apiKey: string): Promise<number | null> {
  if (!apiKey || points.length < 2) return null;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const leg = await drivingMiles(points[i], points[i + 1], apiKey);
    if (leg == null) return null; // any leg unavailable -> whole path unavailable; caller degrades gracefully
    total += leg;
  }
  return total > 0 ? total : null;
}
