import rough from "roughjs";
import type { RoughSVG } from "roughjs/bin/svg";
import bbox from "@turf/bbox";
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";
import { MIN_ROUGHNESS, type BBox, type Location } from "./types.js";
import type { CityFeature } from "./cityLookup.js";
import type { ProvinceFeature } from "./provinceLookup.js";
import type { RiverFeature } from "./riverLookup.js";
import {
  computeBBox,
  createProjection,
  unionBBox,
  type Point2D,
  type ProjectionContext,
} from "./projection.js";
import { clipLineToPolygons, indexPolygons } from "./clipLine.js";
import { THEME, type ThemeColors } from "./themes.js";

export const DEFAULT_MAP_WIDTH = 800;
export const DEFAULT_MAP_HEIGHT = 600;
export const PNG_SCALE = 2;

type AreaProps = { center?: [number, number]; centroid?: [number, number] };
type AreaFeature = Feature<Polygon | MultiPolygon, AreaProps>;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Active canvas size — set at the start of each render pass. */
let canvasW = DEFAULT_MAP_WIDTH;
let canvasH = DEFAULT_MAP_HEIGHT;

/** Handwritten font stack — keep CJK fallback so Chinese place names also
 *  render in a hand-drawn style instead of falling back to a sans-serif. */
const FONT_HAND = "'Caveat', 'ZCOOL KuaiLe', cursive";

/** Suppress rough.js double-stroke halo under ink lines. */
const NO_STROKE_SHADOW = { disableMultiStroke: true };
const NO_FILL_SHADOW = { disableMultiStrokeFill: true };

export interface RenderSketchMapArgs {
  locations: Location[];
  cities: CityFeature[];
  provinces: ProvinceFeature[];
  rivers: RiverFeature[];
  title: string;
  width?: number;
  height?: number;
  filterId?: string;
}

/** Bbox-collision record used by river labels to avoid stacking names. */
interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function tryReserveLabel(queue: LabelBox[], box: LabelBox): boolean {
  for (const r of queue) {
    if (box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y) {
      return false;
    }
  }
  queue.push(box);
  return true;
}

interface PolygonStyle {
  fill: string;
  stroke: string;
  /** Outline thickness in px before rough.js perturbation. */
  strokeWidth: number;
  /** Opacity applied to the watercolor fill layer. Defaults to 1. */
  fillOpacity?: number;
  /** Optional dash pattern for the outline. */
  strokeDasharray?: string;
}

function appendText(
  svg: SVGSVGElement,
  x: number,
  y: number,
  text: string,
  fill: string,
  size = 14,
  options: {
    halo?: boolean;
    haloColor?: string;
    anchor?: "start" | "middle" | "end";
    weight?: number | string;
    family?: string;
    rotate?: number;
    opacity?: number;
  } = {},
): SVGTextElement {
  const el = document.createElementNS(SVG_NS, "text");
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("fill", fill);
  el.setAttribute("font-size", String(size));
  el.setAttribute("font-family", options.family ?? FONT_HAND);
  if (options.weight) el.setAttribute("font-weight", String(options.weight));
  if (options.anchor) el.setAttribute("text-anchor", options.anchor);
  if (options.halo !== false) {
    el.setAttribute("stroke", options.haloColor ?? "rgba(255,255,255,0.85)");
    el.setAttribute("stroke-width", "2");
    el.setAttribute("paint-order", "stroke");
    el.setAttribute("stroke-linejoin", "round");
  }
  if (options.rotate) {
    el.setAttribute("transform", `rotate(${options.rotate} ${x} ${y})`);
  }
  if (options.opacity !== undefined && options.opacity < 1) {
    el.setAttribute("opacity", String(options.opacity));
  }
  el.textContent = text;
  svg.appendChild(el);
  return el;
}

function fallbackTextWidth(text: string, size: number): number {
  return Array.from(text).reduce((width, char) => {
    const code = char.codePointAt(0) ?? 0;
    const isWide =
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef);
    return width + (isWide ? size : size * 0.56);
  }, 0);
}

function measureTextWidth(el: SVGTextElement, text: string, size: number): number {
  try {
    const measured = el.getComputedTextLength?.();
    if (measured && Number.isFinite(measured)) return measured;
  } catch {
    // Some non-browser SVG implementations do not expose text metrics.
  }

  try {
    const bbox = el.getBBox?.();
    if (bbox?.width && Number.isFinite(bbox.width)) return bbox.width;
  } catch {
    // Fallback below keeps server-side rasterization deterministic.
  }

  return fallbackTextWidth(text, size);
}

function drawArrowHead(
  rc: RoughSVG,
  svg: SVGSVGElement,
  from: Point2D,
  to: Point2D,
  color: string,
  size = 12,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return;
  const ux = dx / len;
  const uy = dy / len;

  const tip = to;
  const back = size;
  const half = size * 0.55;
  const baseL = {
    x: tip.x - ux * back - uy * half,
    y: tip.y - uy * back + ux * half,
  };
  const baseR = {
    x: tip.x - ux * back + uy * half,
    y: tip.y - uy * back - ux * half,
  };

  svg.appendChild(
    rc.polygon(
      [
        [tip.x, tip.y],
        [baseL.x, baseL.y],
        [baseR.x, baseR.y],
      ],
      {
        fill: color,
        fillStyle: "solid",
        stroke: color,
        strokeWidth: 1,
        roughness: 1,
        ...NO_STROKE_SHADOW,
        ...NO_FILL_SHADOW,
      },
    ),
  );
}

