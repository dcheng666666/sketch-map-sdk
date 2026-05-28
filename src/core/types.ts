export interface Location {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lng: number;
}

export interface NominatimItem {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type: string;
}

/** Fixed minimum sketchiness for rough.js strokes. */
export const MIN_ROUGHNESS = 0.5;

export type BBox = [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
