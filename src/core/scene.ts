import {
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  renderSketchMapSvg,
  type RenderSketchMapArgs,
} from "./render.js";
import type { RenderSummary } from "./renderTarget.js";
import { resolveGeoOutlines } from "./resolveGeoOutlines.js";
import type { Location } from "./types.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** High-level input shared by every renderer adapter. */
export interface SceneInput {
  locations: Location[];
  title?: string;
  width?: number;
  height?: number;
}

/**
 * Stats derived once during scene preparation and reused by every sink.
 * Alias of {@link RenderSummary} kept for backward-compatibility within engine.
 */
export type SceneSummary = RenderSummary;

/** Like `RenderSketchMapArgs` but with `width`/`height` guaranteed by prepareScene. */
export type SceneArgs = RenderSketchMapArgs & { width: number; height: number };

/**
 * A `Scene` bundles everything a sink needs to draw a sketch map: the resolved
 * geo outlines, the canvas dimensions, and the human-readable summary. It is
 * the single contract shared by the browser and headless renderers.
 */
export interface Scene {
  /** Render args ready to be passed to `drawScene`. */
  readonly args: SceneArgs;
  readonly summary: SceneSummary;
}

/** Sink-agnostic options that influence how a scene is drawn. */
export interface DrawSceneOptions {
  /**
   * Override the watercolor filter id (engine escape hatch). Normally callers
   * should leave this undefined so engine generates a fresh random prefix.
   */
  filterId?: string;
}

/**
 * Resolve geo outlines and pack everything into a `Scene`. Pure and sync — safe
 * to call from any environment.
 */
export function prepareScene(input: SceneInput): Scene {
  const width = input.width ?? DEFAULT_MAP_WIDTH;
  const height = input.height ?? DEFAULT_MAP_HEIGHT;
  const title = input.title ?? "";

  const geo = resolveGeoOutlines(input.locations);

  return {
    args: {
      locations: input.locations,
      cities: geo.cities,
      provinces: geo.provinces,
      rivers: geo.rivers,
      title,
      width,
      height,
    },
    summary: {
      locationCount: input.locations.length,
      unmatchedLocations: geo.unmatchedLocations,
    },
  };
}

/**
 * Draw a prepared `Scene` onto a target SVG element. This is the only function
 * sinks (browser, jsdom+resvg, future canvas/native renderers, ...) need to
 * call when they have a usable `SVGSVGElement` in hand.
 */
export function drawScene(
  svg: SVGSVGElement,
  scene: Scene,
  options?: DrawSceneOptions,
): void {
  renderSketchMapSvg(svg, {
    ...scene.args,
    filterId: options?.filterId ?? scene.args.filterId,
  });
}

/**
 * Render a `Scene` into a self-contained SVG string. Requires a DOM environment
 * (browser native; headless callers must set up JSDOM globals first).
 */
export function renderSceneToSvgString(
  scene: Scene,
  options?: DrawSceneOptions,
): string {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute(
    "viewBox",
    `0 0 ${scene.args.width} ${scene.args.height}`,
  );
  drawScene(svg, scene, options);
  return new XMLSerializer().serializeToString(svg);
}
