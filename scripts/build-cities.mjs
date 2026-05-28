// Build a single china-cities.json by combining:
//  - Direct-controlled municipalities (Beijing/Tianjin/Shanghai/Chongqing)
//    represented by their district/county boundaries from DataV _full.json
//  - Prefecture-level cities fetched from DataV per-province _full.json
//
// Output: src/core/data/china-cities.json (FeatureCollection)
// Run: npm run build:cities

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import simplify from "@turf/simplify";

const __dirname = dirname(fileURLToPath(import.meta.url));
const geoDir = join(__dirname, "../src/core/data");

const MUNICIPALITY_ADCODES = new Set([110000, 120000, 310000, 500000]);
const FETCH_RETRIES = 3;
const SIMPLIFY_TOLERANCE = 0.01;
const FETCH_DELAY_MS = 80;

async function fetchJson(url) {
  let lastErr;
  for (let i = 0; i < FETCH_RETRIES; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

function simplifyFeature(feature) {
  try {
    return simplify(feature, {
      tolerance: SIMPLIFY_TOLERANCE,
      highQuality: false,
      mutate: false,
    });
  } catch {
    return feature;
  }
}

function normalizeCityFeature(feature, provinceName) {
  const f = simplifyFeature(feature);
  return {
    type: "Feature",
    properties: {
      adcode: f.properties.adcode,
      name: f.properties.name,
      center: f.properties.center,
      centroid: f.properties.centroid,
      level: "city",
      province: provinceName,
    },
    geometry: f.geometry,
  };
}

async function main() {
  const provinces = JSON.parse(readFileSync(join(geoDir, "china-provinces.json"), "utf8"));

  const cities = [];

  for (const p of provinces.features) {
    const adcode = p.properties.adcode;
    const isMunicipality = MUNICIPALITY_ADCODES.has(adcode);
    const targetLevel = isMunicipality ? "district" : "city";
    const targetLabel = isMunicipality ? "districts" : "cities";
    const url = `https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`;
    process.stdout.write(`  fetching ${p.properties.name} (${adcode})... `);
    try {
      const fc = await fetchJson(url);
      const cityFeatures = fc.features.filter((f) => f.properties.level === targetLevel);

      if (cityFeatures.length === 0) {
        throw new Error(`no ${targetLevel} features returned`);
      }

      for (const cf of cityFeatures) {
        cities.push(normalizeCityFeature(cf, p.properties.name));
      }
      console.log(`+${cityFeatures.length} ${targetLabel}`);
    } catch (e) {
      console.log(`failed: ${e.message}`);
      if (isMunicipality) {
        throw e;
      }
    }
    await new Promise((r) => setTimeout(r, FETCH_DELAY_MS)); // be polite
  }

  const output = {
    type: "FeatureCollection",
    features: cities,
  };

  const outPath = join(geoDir, "china-cities.json");
  writeFileSync(outPath, JSON.stringify(output));

  const bytes = readFileSync(outPath).length;
  console.log(`\nWrote ${outPath}: ${cities.length} cities, ${(bytes / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
