declare module "omggif" {
  export class GifWriter {
    constructor(buffer: Uint8Array, width: number, height: number, options?: { loop?: number });
    addFrame(
      x: number,
      y: number,
      width: number,
      height: number,
      indexedPixels: Uint8Array,
      options: {
        palette: number[];
        delay?: number;
        disposal?: number;
      },
    ): number;
    end(): number;
  }
}