function pathLengthApi(path: SVGPathElement): boolean {
  return typeof path.getTotalLength === "function";
}

interface PathGeometry {
  total: number;
  pointAt(length: number): Point2D | null;
}

function isPathCommand(token: string): boolean {
  return /^[a-zA-Z]$/.test(token);
}

function pathTokens(d: string): string[] {
  return d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
}

function cubicPoint(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

function quadraticPoint(p0: Point2D, p1: Point2D, p2: Point2D, t: number): Point2D {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

function flattenPathData(d: string): Point2D[] {
  const tokens = pathTokens(d);
  const points: Point2D[] = [];
  let i = 0;
  let command = "";
  let current: Point2D = { x: 0, y: 0 };
  let subpathStart: Point2D = current;

  const readNumber = (): number | null => {
    const token = tokens[i];
    if (token === undefined || isPathCommand(token)) return null;
    i += 1;
    return Number(token);
  };

  const readPoint = (relative: boolean): Point2D | null => {
    const x = readNumber();
    const y = readNumber();
    if (x === null || y === null) return null;
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };

  while (i < tokens.length) {
    if (isPathCommand(tokens[i])) {
      command = tokens[i];
      i += 1;
    }
    if (!command) break;

    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M": {
        const p = readPoint(relative);
        if (!p) return points;
        current = p;
        subpathStart = p;
        points.push(p);
        command = relative ? "l" : "L";
        break;
      }
      case "L": {
        const p = readPoint(relative);
        if (!p) return points;
        current = p;
        points.push(p);
        break;
      }
      case "H": {
        const x = readNumber();
        if (x === null) return points;
        current = { x: relative ? current.x + x : x, y: current.y };
        points.push(current);
        break;
      }
      case "V": {
        const y = readNumber();
        if (y === null) return points;
        current = { x: current.x, y: relative ? current.y + y : y };
        points.push(current);
        break;
      }
      case "C": {
        const c1 = readPoint(relative);
        const c2 = readPoint(relative);
        const end = readPoint(relative);
        if (!c1 || !c2 || !end) return points;
        const start = current;
        for (let step = 1; step <= 24; step++) {
          points.push(cubicPoint(start, c1, c2, end, step / 24));
        }
        current = end;
        break;
      }
      case "Q": {
        const c = readPoint(relative);
        const end = readPoint(relative);
        if (!c || !end) return points;
        const start = current;
        for (let step = 1; step <= 20; step++) {
          points.push(quadraticPoint(start, c, end, step / 20));
        }
        current = end;
        break;
      }
      case "Z": {
        current = subpathStart;
        points.push(current);
        break;
      }
      default:
        return points;
    }
  }

  return points;
}

function sampledPathGeometry(path: SVGPathElement): PathGeometry | null {
  const d = path.getAttribute("d");
  if (!d) return null;
  const points = flattenPathData(d);
  if (points.length < 2) return null;

  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    cumulative.push(cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cumulative[cumulative.length - 1];
  if (!isFinite(total) || total <= 0) return null;

  return {
    total,
    pointAt(length: number): Point2D | null {
      const target = Math.max(0, Math.min(total, length));
      for (let i = 1; i < cumulative.length; i++) {
        if (cumulative[i] < target) continue;
        const prev = cumulative[i - 1];
        const segLen = cumulative[i] - prev;
        const t = segLen > 0 ? (target - prev) / segLen : 0;
        const a = points[i - 1];
        const b = points[i];
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        };
      }
      return points[points.length - 1];
    },
  };
}

function pathGeometry(path: SVGPathElement): PathGeometry | null {
  if (!pathLengthApi(path)) return sampledPathGeometry(path);
  const total = path.getTotalLength();
  if (!isFinite(total) || total <= 0) return null;
  return {
    total,
    pointAt(length: number): Point2D | null {
      const p = path.getPointAtLength(Math.max(0, Math.min(total, length)));
      return { x: p.x, y: p.y };
    },
  };
}

/** Segment-midpoint arrows when SVG path geometry API is unavailable (e.g. jsdom). */
function drawArrowsOnSegments(
  rc: RoughSVG,
  svg: SVGSVGElement,
  points: Point2D[],
  color: string,
  options: { arrowSize?: number; backLen?: number; minSegment?: number; midT?: number } = {},
) {
  const { arrowSize = 12, backLen = 14, minSegment = 25, midT = 0.55 } = options;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < minSegment) continue;
    const tip = { x: a.x + dx * midT, y: a.y + dy * midT };
    const tail = { x: tip.x - (dx / len) * backLen, y: tip.y - (dy / len) * backLen };
    drawArrowHead(rc, svg, tail, tip, color, arrowSize);
  }
}

/**
 * Place direction arrows on the actual rendered curve geometry.
 *
 * The route is drawn by rough.js as a spline (not a polyline) so picking
 * the midpoint of each straight segment leaves the arrow floating off the
 * ink line. Instead we read the rendered <path> via the SVG geometry API
 * and sample the point + tangent at the position along the curve that
 * corresponds to each conceptual segment, so the arrow always sits on the
 * stroke and points along the curve's local direction.
 */
