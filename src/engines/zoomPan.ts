/**
 * Zoom & pan engine (pure math, no DOM).
 *
 * Coordinates: the image's centre sits at the viewport centre offset by
 * (x, y) CSS pixels; `scale` is CSS pixels per image pixel. Rotation happens
 * around the image centre, so cursor-anchored zoom does not depend on it.
 */

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewState {
  scale: number;
  x: number;
  y: number;
}

export const IDENTITY: ViewState = { scale: 1, x: 0, y: 0 };

/** Bounding size of the image after a rotation by a multiple of 90°. */
export function rotatedSize(img: Size, rotationDeg: number): Size {
  const quarter = (((Math.round(rotationDeg / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  return quarter % 2 === 1 ? { w: img.h, h: img.w } : img;
}

/** Scale that fits the (rotated) image inside the viewport. */
export function fitScale(img: Size, viewport: Size, rotationDeg = 0, padding = 0): number {
  const r = rotatedSize(img, rotationDeg);
  if (r.w <= 0 || r.h <= 0) return 1;
  const vw = Math.max(1, viewport.w - padding * 2);
  const vh = Math.max(1, viewport.h - padding * 2);
  return Math.min(vw / r.w, vh / r.h);
}

/**
 * Zoom to `newScale` keeping the image point under `anchor` (relative to the
 * viewport centre) fixed on screen.
 */
export function zoomAt(v: ViewState, newScale: number, anchor: Point): ViewState {
  const k = newScale / v.scale;
  return {
    scale: newScale,
    x: anchor.x - (anchor.x - v.x) * k,
    y: anchor.y - (anchor.y - v.y) * k,
  };
}

/**
 * Constrain the pan.
 * - Strict (`free = false`): a larger axis covers the viewport with no gaps, a
 *   smaller axis is centred.
 * - Free (after cursor-anchored zoom): the image may move off-centre until its
 *   centre reaches the viewport edge (smaller axis) or its edge reaches the
 *   viewport centre (larger axis). This keeps the pixel under the cursor fixed
 *   while zooming. Zooming out to fit re-centres.
 */
export function clampPan(v: ViewState, img: Size, viewport: Size, rotationDeg = 0, free = false): ViewState {
  const r = rotatedSize(img, rotationDeg);
  const W = r.w * v.scale;
  const H = r.h * v.scale;
  const lim = (size: number, vp: number) => {
    if (!free) return Math.max(0, (size - vp) / 2);
    // Free: the image may move off-centre as far as keeping its centre inside the
    // viewport (smaller axis) or covering the viewport centre (larger axis), so
    // cursor-anchored zoom is never pushed away from the cursor.
    return Math.max(size, vp) / 2;
  };
  const limX = lim(W, viewport.w);
  const limY = lim(H, viewport.h);
  return { scale: v.scale, x: clampNum(v.x, -limX, limX) + 0, y: clampNum(v.y, -limY, limY) + 0 }; // +0 turns -0 into 0
}

function clampNum(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export interface ZoomLimits {
  /** Minimum scale as a fraction of the fit scale, or absolute minimum, whichever is smaller. */
  min: number;
  max: number;
}

export function clampScale(scale: number, limits: ZoomLimits): number {
  return clampNum(scale, limits.min, limits.max);
}

/**
 * Multiplicative zoom factor for a wheel event.
 * - Mouse wheels (line mode or large pixel deltas): one fixed step per notch.
 * - Touchpad pinch (ctrlKey + small pixel deltas): continuous, proportional.
 * Scrolling up (negative deltaY) zooms in.
 */
export function wheelZoomFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }, stepPerNotch: number): number {
  const step = Math.max(0.01, stepPerNotch);
  if (e.deltaMode === 1 || e.deltaMode === 2) {
    // Lines / pages: count notches.
    const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY;
    return Math.pow(1 + step, -clampNum(notches, -4, 4));
  }
  if (e.ctrlKey && Math.abs(e.deltaY) < 50) {
    // Pinch gesture: smooth exponential mapping.
    return Math.exp(-e.deltaY * 0.01);
  }
  // Pixel-mode wheel: ~100px per notch on most systems (120 on Windows).
  const notches = clampNum(e.deltaY / 100, -4, 4);
  return Math.pow(1 + step, -notches);
}

/** Device-pixel zoom percentage, i.e. 100% means one image pixel per screen pixel. */
export const zoomPercent = (scale: number, dpr: number) => scale * dpr * 100;

/** Interpolate scale in log space; used by the smooth-zoom animation. */
export const lerpScale = (from: number, to: number, t: number) => Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * t);

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
