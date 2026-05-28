import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import provincesFc from "./data/china-provinces.json" with { type: "json" };

export interface ProvinceProps {
  adcode: number;
  name: string;
  center?: [number, number];
  centroid?: [number, number];
  level: "province";
}

export type ProvinceFeature = Feature<Polygon | MultiPolygon, ProvinceProps>;

type ProvincesCollection = FeatureCollection<Polygon | MultiPolygon, ProvinceProps>;

const byName = new Map<string, ProvinceFeature>();
for (const f of (provincesFc as unknown as ProvincesCollection).features) {
  byName.set(f.properties.name, f);
}

export function findProvinceByName(name: string): ProvinceFeature | null {
  return byName.get(name) ?? null;
}
