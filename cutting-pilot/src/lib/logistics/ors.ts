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

// Matrix (driving-car), one source -> one destination, distance in miles. Returns null on
// error / missing key (caller marks route_failed).
export async function drivingMiles(origin: GeoPoint, dest: GeoPoint, apiKey: string): Promise<number | null> {
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
        metrics: ["distance"],
        units: "mi",
      }),
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    const miles = body?.distances?.[0]?.[0];
    return typeof miles === "number" ? miles : null;
  } catch {
    return null;
  }
}

// Directions (driving-car) total distance in miles for an ordered path of >=2 points.
// Returns null on error / missing key (caller keeps the line resolved-but-unrouted).
export async function routePathMiles(points: GeoPoint[], apiKey: string): Promise<number | null> {
  if (!apiKey || points.length < 2) return null;
  try {
    const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: points.map((p) => [p.lng, p.lat]) }),
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    const meters = body?.routes?.[0]?.summary?.distance ?? body?.features?.[0]?.properties?.summary?.distance;
    return typeof meters === "number" ? meters * 0.000621371 : null;
  } catch {
    return null;
  }
}