function drawArrowsOnCurve(
  rc: RoughSVG,
  svg: SVGSVGElement,
  curveGroup: SVGElement,
  points: Point2D[],
  color: string,
  options: {
    arrowSize?: number;
    backLen?: number;
    minSegment?: number;
    midT?: number;
  } = {},
) {
  if (points.length < 2) return;
  const { arrowSize = 12, backLen = 14, minSegment = 25, midT = 0.55 } = options;

  const path = curveGroup.querySelector("path");
  if (!path) return;
  const geometry = pathGeometry(path);
  if (!geometry) {
    drawArrowsOnSegments(rc, svg, points, color, options);
    return;
  }

  // Use cumulative straight-line distances as a proxy for cumulative arc
  // length on the curve. The mapping is approximate but tracks the real
  // curve closely enough for placing direction markers, and avoids an
  // expensive nearest-point search per arrow.
  const cum: number[] = [0];
  for (let i = 0; i < points.length - 1; i++) {
    cum.push(cum[i] + Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y));
  }
  const totalStraight = cum[cum.length - 1];
  if (totalStraight <= 0) return;

  for (let i = 0; i < points.length - 1; i++) {
    const segLen = cum[i + 1] - cum[i];
    if (segLen < minSegment) continue;

    const frac = (cum[i] + segLen * midT) / totalStraight;
    const lenAt = Math.max(0, Math.min(geometry.total, frac * geometry.total));
    const tip = geometry.pointAt(lenAt);
    const ahead = geometry.pointAt(Math.min(geometry.total, lenAt + 1.5));
    const behind = geometry.pointAt(Math.max(0, lenAt - 1.5));
    if (!tip || !ahead || !behind) continue;

    let tx = ahead.x - behind.x;
    let ty = ahead.y - behind.y;
    const tlen = Math.hypot(tx, ty);
    if (tlen < 1e-3) continue;
    tx /= tlen;
    ty /= tlen;

    const tail = { x: tip.x - tx * backLen, y: tip.y - ty * backLen };
    drawArrowHead(rc, svg, tail, { x: tip.x, y: tip.y }, color, arrowSize);
  }
}

function drawCompass(rc: RoughSVG, svg: SVGSVGElement, colors: ThemeColors) {
  const cx = canvasW - 54;
  const cy = 56;
  const r = 18; // half of the circle diameter below

  svg.appendChild(
    rc.circle(cx, cy, r * 2, {
      stroke: colors.border,
      strokeWidth: 1.5,
      roughness: 1.5,
      ...NO_STROKE_SHADOW,
    }),
  );

  // North-pointing needle, centered on the compass.
  svg.appendChild(
    rc.line(cx, cy + r * 0.4, cx, cy - r * 0.7, {
      stroke: colors.route,
      strokeWidth: 2,
      roughness: 1,
      ...NO_STROKE_SHADOW,
    }),
  );
  svg.appendChild(
    rc.polygon(
      [
        [cx, cy - r * 0.95],
        [cx - 4, cy - r * 0.55],
        [cx + 4, cy - r * 0.55],
      ],
      {
        fill: colors.route,
        fillStyle: "solid",
        stroke: colors.route,
        strokeWidth: 1,
        roughness: 0.8,
        ...NO_STROKE_SHADOW,
      },
    ),
  );

  // "N" label centered horizontally above the compass circle.
  appendText(svg, cx, cy - r - 6, "N", colors.text, 13, {
    anchor: "middle",
    weight: 700,
    halo: true,
    haloColor: colors.paper,
  });
}

function projectRing(ring: number[][], project: ProjectionContext["project"]): [number, number][] {
  return ring.map(([lng, lat]) => {
    const p = project(lat, lng);
    return [p.x, p.y];
  });
}

/**
 * Draw a polygon feature (province or city) with a watercolor wash fill plus
 * a hand-drawn ink outline.
 */
function drawPolygonFeature(
  rc: RoughSVG,
  svg: SVGSVGElement,
  feature: Feature<Polygon | MultiPolygon>,
  proj: ProjectionContext,
  roughness: number,
  style: PolygonStyle,
) {
  const geom = feature.geometry;
  const polygons: number[][][][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;

  for (const poly of polygons) {
    const outer = poly[0];
    if (!outer || outer.length < 3) continue;
    const pts = projectRing(outer, proj.project);

    const fillEl = rc.polygon(pts, {
      fill: style.fill,
      fillStyle: "solid",
      fillWeight: 1,
      stroke: "none",
      roughness: roughness * 0.8,
      ...NO_FILL_SHADOW,
    });
    if (style.fillOpacity !== undefined && style.fillOpacity < 1) {
      fillEl.setAttribute("opacity", String(style.fillOpacity));
    }
    svg.appendChild(fillEl);

    const strokeEl = rc.polygon(pts, {
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      roughness: roughness * 1.1,
      bowing: 1.5,
      ...NO_STROKE_SHADOW,
    });
    if (style.strokeDasharray) {
      // rough.js renders strokes onto a nested <path>; pushing the dash
      // attribute through the group is enough for SVG inheritance.
      strokeEl.setAttribute("stroke-dasharray", style.strokeDasharray);
    }
    svg.appendChild(strokeEl);
  }
}

function featureLabelPoint(feature: AreaFeature, proj: ProjectionContext): Point2D | null {
  const c = feature.properties.centroid ?? feature.properties.center;
  if (!c) return null;
  return proj.project(c[1], c[0]);
}

/**
 * Project a river feature into screen-space polylines, optionally clipped to
 * the union of `provinceMask` polygons so the rendered ink never spills
 * outside the user's selected provinces. MultiLineString geometries collapse
 * to one polyline per inner sub-segment.
 */
function projectRiverSegments(
  feature: Feature<LineString | MultiLineString>,
  proj: ProjectionContext,
  provinceMask: ReturnType<typeof indexPolygons> | null,
): Point2D[][] {
  const rawSegs: number[][][] =
    feature.geometry.type === "LineString"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;

  const out: Point2D[][] = [];
  for (const seg of rawSegs) {
    if (!seg || seg.length < 2) continue;

    // When a province mask is provided, clip the lng/lat polyline first and
    // project the resulting sub-segments. Without a mask we project the raw
    // segment so off-province behavior is unchanged.
    const subSegs = provinceMask
      ? clipLineToPolygons(seg as [number, number][], provinceMask)
      : [seg as [number, number][]];

    for (const sub of subSegs) {
      if (sub.length < 2) continue;
      out.push(sub.map(([lng, lat]: [number, number]) => proj.project(lat, lng)));
    }
  }
  return out;
}

/** Total screen-space length of a polyline — used to pick the most prominent
 *  segment of a river for label placement. */
function polylineLength(pts: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    total += Math.hypot(dx, dy);
  }
  return total;
}

