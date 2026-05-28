import { Resvg } from "@resvg/resvg-js";
import { JSDOM } from "jsdom";
import { PNG_SCALE } from "../core/render.js";
import { prepareScene, renderSceneToSvgString } from "../core/scene.js";
import {
  makeError,
  makeSuccess,
  type RenderResult,
  type RenderTarget,
} from "../core/renderTarget.js";
import type { Location } from "../core/types.js";
import type { RouteInput } from "../core/inputSchema.js";

type GlobalShim = {
  XMLSerializer?: typeof XMLSerializer;
};

/**
 * Run `fn` with JSDOM-backed DOM globals temporarily installed on `globalThis`.
 * Required because the core renderer uses `document.createElementNS` and
 * `new XMLSerializer()` directly. Previous globals are restored even when `fn`
 * throws.
 */
function withJsdom<T>(fn: () => T): T {
  const dom = new JSDOM(`<!DOCTYPE html>`);

  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevSerializer = (globalThis as GlobalShim).XMLSerializer;

  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  (globalThis as GlobalShim).XMLSerializer = dom.window.XMLSerializer;

  try {
    return fn();
  } finally {
    if (prevDoc !== undefined) globalThis.document = prevDoc;
    else Reflect.deleteProperty(globalThis, "document");
    if (prevWin !== undefined) globalThis.window = prevWin;
    else Reflect.deleteProperty(globalThis, "window");
    if (prevSerializer !== undefined) {
      (globalThis as GlobalShim).XMLSerializer = prevSerializer;
    } else {
      Reflect.deleteProperty(globalThis, "XMLSerializer");
    }
  }
}

/**
 * Unified renderer for the headless (Node.js) runtime. Mirrors the browser
 * `renderRoute` signature: same `target` discriminator, same `RenderResult<T>`
 * return shape (PNG is a `Blob` in both runtimes). Consumers should import
 * `renderRoute` from `@sketch-map/sdk`; the package's `exports` conditions
 * pick this implementation automatically when running under Node.
 * Never throws — failures become `{ status: 'error', message, cause }`.
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

    const { summary, svgString, width } = withJsdom(() => {
      const scene = prepareScene({
        locations,
        title: input.title,
        width: input.width,
        height: input.height,
      });
      return {
        summary: scene.summary,
        svgString: renderSceneToSvgString(scene),
        width: scene.args.width,
      };
    });

    if (target.kind === "svg") {
      return makeSuccess<T>(summary, target.kind, { svg: svgString } as never);
    }

    const scale = target.scale ?? PNG_SCALE;
    const resvg = new Resvg(svgString, {
      fitTo: { mode: "width", value: width * scale },
    });
    const buf = resvg.render().asPng();
    // resvg returns Node Buffer (Uint8Array<ArrayBufferLike>). BlobPart requires
    // Uint8Array<ArrayBuffer>, so copy into a fresh ArrayBuffer-backed view.
    const bytes = Uint8Array.from(buf);
    const png = new Blob([bytes], { type: "image/png" });
    return makeSuccess<T>(summary, target.kind, { png } as never);
  } catch (e) {
    return makeError(e) as RenderResult<T>;
  }
}
