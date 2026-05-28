# sketch-map-sdk

Hand-drawn / watercolor-style travel-route map renderer for China. Same API works
in the **browser** and in **Node.js** (headless via `jsdom` + `@resvg/resvg-js`);
the runtime is selected automatically through the package's `exports` conditions.

The renderer takes an ordered list of WGS84 lat/lng locations and produces:

- province washes
- rivers passing through the visited cities
- highlighted city polygons
- the route with direction arrows + numbered markers
- compass + optional title

China geo data (provinces / cities / rivers) is bundled inside the package, so no
extra fetch/setup is needed at runtime.

## Install

```bash
npm install sketch-map-sdk
# or
pnpm add sketch-map-sdk
```

Peer requirements:

- Node.js 20+ (for the headless runtime)
- A bundler that respects the `exports` field (Vite, webpack, esbuild, Rollup,
  Next.js, etc.) for the browser runtime

## Usage

### Node (PNG)

```ts
import { renderRoute } from "sketch-map-sdk";
import { writeFile } from "node:fs/promises";

const result = await renderRoute(
  {
    title: "华东行程",
    locations: [
      { name: "武汉", lat: 30.5928, lng: 114.3055 },
      { name: "黄山", lat: 30.1340, lng: 118.1700 },
      { name: "杭州", lat: 30.2741, lng: 120.1551 },
    ],
  },
  { kind: "png" },
);

if (result.status === "error") {
  throw new Error(result.message);
}

await writeFile("route.png", Buffer.from(await result.png.arrayBuffer()));
```

### Browser (SVG string or PNG Blob)

```ts
import { renderRoute } from "sketch-map-sdk";

const result = await renderRoute(input, { kind: "svg" });
if (result.status === "success") {
  container.innerHTML = result.svg;
}

const png = await renderRoute(input, { kind: "png", scale: 2 });
if (png.status === "success") {
  imgEl.src = URL.createObjectURL(png.png);
}
```

### Input schema

```ts
import { RouteInputSchema, type RouteInput } from "sketch-map-sdk";

const input: RouteInput = RouteInputSchema.parse(json);
```

| Field              | Required | Constraint                                                            |
| ------------------ | -------- | --------------------------------------------------------------------- |
| `locations`        | yes      | 1–50 ordered items (controls route arrows + marker numbers)            |
| `locations[].name` | yes      | Short label drawn next to the marker                                  |
| `locations[].lat`  | yes      | -90 to 90, WGS84                                                      |
| `locations[].lng`  | yes      | -180 to 180, WGS84                                                    |
| `title`            | no       | Up to 60 chars, drawn at the top                                      |
| `width`            | no       | 400–2000 px, default 800                                              |
| `height`           | no       | 300–2000 px, default 600                                              |

The PNG is rasterized at 2× the SVG viewBox size unless `target.scale` is set.

`renderRoute` never throws — failures surface as
`{ status: 'error', message, cause }`.

## Coverage

Mainland China only (WGS84). Locations outside China will not match the province /
city outlines and will appear under `summary.unmatchedLocations`.

## Develop

```bash
pnpm install
pnpm build         # tsc + copy src/core/data/*.json to dist/core/data/
npm pack --dry-run # inspect tarball contents
```

## First-time GitHub setup

```bash
git add .
git commit -m "Initial commit: sketch-map-sdk extracted from map-test monorepo"
git remote add origin git@github.com:dcheng666666/sketch-map-sdk.git
git push -u origin main
```

## Publish to npm

```bash
npm login                  # one-time per machine; OTP/2FA required
npm version patch          # or `minor` / `major`; bumps version + creates a git tag
npm publish                # publishConfig.access=public (unscoped package)
git push --follow-tags
```

`prepublishOnly` runs `npm run build` automatically, so the published tarball always contains a fresh `dist/` (including the bundled geo JSON under `dist/core/data/`).

### Verify after publish

```bash
npm view sketch-map-sdk
npm pack --dry-run         # local inspection of what would be uploaded
```
