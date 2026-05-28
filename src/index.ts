// Main entry — runtime is selected via package.json `exports` conditions:
//   - bundlers (Vite/webpack/esbuild) → `browser` condition → dist/browser.js
//   - Node ESM resolver → `node` condition → dist/headless.js
// This file is only a fallback for resolvers that match neither condition.
export * from "./headless.js";
