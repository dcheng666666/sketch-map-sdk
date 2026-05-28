import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Copy runtime JSON data assets that `tsc` does not emit to `dist/`.
// Keeps relative paths consistent with how `core/*Lookup.ts` import them.
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, "../src/core/data");
const destDir = resolve(here, "../dist/core/data");

if (!existsSync(srcDir)) {
  throw new Error(`Source data directory missing: ${srcDir}`);
}
mkdirSync(destDir, { recursive: true });
cpSync(srcDir, destDir, { recursive: true });
console.log(`Copied geo JSON data: ${srcDir} -> ${destDir}`);
