import { z } from "zod";
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_WIDTH } from "./render.js";

const locationSchema = z.object({
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const RouteInputSchema = z.object({
  locations: z.array(locationSchema).min(1).max(50),
  title: z.string().max(60).optional(),
  width: z.number().int().min(400).max(2000).default(DEFAULT_MAP_WIDTH),
  height: z.number().int().min(300).max(2000).default(DEFAULT_MAP_HEIGHT),
});

// Use z.input so width/height stay optional in the public type. Defaults are
// applied at .parse() time (e.g. MCP server) or by the renderer's prepareScene
// which already falls back to DEFAULT_MAP_WIDTH/HEIGHT when undefined.
export type RouteInput = z.input<typeof RouteInputSchema>;
