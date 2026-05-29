/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/resolveGeoOutlines.js", () => ({
  resolveGeoOutlines: vi.fn(() => ({
    cities: [],
    provinces: [],
    rivers: [],
    unmatchedLocations: ["未知点"],
  })),
}));

vi.mock("../../src/browser/svgToPng.js", () => ({
  svgStringToPngBlob: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
}));

import { renderRoute } from "../../src/browser/renderRoute.js";
import { svgStringToPngBlob } from "../../src/browser/svgToPng.js";

describe("browser renderRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses default scale 2 and keeps partial semantics", async () => {
    const result = await renderRoute(
      {
        title: "Browser Test",
        locations: [
          { name: "武汉", lat: 30.6, lng: 114.3 },
          { name: "未知点", lat: 0, lng: 0 },
        ],
      },
      { kind: "png" },
    );

    expect(result.status).toBe("partial");
    if (result.status === "error") throw new Error(result.message);
    expect(result.png.type).toBe("image/png");
    expect(vi.mocked(svgStringToPngBlob)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(svgStringToPngBlob).mock.calls[0]?.[3]).toBe(2);
  });
});
