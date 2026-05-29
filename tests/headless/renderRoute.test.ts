import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../src/headless/renderRoute.js";

vi.mock("../../src/core/resolveGeoOutlines.js", () => ({
  resolveGeoOutlines: vi.fn(() => ({
    cities: [],
    provinces: [],
    rivers: [],
    unmatchedLocations: ["未知点"],
  })),
}));

describe("headless renderRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns partial SVG result instead of throwing", async () => {
    const result = await renderRoute(
      {
        title: "Headless Test",
        locations: [
          { name: "武汉", lat: 30.6, lng: 114.3 },
          { name: "未知点", lat: 0, lng: 0 },
        ],
      },
      { kind: "svg" },
    );

    expect(result.status).toBe("partial");
    if (result.status === "error") throw new Error(result.message);
    expect(result.svg).toContain("<svg");
    expect(result.summary.unmatchedLocations).toEqual(["未知点"]);
  });

  it("renders png blob with default scale", async () => {
    const result = await renderRoute(
      {
        title: "Headless PNG",
        locations: [
          { name: "武汉", lat: 30.6, lng: 114.3 },
          { name: "长沙", lat: 28.2, lng: 112.9 },
        ],
      },
      { kind: "png" },
    );

    expect(result.status).toBe("partial");
    if (result.status === "error") throw new Error(result.message);
    expect(result.png.type).toBe("image/png");
    expect(result.png.size).toBeGreaterThan(1000);
  });
});
