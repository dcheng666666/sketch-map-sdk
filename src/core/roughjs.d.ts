declare module "roughjs/bin/svg" {
  import type { Options } from "roughjs/bin/core";

  export interface RoughSVG {
    line(x1: number, y1: number, x2: number, y2: number, options?: Options): SVGGElement;
    rectangle(x: number, y: number, width: number, height: number, options?: Options): SVGGElement;
    circle(x: number, y: number, diameter: number, options?: Options): SVGGElement;
    polygon(points: [number, number][], options?: Options): SVGGElement;
    curve(points: [number, number][], options?: Options): SVGGElement;
    path(d: string, options?: Options): SVGGElement;
  }
}

declare module "roughjs" {
  import type { RoughSVG } from "roughjs/bin/svg";

  interface RoughLib {
    svg(svg: SVGSVGElement): RoughSVG;
  }

  const rough: RoughLib;
  export default rough;
}