/** Find the on-polyline point at `frac` (0..1) of total length, along with
 *  the local tangent angle in radians — used to orient river name labels. */
function pointAlong(pts: Point2D[], frac: number): { point: Point2D; angle: number } | null {
  if (pts.length < 2) return null;
  const total = polylineLength(pts);
  if (total < 1e-3) return null;
  const target = total * Math.max(0, Math.min(1, frac));
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const seg = Math.hypot(dx, dy);
    if (acc + seg >= target) {
      const t = (target - acc) / seg;
      return {
        point: { x: a.x + dx * t, y: a.y + dy * t },
        angle: Math.atan2(dy, dx),
      };
    }
    acc += seg;
  }
  return { point: pts[pts.length - 1], angle: 0 };
}

/**
 * Render every river inside the projection's view as a soft watercolor wash
 * plus a darker ink line.
 */
function drawRivers(
  rc: RoughSVG,
  svg: SVGSVGElement,
  rivers: RiverFeature[],
  proj: ProjectionContext,
  colors: ThemeColors,
  roughness: number,
  provinceMask: ReturnType<typeof indexPolygons> | null,
  labelQueue: LabelBox[],
) {
  if (rivers.length === 0) return;

  const canvasDiag = Math.hypot(proj.width, proj.height);
  // Drop rivers whose projected length is too short to look like a river —
  // they would just be a noisy speck near the edge of the view.
  const MIN_LEN_PX = 18;

  // Group: rank 1 first (drawn under), then rank 2 on top so tributaries are
  // not buried by main-stem strokes that share start/end points.
  const ordered = [...rivers].sort((a, b) => a.properties.rank - b.properties.rank);

  for (const river of ordered) {
    const segs = projectRiverSegments(river, proj, provinceMask);
    if (segs.length === 0) continue;

    const isMain = river.properties.rank === 1;
    const baseWidth = isMain ? 3.6 : 1.8;
    const inkWidth = isMain ? 1.4 : 0.9;
    const inkColor = colors.river;
    const wash = colors.watercolor.routeWash;

    // Choose the longest projected segment to host the label so the name
    // sits on the most visible portion of the river.
    let longest: Point2D[] | null = null;
    let longestLen = 0;
    for (const seg of segs) {
      const len = polylineLength(seg);
      if (len > longestLen) {
        longestLen = len;
        longest = seg;
      }
    }
    if (!longest || longestLen < MIN_LEN_PX) continue;

    for (const seg of segs) {
      if (polylineLength(seg) < 4) continue;
      const curve: [number, number][] = seg.map((p) => [p.x, p.y]);

      // Soft wider wash under the ink line — gives the impression of
      // water bleed without slowing the renderer down with a filter.
      const washEl = rc.curve(curve, {
        stroke: wash,
        strokeWidth: baseWidth,
        roughness: roughness * 0.6,
        bowing: 2.5,
        ...NO_STROKE_SHADOW,
      });
      washEl.setAttribute("opacity", "0.55");
      washEl.setAttribute("stroke-linecap", "round");
      svg.appendChild(washEl);

      const inkEl = rc.curve(curve, {
        stroke: inkColor,
        strokeWidth: inkWidth,
        roughness: roughness * 1.1,
        bowing: 2,
        ...NO_STROKE_SHADOW,
      });
      inkEl.setAttribute("opacity", "0.85");
      inkEl.setAttribute("stroke-linecap", "round");
      svg.appendChild(inkEl);
    }

    // Label placement: find a smooth mid-segment point and follow the local
    // tangent. Flip the rotation when the river runs right-to-left so text
    // stays upright instead of reading upside-down.
    const labelInfo = pointAlong(longest, 0.55);
    if (!labelInfo) continue;
    // Don't bother labelling micro-rivers whose name would be larger than
    // the river itself on screen.
    if (longestLen < canvasDiag * 0.05) continue;

    let angleDeg = (labelInfo.angle * 180) / Math.PI;
    if (angleDeg > 90) angleDeg -= 180;
    if (angleDeg < -90) angleDeg += 180;
    const size = isMain ? 14 : 12;
    const name = river.properties.name;
    const approxW = name.length * size * 1.05;
    const approxH = size * 1.3;
    // Approximate bbox in the unrotated label frame for the collision check.
    if (
      !tryReserveLabel(labelQueue, {
        x: labelInfo.point.x - approxW / 2,
        y: labelInfo.point.y - approxH / 2,
        w: approxW,
        h: approxH,
      })
    ) {
      continue;
    }

    appendText(svg, labelInfo.point.x, labelInfo.point.y - (isMain ? 6 : 4), name, inkColor, size, {
      anchor: "middle",
      halo: true,
      haloColor: colors.paper,
      family: FONT_HAND,
      weight: isMain ? 700 : 600,
      rotate: angleDeg,
      opacity: isMain ? 0.95 : 0.8,
    });
  }
}

