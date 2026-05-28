/**
 * Public contract shared by every renderRoute adapter (browser, headless,
 * future canvas/native, ...). Keeping it here avoids two packages drifting
 * apart and lets a caller write one consumer that handles either runtime.
 */

export interface RenderSummary {
  locationCount: number;
  unmatchedLocations: string[];
}

export type RenderTarget = { kind: "svg" } | { kind: "png"; scale?: number };

export type RenderStatus = "ok" | "partial" | "error";

export interface RenderError {
  status: "error";
  message: string;
  cause?: unknown;
}

type SuccessForSvg = {
  status: "ok" | "partial";
  message: string;
  summary: RenderSummary;
  svg: string;
};

type SuccessForPng = {
  status: "ok" | "partial";
  message: string;
  summary: RenderSummary;
  png: Blob;
};

export type RenderSuccess<T extends RenderTarget> = T extends { kind: "svg" }
  ? SuccessForSvg
  : T extends { kind: "png" }
    ? SuccessForPng
    : never;

export type RenderResult<T extends RenderTarget> = RenderSuccess<T> | RenderError;

type SuccessPayload<T extends RenderTarget> = T extends { kind: "svg" }
  ? { svg: string }
  : T extends { kind: "png" }
    ? { png: Blob }
    : never;

/**
 * Build a non-error result with the correct status (`ok` vs `partial`) and a
 * human-readable message useful for AI consumers. Throwing scenarios are
 * handled by the caller (renderRoute) wrapping everything in a try/catch.
 */
export function makeSuccess<T extends RenderTarget>(
  summary: RenderSummary,
  targetKind: T["kind"],
  payload: SuccessPayload<T>,
): RenderSuccess<T> {
  const unmatched = summary.unmatchedLocations;
  const status: "ok" | "partial" = unmatched.length > 0 ? "partial" : "ok";
  const message =
    status === "ok"
      ? `Rendered ${summary.locationCount} locations to ${targetKind}.`
      : `Rendered ${summary.locationCount} locations to ${targetKind}; ${unmatched.length} unmatched: ${unmatched.join(", ")}.`;

  return {
    status,
    message,
    summary,
    ...payload,
  } as RenderSuccess<T>;
}

/** Build a `{status: 'error'}` result from an arbitrary thrown value. */
export function makeError(cause: unknown): RenderError {
  return {
    status: "error",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  };
}
