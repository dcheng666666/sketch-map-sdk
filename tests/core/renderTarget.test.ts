import { describe, expect, it } from "vitest";
import { makeError, makeSuccess } from "../../src/core/renderTarget.js";

describe("renderTarget result semantics", () => {
  it("returns status partial with unmatched locations", () => {
    const result = makeSuccess({ locationCount: 3, unmatchedLocations: ["未知点"] }, "svg", {
      svg: "<svg></svg>",
    });

    expect(result.status).toBe("partial");
    expect(result.message).toContain("1 unmatched: 未知点");
  });

  it("returns status ok when every location is matched", () => {
    const result = makeSuccess({ locationCount: 2, unmatchedLocations: [] }, "png", {
      png: new Blob(["ok"], { type: "image/png" }),
    });

    expect(result.status).toBe("ok");
    expect(result.message).toContain("Rendered 2 locations to png.");
  });

  it("normalizes unknown errors into error result", () => {
    const error = makeError(new Error("boom"));

    expect(error.status).toBe("error");
    expect(error.message).toBe("boom");
  });
});
