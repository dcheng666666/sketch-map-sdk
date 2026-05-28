import type { Feature, FeatureCollection, LineString, MultiLineString } from "geojson";
import riversFc from "./data/china-rivers.json" with { type: "json" };

export interface RiverProps {
  name: string;
  name_en: string;
  /** 1 = main stem / 2 = tributary. Drives stroke width and label priority. */
  rank: 1 | 2;
  /** Provinces this river touches, populated by scripts/build-rivers.mjs. */
  provinces: string[];
  /** Prefecture-level city adcodes the river actually flows through. */
  cities: number[];
}

export type RiverFeature = Feature<LineString | MultiLineString, RiverProps>;

type RiversCollection = FeatureCollection<LineString | MultiLineString, RiverProps>;

const allRivers: RiverFeature[] = (riversFc as unknown as RiversCollection).features;

/**
 * Return every river that actually flows through any of the supplied
 * prefecture-level cities (matched by GB/T 2260 adcode). Filtering at city
 * granularity — instead of province — keeps the map focused: picking 西安
 * shows 渭河 but suppresses 嘉陵江, since 嘉陵江 happens to share the same
 * province but does not pass through the same city.
 */
export function findRiversForCities(cityAdcodes: Iterable<number>): RiverFeature[] {
  const wanted = new Set(cityAdcodes);
  if (wanted.size === 0) return [];
  return allRivers.filter((r) => r.properties.cities.some((c) => wanted.has(c)));
}
