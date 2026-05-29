/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import type { CityFeature } from "../../src/core/cityLookup.js";
import type { ProvinceFeature } from "../../src/core/provinceLookup.js";
import type { Location } from "../../src/core/types.js";
import { renderSketchMapSvg } from "../../src/core/render.js";

function cityFeature(name: string, provinceName: string): CityFeature {
  return {
    type: "Feature",
    properties: {
      adcode: 420100,
      name,
      level: "city",
      province: provinceName,
      center: [114.3, 30.6],
      centroid: [114.3, 30.6],
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [114.2, 30.5],
          [114.4, 30.5],
          [114.4, 30.7],
          [114.2, 30.7],
          [114.2, 30.5],
        ],
      ],
    },
  };
}

function provinceFeature(name: string): ProvinceFeature {
  return {
    type: "Feature",
    properties: {
      adcode: 420000,
      name,
      level: "province",
      center: [113.8, 30.2],
      centroid: [113.8, 30.2],
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [110.5, 27.5],
          [116.5, 27.5],
          [116.5, 32.5],
          [110.5, 32.5],
          [110.5, 27.5],
        ],
      ],
    },
  };
}

describe("renderSketchMapSvg core business rules", () => {
  function renderPathCount(locations: Location[]): number {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    renderSketchMapSvg(svg, {
      locations,
      cities: [cityFeature("武汉", "湖北")],
      provinces: [provinceFeature("湖北")],
      rivers: [],
      title: "",
      width: 800,
      height: 600,
      filterId: "test-filter",
    });
    return svg.querySelectorAll("path").length;
  }

  it("merges overlapping markers and suppresses duplicated city labels", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const locations: Location[] = [
      { id: "loc-1", name: "武汉站", displayName: "武汉站", lat: 30.6, lng: 114.3 },
      { id: "loc-2", name: "长沙", displayName: "长沙", lat: 28.2, lng: 112.9 },
      { id: "loc-3", name: "武汉站", displayName: "武汉站", lat: 30.6, lng: 114.3 },
    ];

    renderSketchMapSvg(svg, {
      locations,
      cities: [cityFeature("武汉", "湖北")],
      provinces: [provinceFeature("湖北")],
      rivers: [],
      title: "",
      width: 800,
      height: 600,
      filterId: "test-filter",
    });

    const texts = Array.from(svg.querySelectorAll("text")).map((el) =>
      (el.textContent ?? "").trim(),
    );
    expect(texts).toContain("1·3");
    expect(texts).toContain("武汉站");
    expect(texts).not.toContain("武汉");

    // A->B and B->A should create extra route path segments vs non-revisit route.
    const bidirectionalPathCount = renderPathCount(locations);
    const oneWayPathCount = renderPathCount([
      { id: "a", name: "武汉站", displayName: "武汉站", lat: 30.6, lng: 114.3 },
      { id: "b", name: "长沙", displayName: "长沙", lat: 28.2, lng: 112.9 },
      { id: "c", name: "南昌", displayName: "南昌", lat: 28.7, lng: 115.8 },
    ]);
    expect(bidirectionalPathCount).toBeGreaterThan(oneWayPathCount);
  });
});
