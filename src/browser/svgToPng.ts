const SVG_NS = "http://www.w3.org/2000/svg";

const EXPORT_FONT_FAMILIES = ["Caveat:wght@400;500;600;700", "ZCOOL KuaiLe"];

function collectSvgText(svg: SVGSVGElement): string {
  const text = Array.from(svg.querySelectorAll("text"))
    .map((el) => el.textContent ?? "")
    .join("");

  return Array.from(new Set(text)).join("");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("FileReader returned a non-string result for readAsDataURL"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

async function inlineFontUrls(css: string): Promise<string> {
  const urls = Array.from(
    new Set(
      Array.from(css.matchAll(/url\(([^)]+)\)/g), (match) =>
        match[1].trim().replace(/^["']|["']$/g, ""),
      ),
    ),
  ).filter((url) => /^https?:\/\//i.test(url));

  const dataUrls = new Map<string, string>();

  await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch font: ${url}`);
      dataUrls.set(url, await blobToDataUrl(await response.blob()));
    }),
  );

  return css.replace(/url\(([^)]+)\)/g, (match, rawUrl: string) => {
    const url = rawUrl.trim().replace(/^["']|["']$/g, "");
    const dataUrl = dataUrls.get(url);
    return dataUrl ? `url("${dataUrl}")` : match;
  });
}

async function createEmbeddedFontCss(svg: SVGSVGElement): Promise<string> {
  const url = new URL("https://fonts.googleapis.com/css2");
  for (const family of EXPORT_FONT_FAMILIES) {
    url.searchParams.append("family", family);
  }
  url.searchParams.set("display", "swap");

  const text = collectSvgText(svg);
  if (text) url.searchParams.set("text", text);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error("Failed to fetch font CSS");

  return inlineFontUrls(await response.text());
}

async function embedFontsForExport(svg: SVGSVGElement): Promise<void> {
  if ("fonts" in document) await document.fonts.ready;

  const css = await createEmbeddedFontCss(svg);
  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = css;

  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(SVG_NS, "defs");
    svg.insertBefore(defs, svg.firstChild);
  }
  defs.insertBefore(style, defs.firstChild);
}

/**
 * Rasterize an SVG string to a PNG Blob via the browser's Canvas pipeline.
 * Fonts referenced by the SVG are inlined as data URLs so the rendered PNG is
 * self-contained even when used offline. If font embedding fails (e.g. the
 * font CDN is unreachable) the function still produces a PNG using whatever
 * fonts the user agent can resolve.
 */
export async function svgStringToPngBlob(
  svgString: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error(`Invalid SVG string: ${parserError.textContent ?? ""}`);
  }
  const svg = doc.documentElement as unknown as SVGSVGElement;

  try {
    await embedFontsForExport(svg);
  } catch (error) {
    console.warn("Could not embed export fonts; falling back to SVG fonts.", error);
  }

  const finalSvgString = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([finalSvgString], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();

  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load SVG for rasterization"));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire 2D canvas context");
    ctx.fillStyle = "#fbf6e8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (pngBlob) resolve(pngBlob);
        else reject(new Error("Canvas toBlob returned null"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
