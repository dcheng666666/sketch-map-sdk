# sketch-map-sdk

## 0.1.2

### Patch Changes

- Shorten the rendered title underline to better match hand-drawn title text.
- Add README CI status and example route map image.
- Remove one-time repository setup and publishing notes from the README.

All notable changes to this project are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
From 0.1.1 onward, entries below are generated automatically by
[changesets](https://github.com/changesets/changesets).

## 0.1.1

### Patch Changes

- Update dev and runtime dependencies (including `eslint-plugin-boundaries`, `jsdom`, and `zod`) for improved compatibility and security.

## 0.1.0

### Initial release

- Hand-drawn / watercolor-style travel-route map renderer for mainland
  China, extracted from the internal `map-test` monorepo.
- Dual entry points selected via package.json `exports` conditions:
  `browser` (SVG string + PNG `Blob` via Canvas) and `node`
  (`@resvg/resvg-js` headless rasterizer).
- Bundles its own province, city, and river GeoJSON data so consumers
  do not need to fetch or configure anything at runtime.
- Public API: `renderRoute(input, target)` returning a never-throwing
  `RenderResult<T>` discriminated union, plus the `RouteInputSchema`
  zod schema for validation.
