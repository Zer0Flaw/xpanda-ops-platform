// src/lib/logistics/origin.ts
export const FACILITY_ORIGIN_ADDRESS = "1090 Gills Dr, Orlando, FL 32824";
// Mileage is one-way driving distance from this origin. If this string changes, the
// geocode_cache.miles_from_origin values are stale — clear the geocode_cache table.
export const ORIGIN_CACHE_KEY = "__origin__";