function appendWatercolorDefs(svg: SVGSVGElement, colors: ThemeColors, filterId: string) {
  const wc = colors.watercolor;
  const defs = document.createElementNS(SVG_NS, "defs");
  defs.innerHTML = `
    <filter id="${filterId}-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" />
      <feColorMatrix type="matrix" values="
        0 0 0 0 0
        0 0 0 0 0
        0 0 0 0 0
        0 0 0 0.18 0" />
      <feComposite in2="SourceGraphic" operator="in" />
    </filter>

    <filter id="${filterId}-wet" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="1.4" result="blur" />
      <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="3" result="turb" />
      <feDisplacementMap in="blur" in2="turb" scale="2" />
    </filter>

    <filter id="${filterId}-edge" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="11" result="turb" />
      <feDisplacementMap in="SourceGraphic" in2="turb" scale="1.5" />
    </filter>

    <radialGradient id="${filterId}-marker-wash" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${wc.markerWash}" stop-opacity="0.5" />
      <stop offset="55%" stop-color="${wc.markerWash}" stop-opacity="0.25" />
      <stop offset="100%" stop-color="${wc.markerWash}" stop-opacity="0" />
    </radialGradient>

    <radialGradient id="${filterId}-route-wash" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${wc.routeWash}" stop-opacity="0.7" />
      <stop offset="100%" stop-color="${wc.routeWash}" stop-opacity="0.15" />
    </radialGradient>
  `;
  svg.appendChild(defs);
}

function paintWatercolorPaper(svg: SVGSVGElement, colors: ThemeColors, filterId: string) {
  const wc = colors.watercolor;

  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", String(canvasW));
  bg.setAttribute("height", String(canvasH));
  bg.setAttribute("fill", colors.paper);
  svg.appendChild(bg);

  const grain = document.createElementNS(SVG_NS, "rect");
  grain.setAttribute("x", "0");
  grain.setAttribute("y", "0");
  grain.setAttribute("width", String(canvasW));
  grain.setAttribute("height", String(canvasH));
  grain.setAttribute("fill", wc.paperGrain);
  grain.setAttribute("filter", `url(#${filterId}-grain)`);
  grain.setAttribute("opacity", "0.55");
  svg.appendChild(grain);

  // Inner dashed frame — soft journal border.
  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("x", "14");
  frame.setAttribute("y", "14");
  frame.setAttribute("width", String(canvasW - 28));
  frame.setAttribute("height", String(canvasH - 28));
  frame.setAttribute("fill", "none");
  frame.setAttribute("stroke", wc.inkSoft);
  frame.setAttribute("stroke-width", "0.8");
  frame.setAttribute("stroke-dasharray", "4 6");
  frame.setAttribute("opacity", "0.35");
  svg.appendChild(frame);
}

/** Stable key for an unordered pair of strings (coords, ids, etc.). */
function unorderedPairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/**
 * Collapse stops that share the same screen position (round-trip revisits).
 * Uses the same collision radius as route markers so pairing matches what
 * the user sees. Search re-adds the same city with a new id each time.
 */
function buildStopClusterKeys(points: Point2D[], collisionPx: number): string[] {
  const keys: string[] = [];
  const clusters: { key: string; point: Point2D }[] = [];

  for (const p of points) {
    const hit = clusters.find((c) => Math.hypot(c.point.x - p.x, c.point.y - p.y) < collisionPx);
    if (hit) {
      keys.push(hit.key);
    } else {
      const key = `stop-${clusters.length}`;
      clusters.push({ key, point: p });
      keys.push(key);
    }
  }
  return keys;
}

type BidirectionalArcSide = "upper" | "lower";

/**
 * Find legs that revisit the same two cities in opposite directions (e.g.
 * outbound A→B and return B→A). The first leg is drawn below the chord and
 * the return leg above it so arrows do not land on the same visual path.
 */
function detectBidirectionalSegmentOffsets(
  points: Point2D[],
  collisionPx: number,
): Map<number, BidirectionalArcSide> {
  const stopKeys = buildStopClusterKeys(points, collisionPx);
  const firstLeg = new Map<string, { segIndex: number; sign: 1 | -1 }>();
  const offsets = new Map<number, BidirectionalArcSide>();

  for (let i = 0; i < points.length - 1; i++) {
    const fromKey = stopKeys[i];
    const toKey = stopKeys[i + 1];
    if (fromKey === toKey) continue;

    const key = unorderedPairKey(fromKey, toKey);
    const sign: 1 | -1 = fromKey < toKey ? 1 : -1;
    const prev = firstLeg.get(key);

    if (prev) {
      if (prev.sign !== sign) {
        offsets.set(prev.segIndex, "lower");
        offsets.set(i, "upper");
      }
    } else {
      firstLeg.set(key, { segIndex: i, sign });
    }
  }

  return offsets;
}

/** Lateral offset for a bidirectional leg — scaled by length, with a visible floor. */
function bidirectionalArcOffset(len: number): number {
  return Math.max(55, Math.min(len * 0.48, 160));
}

function verticalArcSide(p0: Point2D, p1: Point2D, arcSide: BidirectionalArcSide): 1 | -1 {
  const dx = p1.x - p0.x;
  if (Math.abs(dx) < 1e-3) return arcSide === "upper" ? -1 : 1;

  const wantsUpper = arcSide === "upper";
  return dx > 0 === wantsUpper ? -1 : 1;
}

