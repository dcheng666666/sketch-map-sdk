export interface ThemeColors {
  paper: string;
  land: string;
  landStroke: string;
  border: string;
  river: string;
  route: string;
  marker: string;
  text: string;
  watercolor: {
    /** Subtle grain shade — used in noise filter overlay. */
    paperGrain: string;
    /** Softer ink — secondary strokes, badges. */
    inkSoft: string;
    /** Watercolor wash beneath the route (semi-transparent). */
    routeWash: string;
    /** Ink color for the top route line. */
    routeInk: string;
    /** Watercolor halo around markers. */
    markerWash: string;
  };
  /**
   * Highlighter-style fill used to emphasize the user-selected city polygon
   * over the surrounding province.
   */
  highlight: {
    fill: string;
    stroke: string;
  };
}

/** The single watercolor theme used across the app (China-only sketch map). */
export const THEME: ThemeColors = {
  paper: "#FDFAF0",
  land: "#EDE4D0",
  landStroke: "#2C3E50",
  border: "#5A6C7D",
  river: "#5A8CB8",
  route: "#3D7A5A",
  marker: "#E8675F",
  text: "#2C3E50",
  watercolor: {
    paperGrain: "#E8E0CC",
    inkSoft: "#5A6C7D",
    routeWash: "#7FC8A9",
    routeInk: "#3D7A5A",
    markerWash: "#F4A6A0",
  },
  highlight: {
    fill: "#FFE89A",
    stroke: "#C8862B",
  },
};
