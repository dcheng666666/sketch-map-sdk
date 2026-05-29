import { describe, expect, it } from "vitest";
import type { Feature, Polygon } from "geojson";
import { clipLineToPolygons, indexPolygons } from "../../src/core/clipLine.js";

function rectangle(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
): Feature<Polygon> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minLng, minLat],
          [maxLng, minLat],
          [maxLng, maxLat],
          [minLng, maxLat],
          [minLng, minLat],
        ],
      ],
    },
  };
}

describe("clipLineToPolygons", () => {
  it("clips a crossing line to province boundary interior", () => {
    const mask = indexPolygons([rectangle(0, 0, 10, 10)]);
    const line: [number, number][] = [
      [-5, 5],
      [5, 5],
      [15, 5],
    ];

    const clipped = clipLineToPolygons(line, mask);

    expect(clipped).toHaveLength(1);
    const [segment] = clipped;
    expect(segment).toHaveLength(3);
    expect(segment[0][0]).toBeCloseTo(0, 2);
    expect(segment[0][1]).toBeCloseTo(5, 2);
    expect(segment[1]).toEqual([5, 5]);
    expect(segment[2][0]).toBeCloseTo(10, 2);
    expect(segment[2][1]).toBeCloseTo(5, 2);
  });

  it("treats multiple polygons as a union mask", () => {
    const mask = indexPolygons([rectangle(0, 0, 3, 3), rectangle(7, 0, 10, 3)]);
    const line: [number, number][] = [
      [-2, 1],
      [1, 1],
      [5, 1],
      [8, 1],
      [12, 1],
    ];

    const clipped = clipLineToPolygons(line, mask);

    expect(clipped).toHaveLength(2);
    expect(clipped[0][0][0]).toBeCloseTo(0, 2);
    expect(clipped[0][clipped[0].length - 1][0]).toBeCloseTo(3, 2);
    expect(clipped[1][0][0]).toBeCloseTo(7, 2);
    expect(clipped[1][clipped[1].length - 1][0]).toBeCloseTo(10, 2);
  });
});
