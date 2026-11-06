import { describe, expect, it } from "vitest";
import { DEFAULT_EDIT, cssFilter, isIdentity, sharpenKernel, temperatureGains } from "./editPreview";

describe("edit preview", () => {
  it("identity has no filter", () => {
    expect(cssFilter(DEFAULT_EDIT)).toBe("none");
    expect(isIdentity(DEFAULT_EDIT)).toBe(true);
    expect(isIdentity({ ...DEFAULT_EDIT, rotate: 1 })).toBe(false);
  });

  it("combines exposure and brightness into one multiplier like the exporter", () => {
    expect(cssFilter({ ...DEFAULT_EDIT, exposure: 1, brightness: 0.5 })).toBe("brightness(3.0000)");
    expect(cssFilter({ ...DEFAULT_EDIT, contrast: -0.5, saturation: 1, temperature: 0.2, sharpness: 0.5 })).toBe(
      "url(#lumen-temperature) contrast(0.5000) saturate(2.0000) url(#lumen-sharpen)",
    );
  });

  it("temperature gains match the Rust implementation", () => {
    expect(temperatureGains(1)).toEqual({ r: 1.25, b: 0.75 });
    expect(temperatureGains(-5)).toEqual({ r: 0.75, b: 1.25 });
  });

  it("sharpen kernel sums to one (brightness preserving)", () => {
    const sum = sharpenKernel(0.8).split(" ").map(Number).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });
});