/** Quadratic control point above or below the straight chord on screen. */
function arcControlPoint(p0: Point2D, p1: Point2D, arcSide: BidirectionalArcSide): Point2D {
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const side = verticalArcSide(p0, p1, arcSide);
  const nx = (-dy / len) * side;
  const ny = (dx / len) * side;
  const offset = bidirectionalArcOffset(len);
  return { x: mx + nx * offset, y: my + ny * offset };
}

/** Shorten a leg slightly so two arcs do not fully overlap at shared stops. */
function trimSegmentEndpoints(p0: Point2D, p1: Point2D, trimPx = 10): [Point2D, Point2D] {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const trim = Math.min(trimPx, len * 0.12);
  const ux = dx / len;
  const uy = dy / len;
  return [
    { x: p0.x + ux * trim, y: p0.y + uy * trim },
    { x: p1.x - ux * trim, y: p1.y - uy * trim },
  ];
}

/** One direction arrow on a rendered path (quadratic leg). */
function drawArrowOnPathElement(
  rc: RoughSVG,
  svg: SVGSVGElement,
  curveGroup: SVGElement,
  color: string,
  midT = 0.55,
  endpoints?: { from: Point2D; to: Point2D },
) {
  const path = curveGroup.querySelector("path");
  if (!path) return;

  const geometry = pathGeometry(path);
  if (!geometry) {
    if (!endpoints) return;
    const { from, to } = endpoints;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    const tip = { x: from.x + dx * midT, y: from.y + dy * midT };
    const tail = { x: tip.x - (dx / len) * 14, y: tip.y - (dy / len) * 14 };
    drawArrowHead(rc, svg, tail, tip, color, 11);
    return;
  }

  const lenAt = Math.max(0, Math.min(geometry.total, geometry.total * midT));
  const tip = geometry.pointAt(lenAt);
  const ahead = geometry.pointAt(Math.min(geometry.total, lenAt + 2));
  const behind = geometry.pointAt(Math.max(0, lenAt - 2));
  if (!tip || !ahead || !behind) return;

  let tx = ahead.x - behind.x;
  let ty = ahead.y - behind.y;
  const tlen = Math.hypot(tx, ty);
  if (tlen < 1e-3) return;
  tx /= tlen;
  ty /= tlen;

  const tail = { x: tip.x - tx * 14, y: tip.y - ty * 14 };
  drawArrowHead(rc, svg, tail, { x: tip.x, y: tip.y }, color, 11);
}

/** Soft watercolor wash beneath a spline route stroke. */
function appendRouteWashCurve(
  rc: RoughSVG,
  svg: SVGSVGElement,
  filterId: string,
  wc: ThemeColors["watercolor"],
  curve: [number, number][],
  bowing: number,
): void {
  const fallback = rc.curve(curve, {
    stroke: wc.routeWash,
    strokeWidth: 12,
    roughness: 0.9,
    bowing,
    ...NO_STROKE_SHADOW,
  });
  fallback.setAttribute("opacity", "0.18");
  fallback.setAttribute("stroke-linecap", "round");
  svg.appendChild(fallback);

  const washGroup = document.createElementNS(SVG_NS, "g");
  washGroup.setAttribute("filter", `url(#${filterId}-wet)`);
  washGroup.setAttribute("opacity", "0.28");
  washGroup.appendChild(
    rc.curve(curve, {
      stroke: wc.routeWash,
      strokeWidth: 10,
      roughness: 0.8,
      bowing,
      ...NO_STROKE_SHADOW,
    }),
  );
  svg.appendChild(washGroup);
}

function appendRouteShadowCurve(
  rc: RoughSVG,
  svg: SVGSVGElement,
  stroke: string,
  curve: [number, number][],
  bowing: number,
): void {
  const shadow = rc.curve(curve, {
    stroke,
    strokeWidth: 0.8,
    roughness: 1.2,
    bowing,
    ...NO_STROKE_SHADOW,
  });
  shadow.setAttribute("opacity", "0.36");
  shadow.setAttribute("stroke-dasharray", "2 5");
  shadow.setAttribute("stroke-linecap", "round");
  svg.appendChild(shadow);
}

/** Soft watercolor wash beneath a quadratic arc leg. */
function appendRouteWashPath(
  rc: RoughSVG,
  svg: SVGSVGElement,
  filterId: string,
  wc: ThemeColors["watercolor"],
  d: string,
): void {
  const fallback = rc.path(d, {
    stroke: wc.routeWash,
    strokeWidth: 12,
    roughness: 0.9,
    bowing: 0,
    ...NO_STROKE_SHADOW,
  });
  fallback.setAttribute("opacity", "0.18");
  fallback.setAttribute("stroke-linecap", "round");
  svg.appendChild(fallback);

  const washGroup = document.createElementNS(SVG_NS, "g");
  washGroup.setAttribute("filter", `url(#${filterId}-wet)`);
  washGroup.setAttribute("opacity", "0.28");
  washGroup.appendChild(
    rc.path(d, {
      stroke: wc.routeWash,
      strokeWidth: 10,
      roughness: 0.8,
      bowing: 0,
      ...NO_STROKE_SHADOW,
    }),
  );
  svg.appendChild(washGroup);
}

function appendRouteShadowPath(rc: RoughSVG, svg: SVGSVGElement, stroke: string, d: string): void {
  const shadow = rc.path(d, {
    stroke,
    strokeWidth: 0.8,
    roughness: 1.2,
    bowing: 0,
    ...NO_STROKE_SHADOW,
  });
  shadow.setAttribute("opacity", "0.36");
  shadow.setAttribute("stroke-dasharray", "2 5");
  shadow.setAttribute("stroke-linecap", "round");
  svg.appendChild(shadow);
}

