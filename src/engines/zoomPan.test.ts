import { describe, expect, it } from "vitest";
import { clampPan, fitScale, lerpScale, rotatedSize, wheelZoomFactor, zoomAt, zoomPercent } from "./zoomPan";

describe("zoomPan", () => {
  it("fits landscape and rotated images", () => {
    expect(fitScale({ w: 4000, h: 3000 }, { w: 1000, h: 1000 })).toBeCloseTo(0.25);
    expect(fitScale({ w: 4000, h: 3000 }, { w: 1000, h: 1000 }, 90)).toBeCloseTo(0.25);
    expect(fitScale({ w: 4000, h: 1000 }, { w: 1000, h: 1000 }, 90)).toBeCloseTo(0.25);
    expect(rotatedSize({ w: 2, h: 1 }, 270)).toEqual({ w: 1, h: 2 });
    expect(rotatedSize({ w: 2, h: 1 }, -90)).toEqual({ w: 1, h: 2 });
  });

  it("anchored zoom on a small image is not undone by the free clamp", () => {
    const img = { w: 640, h: 427 };
    const vp = { w: 1320, h: 860 };
    const anchor = { x: -160, y: -130 }; // left of and above centre, on the image
    let v = { scale: 1, x: 0, y: 0 };
    const px = { x: (anchor.x - v.x) / v.scale, y: (anchor.y - v.y) / v.scale };
    for (let i = 0; i < 6; i++) v = clampPan(zoomAt(v, v.scale * 1.2, anchor), img, vp, 0, true);
    expect((anchor.x - v.x) / v.scale).toBeCloseTo(px.x);
    expect((anchor.y - v.y) / v.scale).toBeCloseTo(px.y);
  });

  it("keeps the pixel under the cursor fixed", () => {
    const v = { scale: 0.5, x: 30, y: -20 };
    const anchor = { x: 200, y: 100 };
    // Image coordinate under the anchor before zooming.
    const before = { x: (anchor.x - v.x) / v.scale, y: (anchor.y - v.y) / v.scale };
    const z = zoomAt(v, 2, anchor);
    const after = { x: (anchor.x - z.x) / z.scale, y: (anchor.y - z.y) / z.scale };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("zooming in then out at the same point returns to the start", () => {
    const v = { scale: 1, x: 0, y: 0 };
    const a = { x: -150, y: 80 };
    const back = zoomAt(zoomAt(v, 3, a), 1, a);
    expect(back.x).toBeCloseTo(0);
    expect(back.y).toBeCloseTo(0);
  });

  it("lets a zoomed image follow the cursor but never leave the viewport centre region", () => {
    const img = { w: 400, h: 200 };
    const vp = { w: 800, h: 600 };
    expect(clampPan({ scale: 1, x: 150, y: -50 }, img, vp, 0, true)).toEqual({ scale: 1, x: 150, y: -50 });
    expect(clampPan({ scale: 1, x: 999, y: 999 }, img, vp, 0, true)).toEqual({ scale: 1, x: 400, y: 300 });
    expect(clampPan({ scale: 1, x: 150, y: -50 }, img, vp, 0, false)).toEqual({ scale: 1, x: 0, y: 0 });
    // Larger than the viewport: a gap is allowed, but the edge stops at the viewport centre.
    expect(clampPan({ scale: 3, x: 9999, y: 0 }, img, vp, 0, true).x).toBe(600);
  });

  it("centres small images and bounds large ones", () => {
    const img = { w: 1000, h: 500 };
    const vp = { w: 800, h: 600 };
    expect(clampPan({ scale: 0.5, x: 99, y: 99 }, img, vp)).toEqual({ scale: 0.5, x: 0, y: 0 });
    const big = clampPan({ scale: 2, x: 5000, y: -5000 }, img, vp);
    expect(big.x).toBe((2000 - 800) / 2);
    expect(big.y).toBe(-(1000 - 600) / 2);
  });

  it("maps wheel direction: up zooms in, down zooms out, symmetric per notch", () => {
    const up = wheelZoomFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false }, 0.2);
    const down = wheelZoomFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false }, 0.2);
    expect(up).toBeCloseTo(1.2);
    expect(up * down).toBeCloseTo(1);
    expect(wheelZoomFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false }, 0.2)).toBeCloseTo(1.2);
    // A pinch is gentle and continuous.
    const pinch = wheelZoomFactor({ deltaY: -2, deltaMode: 0, ctrlKey: true }, 0.2);
    expect(pinch).toBeGreaterThan(1);
    expect(pinch).toBeLessThan(1.05);
    // Huge deltas are bounded.
    expect(wheelZoomFactor({ deltaY: -100000, deltaMode: 0, ctrlKey: false }, 0.2)).toBeCloseTo(Math.pow(1.2, 4));
  });

  it("reports device-pixel zoom and interpolates in log space", () => {
    expect(zoomPercent(0.5, 2)).toBe(100);
    expect(lerpScale(1, 4, 0.5)).toBeCloseTo(2);
  });
});
