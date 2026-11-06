import { describe, expect, it } from "vitest";
import { SLIDESHOW_EFFECTS, preloadOrder, randomEffect, shuffledOrder, step } from "./navigation";

describe("navigation", () => {
  it("steps with and without wrapping", () => {
    expect(step(0, -1, 5, true)).toBe(4);
    expect(step(4, 1, 5, true)).toBe(0);
    expect(step(0, -1, 5, false)).toBe(0);
    expect(step(4, 1, 5, false)).toBe(4);
    expect(step(0, 1, 0, true)).toBe(-1);
  });

  it("preloads nearest neighbours, favouring the travel direction", () => {
    expect(preloadOrder(5, 10, 2, 1, false)).toEqual([6, 4, 7, 3]);
    expect(preloadOrder(5, 10, 2, -1, false)).toEqual([4, 6, 3, 7]);
    expect(preloadOrder(0, 3, 2, 1, true)).toEqual([1, 2]);
    expect(preloadOrder(0, 3, 2, 1, false)).toEqual([1, 2]);
  });

  it("shuffles every index exactly once, starting at the current one", () => {
    const o = shuffledOrder(20, 7);
    expect(o[0]).toBe(7);
    expect([...o].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("random transition never repeats the previous effect and covers all effects", () => {
    let prev = randomEffect();
    const seen = new Set([prev]);
    for (let i = 0; i < 300; i++) {
      const next = randomEffect(prev);
      expect(next).not.toBe(prev);
      seen.add(next);
      prev = next;
    }
    expect(seen.size).toBe(SLIDESHOW_EFFECTS.length);
    expect(randomEffect("fade", () => 0.9999)).not.toBe("fade");
  });
});