function appendBidirectionalLeg(
  rc: RoughSVG,
  svg: SVGSVGElement,
  p0: Point2D,
  p1: Point2D,
  arcSide: BidirectionalArcSide,
  colors: ThemeColors,
  filterId: string,
  roughness: number,
): void {
  const wc = colors.watercolor;
  const [start, end] = trimSegmentEndpoints(p0, p1);
  const cp = arcControlPoint(start, end, arcSide);
  const d = `M ${start.x} ${start.y} Q ${cp.x} ${cp.y} ${end.x} ${end.y}`;
  appendRouteWashPath(rc, svg, filterId, wc, d);
  appendRouteShadowPath(rc, svg, colors.watercolor.inkSoft ?? colors.border, d);
  const inkCurve = rc.path(d, {
    stroke: wc.routeInk,
    strokeWidth: 2,
    roughness,
    bowing: 0,
    ...NO_STROKE_SHADOW,
  });
  svg.appendChild(inkCurve);
  drawArrowOnPathElement(rc, svg, inkCurve, wc.routeInk, 0.55, {
    from: start,
    to: end,
  });
}

function appendRouteCurve(
  rc: RoughSVG,
  svg: SVGSVGElement,
  strokePoints: Point2D[],
  colors: ThemeColors,
  filterId: string,
  roughness: number,
  bowing: number,
): void {
  if (strokePoints.length < 2) return;
  const wc = colors.watercolor;
  const curve: [number, number][] = strokePoints.map((p) => [p.x, p.y]);
  appendRouteWashCurve(rc, svg, filterId, wc, curve, bowing);
  appendRouteShadowCurve(rc, svg, colors.watercolor.inkSoft ?? colors.border, curve, bowing);
  const inkCurve = rc.curve(curve, {
    stroke: wc.routeInk,
    strokeWidth: 2,
    roughness,
    bowing,
    ...NO_STROKE_SHADOW,
  });
  svg.appendChild(inkCurve);
  drawArrowsOnCurve(rc, svg, inkCurve, strokePoints, wc.routeInk, {
    arrowSize: 11,
    backLen: 14,
    minSegment: 30,
  });
}

function drawWatercolorRoute(
  svg: SVGSVGElement,
  points: Point2D[],
  colors: ThemeColors,
  filterId: string,
  roughness: number,
) {
  if (points.length < 2) return;
  const rc = rough.svg(svg);
  const MARKER_D = 26;
  const bidirectional = detectBidirectionalSegmentOffsets(points, MARKER_D * 0.6);

  let chainStart = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const side = bidirectional.get(i);
    if (side === undefined) continue;

    // Draw any plain legs before this arc without including the arc endpoints
    // in one spline (that would collapse outbound + return into one chord).
    if (i > chainStart) {
      appendRouteCurve(rc, svg, points.slice(chainStart, i + 1), colors, filterId, roughness, 2);
    }

    appendBidirectionalLeg(rc, svg, points[i], points[i + 1], side, colors, filterId, roughness);
    chainStart = i + 1;
  }

  if (chainStart < points.length - 1) {
    appendRouteCurve(rc, svg, points.slice(chainStart), colors, filterId, roughness, 2);
  }
}

function drawWatercolorMarkers(
  svg: SVGSVGElement,
  locations: Location[],
  points: Point2D[],
  colors: ThemeColors,
  filterId: string,
) {
  const rc = rough.svg(svg);

  const MARKER_D = 26; // disk diameter — large enough to host the number
  const COLLISION_PX = MARKER_D * 0.6;

  // Group markers that fall on the same pixel position (e.g. round-trip
  // routes where the start point repeats as the last stop). Each group is
  // rendered as a single marker carrying a composite label like "1·6".
  interface MarkerGroup {
    point: Point2D;
    indices: number[]; // route indices (0-based) collapsed into this group
    name: string;
  }
  const groups: MarkerGroup[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const existing = groups.find(
      (g) => Math.hypot(g.point.x - p.x, g.point.y - p.y) < COLLISION_PX,
    );
    if (existing) {
      existing.indices.push(i);
    } else {
      groups.push({ point: p, indices: [i], name: locations[i].name });
    }
  }

  for (const g of groups) {
    const p = g.point;
    const label = g.indices.map((i) => i + 1).join("·");
    // Shrink the number when the composite label gets long so it still fits
    // inside the marker disk (e.g. "10·12" vs a single "1").
    const numSize = label.length <= 2 ? 18 : label.length <= 4 ? 14 : 11;

    // Soft watercolor halo beneath the marker disk.
    const halo = document.createElementNS(SVG_NS, "circle");
    halo.setAttribute("cx", String(p.x));
    halo.setAttribute("cy", String(p.y));
    halo.setAttribute("r", String(MARKER_D * 0.85));
    halo.setAttribute("fill", `url(#${filterId}-marker-wash)`);
    halo.setAttribute("opacity", "0.65");
    svg.appendChild(halo);

    // Marker disk — sized to fit the index number inside.
    svg.appendChild(
      rc.circle(p.x, p.y, MARKER_D, {
        fill: colors.marker,
        fillStyle: "solid",
        stroke: colors.text,
        strokeWidth: 1.4,
        roughness: 1.4,
        ...NO_STROKE_SHADOW,
        ...NO_FILL_SHADOW,
      }),
    );

    // Composite index label, centered inside the disk.
    appendText(svg, p.x, p.y + numSize / 3, label, colors.paper, numSize, {
      weight: 700,
      anchor: "middle",
      halo: false,
      family: FONT_HAND,
    });

    // Place name below the marker disk, slightly smaller than the index.
    appendText(svg, p.x, p.y + MARKER_D / 2 + 14, g.name, colors.text, 14, {
      weight: 600,
      anchor: "middle",
      halo: true,
      haloColor: colors.paper,
      family: FONT_HAND,
    });
  }
}

