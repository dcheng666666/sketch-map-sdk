import { prepareScene, renderSceneToSvgString } from "../core/scene.js";
import {
  makeError,
  makeSuccess,
  type RenderResult,
  type RenderTarget,
} from "../core/renderTarget.js";
import type { Location } from "../core/types.js";
import { svgStringToPngBlob } from "./svgToPng.js";
import type { RouteInput } from "../core/inputSchema.js";

/**
 * Unified renderer for the browser runtime. Accepts a `target` discriminator so
 * the same call site can ask for either an SVG string or a PNG `Blob` without
 * juggling separate APIs. Never throws — failures surface as
 * `{ status: 'error', message, cause }` so AI/UI callers can branch on
 * `result.status` instead of try/catch.
 */
export async function renderRoute<T extends RenderTarget>(
  input: RouteInput,
  target: T,
): Promise<RenderResult<T>> {
  try {
    const locations: Location[] = input.locations.map((l, i) => ({
      id: `loc-${i}`,
      name: l.name,
      displayName: l.name,
      lat: l.lat,
      lng: l.lng,
    }));
    const scene = prepareScene({
      locations,
      title: input.title,
      width: input.width,
      height: input.height,
    });
    const svgString = renderSceneToSvgString(scene);

    if (target.kind === "svg") {
      return makeSuccess<T>(scene.summary, target.kind, { svg: svgString } as never);
    }

    const scale = target.scale ?? 2;
    const png = await svgStringToPngBlob(
      svgString,
      scene.args.width,
      scene.args.height,
      scale,
    );
    return makeSuccess<T>(scene.summary, target.kind, { png } as never);
  } catch (e) {
    return makeError(e) as RenderResult<T>;
  }
}
