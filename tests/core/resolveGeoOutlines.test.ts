import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Location } from "../../src/core/types.js";
import type { CityFeature } from "../../src/core/cityLookup.js";
import type { ProvinceFeature } from "../../src/core/provinceLookup.js";
import type { RiverFeature } from "../../src/core/riverLookup.js";
import * as cityLookup from "../../src/core/cityLookup.js";
import * as provinceLookup from "../../src/core/provinceLookup.js";
import * as riverLookup from "../../src/core/riverLookup.js";
import { resolveGeoOutlines } from "../../src/core/resolveGeoOutlines.js";

vi.mock("../../src/core/cityLookup.js", () => ({ findCityForPoint: vi.fn() }));
vi.mock("../../src/core/provinceLookup.js", () => ({ findProvinceByName: vi.fn() }));
vi.mock("../../src/core/riverLookup.js", () => ({ findRiversForCities: vi.fn() }));

function city(adcode: number, name: string, province: string): CityFeature {
  return {
    type: "Feature",
    properties: {
      adcode,
      name,
      province,
      level: "city",
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

function province(adcode: number, name: string): ProvinceFeature {
  return {
    type: "Feature",
    properties: {
      adcode,
      name,
      level: "province",
      center: [114, 30],
      centroid: [114, 30],
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [110, 26],
          [118, 26],
          [118, 34],
          [110, 34],
          [110, 26],
        ],
      ],
    },
  };
}

describe("resolveGeoOutlines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dedupes cities/provinces and resolves unmatched locations", () => {
    const wuhan = city(420100, "武汉", "湖北");
    const changsha = city(430100, "长沙", "湖南");
    const hubei = province(420000, "湖北");
    const hunan = province(430000, "湖南");
    const mockedRiver: RiverFeature = {
      type: "Feature",
      properties: {
        name: "长江",
        name_en: "Yangtze",
        rank: 1,
        provinces: ["湖北"],
        cities: [420100],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [114, 30],
          [115, 30.2],
        ],
      },
    };

    vi.mocked(cityLookup.findCityForPoint)
      .mockReturnValueOnce(wuhan)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(wuhan)
      .mockReturnValueOnce(changsha);
    vi.mocked(provinceLookup.findProvinceByName).mockImplementation((name) => {
      if (name === "湖北") return hubei;
      if (name === "湖南") return hunan;
      return null;
    });
    vi.mocked(riverLookup.findRiversForCities).mockReturnValue([mockedRiver]);

    const locations: Location[] = [
      { id: "1", name: "武汉", displayName: "武汉", lat: 30.6, lng: 114.3 },
      { id: "2", name: "未知点", displayName: "未知点", lat: 0, lng: 0 },
      { id: "3", name: "武汉复访", displayName: "武汉复访", lat: 30.6, lng: 114.3 },
      { id: "4", name: "长沙", displayName: "长沙", lat: 28.2, lng: 112.9 },
    ];

    const result = resolveGeoOutlines(locations);

    expect(result.cities.map((c) => c.properties.adcode)).toEqual([420100, 430100]);
    expect(result.provinces.map((p) => p.properties.adcode)).toEqual([420000, 430000]);
    expect(result.unmatchedLocations).toEqual(["未知点"]);
    expect(result.rivers).toEqual([mockedRiver]);

    const [cityAdcodes] = vi.mocked(riverLookup.findRiversForCities).mock.calls[0];
    expect(Array.from(cityAdcodes)).toEqual([420100, 430100]);
  });
});