function drawWatercolorTitle(svg: SVGSVGElement, title: string, colors: ThemeColors) {
  if (!title.trim()) return;
  const wc = colors.watercolor;
  const titleX = 36;
  const titleY = 58;
  const titleSize = 30;

  const titleEl = appendText(svg, titleX, titleY, title, colors.text, titleSize, {
    weight: 700,
    family: FONT_HAND,
    halo: false,
  });

  // Match the hand-drawn accent to the actual rendered title width.
  const underline = document.createElementNS(SVG_NS, "line");
  const titleWidth = measureTextWidth(titleEl, title, titleSize);
  // Keep a hand-drawn look by making the underline slightly shorter than the
  // rendered text width. Full-width lines tend to overhang, especially with
  // cursive fonts and CJK fallback glyph metrics.
  const startInset = Math.min(8, Math.max(3, titleSize * 0.2));
  const underlineX = titleX + startInset;
  const underlineWidth = Math.max(24, titleWidth * 0.65);
  underline.setAttribute("x1", String(underlineX));
  underline.setAttribute("y1", "66");
  underline.setAttribute("x2", String(underlineX + underlineWidth));
  underline.setAttribute("y2", "69");
  underline.setAttribute("stroke", wc.routeInk);
  underline.setAttribute("stroke-width", "2.4");
  underline.setAttribute("stroke-linecap", "round");
  underline.setAttribute("opacity", "0.7");
  svg.appendChild(underline);
}

/** Clear and redraw the sketch map into an existing SVG element. */
export function renderSketchMapSvg(svg: SVGSVGElement, args: RenderSketchMapArgs): void {
  const {
    locations,
    cities,
    provinces,
    rivers,
    title,
    width = DEFAULT_MAP_WIDTH,
    height = DEFAULT_MAP_HEIGHT,
    filterId = `hd-${Math.random().toString(36).slice(2, 8)}`,
  } = args;

  canvasW = width;
  canvasH = height;

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const colors = THEME;
  const rc = rough.svg(svg);
  const roughness = MIN_ROUGHNESS;

  appendWatercolorDefs(svg, colors, filterId);
  paintWatercolorPaper(svg, colors, filterId);

  if (locations.length === 0) {
    appendText(svg, canvasW / 2, canvasH / 2, "Add places to draw your map", colors.text, 22, {
      anchor: "middle",
    });
    return;
  }

  let aggBbox: BBox | null = computeBBox(locations, 0);
  for (const p of provinces) {
    aggBbox = unionBBox(aggBbox, bbox(p) as BBox);
  }
  for (const c of cities) {
    aggBbox = unionBBox(aggBbox, bbox(c) as BBox);
  }
  if (!aggBbox) return;

  const proj = createProjection(aggBbox, canvasW, canvasH, 40);

  for (const province of provinces) {
    drawPolygonFeature(rc, svg, province, proj, roughness, {
      fill: colors.land,
      stroke: colors.landStroke,
      strokeWidth: 1.1,
    });
  }

  const provinceMask = provinces.length > 0 ? indexPolygons(provinces) : null;
  const riverLabels: LabelBox[] = [];
  drawRivers(rc, svg, rivers, proj, colors, roughness, provinceMask, riverLabels);

  for (const city of cities) {
    drawPolygonFeature(rc, svg, city, proj, roughness, {
      fill: colors.highlight.fill,
      stroke: colors.highlight.stroke,
      strokeWidth: 1.6,
      fillOpacity: 0.85,
    });
  }

  const skipCityName = new Set<string>();
  for (const city of cities) {
    const cname = city.properties.name;
    const duplicated = locations.some(
      (l) => l.name === cname || l.name.includes(cname) || cname.includes(l.name),
    );
    if (duplicated) skipCityName.add(cname);
  }

  const cityNames = new Set(cities.map((c) => c.properties.name));
  for (const province of provinces) {
    const pname = province.properties.name;
    if (cityNames.has(pname)) continue;
    const p = featureLabelPoint(province, proj);
    if (!p) continue;
    appendText(svg, p.x, p.y - 22, pname, colors.text, 22, {
      anchor: "middle",
      halo: true,
      haloColor: colors.paper,
      family: FONT_HAND,
      weight: 600,
      opacity: 0.45,
    });
  }

  for (const city of cities) {
    if (skipCityName.has(city.properties.name)) continue;
    const p = featureLabelPoint(city, proj);
    if (!p) continue;
    appendText(svg, p.x, p.y, city.properties.name, colors.text, 18, {
      anchor: "middle",
      halo: true,
      haloColor: colors.paper,
      family: FONT_HAND,
    });
  }

  const routePts: Point2D[] = locations.map((l) => proj.project(l.lat, l.lng));

  drawWatercolorRoute(svg, routePts, colors, filterId, roughness);
  drawWatercolorMarkers(svg, locations, routePts, colors, filterId);

  drawCompass(rc, svg, colors);
  drawWatercolorTitle(svg, title, colors);
}
