import type { BBox, Location } from "./types.js";

export interface Point2D {
  x: number;
  y: number;
}

export interface ProjectionContext {
  project: (lat: number, lng: number) => Point2D;
  width: number;
  height: number;
  bbox: BBox;
}

function mercatorY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

export function computeBBox(locations: Location[], bufferRatio = 0.2): BBox | null {
  if (locations.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const loc of locations) {
    minLat = Math.min(minLat, loc.lat);
    maxLat = Math.max(maxLat, loc.lat);
    minLng = Math.min(minLng, loc.lng);
    maxLng = Math.max(maxLng, loc.lng);
  }

  if (locations.length === 1) {
    const pad = 2;
    return [minLng - pad, minLat - pad, maxLng + pad, maxLat + pad];
  }

  const latSpan = maxLat - minLat || 0.5;
  const lngSpan = maxLng - minLng || 0.5;
  const latBuf = latSpan * bufferRatio;
  const lngBuf = lngSpan * bufferRatio;

  return [minLng - lngBuf, minLat - latBuf, maxLng + lngBuf, maxLat + latBuf];
}

export function unionBBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function createProjection(
  bbox: BBox,
  width: number,
  height: number,
  padding = 48,
): ProjectionContext {
  const [minLng, minLat, maxLng, maxLat] = bbox;

  const x0 = mercatorX(minLng);
  const x1 = mercatorX(maxLng);
  const y0 = mercatorY(maxLat);
  const y1 = mercatorY(minLat);

  const mw = Math.max(x1 - x0, 1e-6);
  const mh = Math.max(y1 - y0, 1e-6);

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  // Use a single uniform scale so the Mercator aspect ratio is preserved.
  // Without this, bboxes that are wider/taller than the canvas (e.g. two
  // cities far apart east-west) would stretch city outlines into squashed
  // shapes. We then center the content inside the inner rect.
  const scale = Math.min(innerW / mw, innerH / mh);
  const offsetX = padding + (innerW - mw * scale) / 2;
  const offsetY = padding + (innerH - mh * scale) / 2;

  const project = (lat: number, lng: number): Point2D => {
    const mx = mercatorX(lng) - x0;
    const my = mercatorY(lat) - y0;
    return {
      x: offsetX + mx * scale,
      y: offsetY + my * scale,
    };
  };

  return { project, width, height, bbox };
}
