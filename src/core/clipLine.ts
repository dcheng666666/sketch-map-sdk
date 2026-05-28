import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import bbox from "@turf/bbox";
import { point } from "@turf/helpers";
import type { Feature, MultiPolygon, Polygon } from "geojson";

type PolygonFeature = Feature<Polygon | MultiPolygon>;

interface IndexedPoly {
  feature: PolygonFeature;
  bbox: [number, number, number, number];
}

/**
 * Bbox-first wrapper around `booleanPointInPolygon`. Point-in-polygon is
 * O(vertices); the bbox short-circuit drops it to near O(1) for the common
 * case where most provinces don't contain the test point.
 */
function pointInsideAny(lng: number, lat: number, polys: IndexedPoly[]): boolean {
  for (const { feature, bbox: b } of polys) {
    if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    if (booleanPointInPolygon(point([lng, lat]), feature)) return true;
  }
  return false;
}

/**
 * Find the on-segment point where the inside/outside flag flips, via 14
 * iterations of midpoint bisection. Returns coordinates accurate to roughly
 * 2^-14 of the segment length — well below the rendered sub-pixel scale at
 * any reasonable zoom.
 */
function bisectBoundary(
  a: [number, number],
  b: [number, number],
  aInside: boolean,
  polys: IndexedPoly[],
): [number, number] {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const px = a[0] + (b[0] - a[0]) * mid;
    const py = a[1] + (b[1] - a[1]) * mid;
    if (pointInsideAny(px, py, polys) === aInside) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const t = (lo + hi) / 2;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Clip a polyline (in [lng, lat] coords) against a set of polygons, treating
 * the polygons as a union mask. Returns each contiguous "inside" sub-line as
 * its own array; boundary crossings are resolved via bisection so the start
 * and end of each sub-line snap to the polygon edge rather than the nearest
 * input vertex.
 */
export function clipLineToPolygons(
  coords: [number, number][],
  polys: IndexedPoly[],
): [number, number][][] {
  if (coords.length < 2 || polys.length === 0) return [];

  const out: [number, number][][] = [];
  let current: [number, number][] = [];

  let prevInside = pointInsideAny(coords[0][0], coords[0][1], polys);
  if (prevInside) current.push(coords[0]);

  for (let i = 1; i < coords.length; i++) {
    const here = coords[i];
    const inside = pointInsideAny(here[0], here[1], polys);

    if (inside && prevInside) {
      current.push(here);
    } else if (inside && !prevInside) {
      // Entering: bisect the previous segment to find the boundary.
      const cross = bisectBoundary(coords[i - 1], here, false, polys);
      current = [cross, here];
    } else if (!inside && prevInside) {
      // Leaving: bisect to find the exit point, finalize current run.
      const cross = bisectBoundary(coords[i - 1], here, true, polys);
      current.push(cross);
      if (current.length >= 2) out.push(current);
      current = [];
    }
    // both outside: nothing to do.

    prevInside = inside;
  }

  if (current.length >= 2) out.push(current);
  return out;
}

/**
 * Wrap an array of polygon features with their cached bboxes so clipping
 * calls don't recompute them per-vertex. The caller passes the same list to
 * every `clipLineToPolygons` invocation in a render cycle.
 */
export function indexPolygons(features: PolygonFeature[]): IndexedPoly[] {
  return features.map((feature) => ({
    feature,
    bbox: bbox(feature) as [number, number, number, number],
  }));
}
