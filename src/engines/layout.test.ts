import { describe, expect, it } from "vitest";
import { justifiedRows, uniformGrid } from "./layout";

describe("layout", () => {
  it("uniform grid fills the width", () => {
    const g = uniformGrid(1000, 180, 6, 0);
    expect(g.columns).toBe(5);
    expect(g.tile * g.columns + 6 * (g.columns - 1)).toBeCloseTo(1000);
    expect(uniformGrid(50, 180, 6, 0).columns).toBe(1);
  });

  it("justified rows fill the width exactly except the last", () => {
    const aspects = [1.5, 0.75, 1, 1.33, 1.5, 1.5, 0.66, 2, 1, 0.5];
    const rows = justifiedRows(aspects, 1000, 200, 4);
    expect(rows.reduce((n, r) => n + r.widths.length, 0)).toBe(aspects.length);
    for (const r of rows.slice(0, -1)) {
      const total = r.widths.reduce((a, b) => a + b, 0) + 4 * (r.widths.length - 1);
      expect(total).toBeCloseTo(1000, 3);
      expect(r.height).toBeLessThanOrEqual(200);
    }
    expect(rows.at(-1)!.height).toBe(200);
    expect(rows[1].top).toBeCloseTo(rows[0].height + 4);
  });
});
