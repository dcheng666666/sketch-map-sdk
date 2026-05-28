import type { Location } from "./types.js";
import { findCityForPoint, type CityFeature } from "./cityLookup.js";
import { findProvinceByName, type ProvinceFeature } from "./provinceLookup.js";
import { findRiversForCities, type RiverFeature } from "./riverLookup.js";

export interface ResolvedGeo {
  cities: CityFeature[];
  provinces: ProvinceFeature[];
  rivers: RiverFeature[];
  /** Location names where point-in-polygon found no city. */
  unmatchedLocations: string[];
}

/**
 * Resolve China city, parent-province, and river outlines for route locations.
 * Shared by the web hook and the MCP server.
 */
export function resolveGeoOutlines(locations: Location[]): ResolvedGeo {
  if (locations.length === 0) {
    return { cities: [], provinces: [], rivers: [], unmatchedLocations: [] };
  }

  const cityResults = locations.map((l) => findCityForPoint(l.lat, l.lng));

  const unmatchedLocations = locations.filter((_, i) => !cityResults[i]).map((l) => l.name);

  const seenCity = new Set<number>();
  const cities: CityFeature[] = [];
  const provinceNames = new Set<string>();
  for (const r of cityResults) {
    if (!r) continue;
    if (!seenCity.has(r.properties.adcode)) {
      seenCity.add(r.properties.adcode);
      cities.push(r);
    }
    if (r.properties.province) provinceNames.add(r.properties.province);
  }

  const seenProvince = new Set<number>();
  const provinces: ProvinceFeature[] = [];
  for (const name of provinceNames) {
    const p = findProvinceByName(name);
    if (!p) continue;
    if (seenProvince.has(p.properties.adcode)) continue;
    seenProvince.add(p.properties.adcode);
    provinces.push(p);
  }

  const adcodes = cities.map((c) => c.properties.adcode);
  const rivers = findRiversForCities(adcodes);

  return { cities, provinces, rivers, unmatchedLocations };
}
