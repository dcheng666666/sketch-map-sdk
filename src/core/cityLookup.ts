import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import bbox from "@turf/bbox";
import { point } from "@turf/helpers";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import citiesFc from "./data/china-cities.json" with { type: "json" };

export interface CityProps {
  adcode: number;
  name: string;
  center?: [number, number];
  centroid?: [number, number];
  level: "city";
  province: string;
}

export type CityFeature = Feature<Polygon | MultiPolygon, CityProps>;

interface IndexedCity {
  feature: CityFeature;
  bbox: [number, number, number, number];
}

type CitiesCollection = FeatureCollection<Polygon | MultiPolygon, CityProps>;

const indexedCities: IndexedCity[] = (
  citiesFc as unknown as CitiesCollection
).features.map((feature) => ({
  feature: feature as CityFeature,
  bbox: bbox(feature) as [number, number, number, number],
}));

export function findCityForPoint(
  lat: number,
  lng: number,
): CityFeature | null {
  const pt = point([lng, lat]);
  for (const c of indexedCities) {
    const [minLng, minLat, maxLng, maxLat] = c.bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    if (booleanPointInPolygon(pt, c.feature)) return c.feature;
  }
  return null;
}
