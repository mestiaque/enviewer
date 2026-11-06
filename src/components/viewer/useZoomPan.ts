import { useCallback, useEffect, useRef, useState } from "react";
import { clampPan, clampScale, easeOutCubic, fitScale, lerpScale, zoomAt, type Point, type Size, type ViewState } from "../../engines/zoomPan";

export interface ZoomPanOptions {
  content: Size | null;
  viewport: Size;
  rotation: number;
  dpr: number;
  minPercent: number;
  maxPercent: number;
  smooth: boolean;
  initial: "fit" | "fitLarge" | "actual";
}

export type ZoomMode = "fit" | "free";

const DURATION = 140;

/**
 * View state for one image. Smooth zoom animates scale in log space and, on
 * every frame, recomputes the pan from the *anchor* so the pixel under the
 * cursor never drifts, even mid-animation or when wheel events pile up.
 */
export function useZoomPan(o: ZoomPanOptions) {
  const [view, setViewState] = useState<ViewState | null>(null);
  const [mode, setMode] = useState<ZoomMode>("fit");
  const viewRef = useRef<ViewState | null>(null);
  const targetScale = useRef<number | null>(null);
  const anim = useRef<{ raf: number; start: ViewState; anchor: Point; s0: number; s1: number; t0: number; toCenter: boolean } | null>(null);
  const opts = useRef(o);
  opts.current = o;

  const setView = (v: ViewState) => {
    viewRef.current = v;
    setViewState(v);
  };

  const fit = useCallback(() => {
    const { content, viewport, rotation } = opts.current;
    return content ? fitScale(content, viewport, rotation) : 1;
  }, []);
  const actual = useCallback(() => 1 / opts.current.dpr, []);
  const limits = useCallback(() => {
    const { minPercent, maxPercent, dpr } = opts.current;
    return { min: Math.min(fit(), minPercent / 100 / dpr), max: Math.max(fit(), maxPercent / 100 / dpr) };
  }, [fit]);

  const stopAnim = () => {
    if (anim.current) cancelAnimationFrame(anim.current.raf);
    anim.current = null;
    targetScale.current = null;
  };

  // The image may sit off-centre after cursor-anchored zoom, but always stays fully
  // visible (or fully covering the viewport). Zooming out to fit re-centres it.
  const clamp = useCallback((v: ViewState) => {
    const { content, viewport, rotation } = opts.current;
    return content ? clampPan(v, content, viewport, rotation, true) : v;
  }, []);

  const applyFit = useCallback(() => {
    stopAnim();
    setMode("fit");
    setView({ scale: fit(), x: 0, y: 0 });
  }, [fit]);

  // Initial view once the content size is known.
  const initialised = useRef(false);
  useEffect(() => {
    if (!o.content || initialised.current) return;
    initialised.current = true;
    const f = fit();
    const a = actual();
    if (o.initial === "actual") {
      setMode("free");
      setView(clamp({ scale: a, x: 0, y: 0 }));
    } else if (o.initial === "fitLarge" && f > a) {
      // Small image: show at 100% instead of upscaling, but it still "fits".
      setMode("fit");
      setView({ scale: a, x: 0, y: 0 });
    } else applyFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.content]);

  // Re-fit on viewport/rotation/content changes while in fit mode; otherwise just re-clamp.
  useEffect(() => {
    if (!viewRef.current || !o.content) return;
    if (mode === "fit") {
      const f = fit();
      const a = actual();
      const keepActual = opts.current.initial === "fitLarge" && f > a;
      setView({ scale: keepActual ? a : f, x: 0, y: 0 });
    } else setView(clamp(viewRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.viewport.w, o.viewport.h, o.rotation, o.content?.w, o.content?.h]);

  useEffect(() => () => stopAnim(), []);

  /** Zoom to an absolute scale around an anchor (relative to viewport centre). */
  const zoomTo = useCallback(
    (scale: number, anchor: Point = { x: 0, y: 0 }, animate = opts.current.smooth) => {
      const cur = viewRef.current;
      if (!cur) return;
      const f = fit();
      let s1 = clampScale(scale, limits());
      // Zooming out stops at "fit" once (centred); a further zoom-out goes below fit.
      if (s1 < cur.scale && cur.scale > f * 1.0001 && s1 < f) s1 = f;
      // Zooming in always follows the cursor; zooming out to fit (or below) re-centres.
      const toCenter = s1 < cur.scale && s1 <= f * 1.0001;
      setMode(toCenter && Math.abs(s1 - f) < f * 1e-4 ? "fit" : "free");
      const target = (s: number, t: number, start: ViewState, anc: Point): ViewState =>
        toCenter ? clamp({ scale: s, x: start.x * (1 - t), y: start.y * (1 - t) }) : clamp(zoomAt(start, s, anc));
      if (!animate) {
        stopAnim();
        setView(target(s1, 1, cur, anchor));
        return;
      }
      if (anim.current) cancelAnimationFrame(anim.current.raf);
      targetScale.current = s1;
      const a = { raf: 0, start: cur, anchor, s0: cur.scale, s1, t0: performance.now(), toCenter };
      anim.current = a;
      const frame = (now: number) => {
        if (anim.current !== a) return;
        const t = Math.min(1, (now - a.t0) / DURATION);
        const e = easeOutCubic(t);
        const sNow = lerpScale(a.s0, a.s1, e);
        // Anchor maths uses the unclamped path so the cursor pixel never drifts mid-animation.
        setView(a.toCenter ? clamp({ scale: sNow, x: a.start.x * (1 - e), y: a.start.y * (1 - e) }) : clamp(zoomAt(a.start, sNow, a.anchor)));
        if (t < 1) a.raf = requestAnimationFrame(frame);
        else {
          anim.current = null;
          targetScale.current = null;
          setView(target(a.s1, 1, a.start, a.anchor));
        }
      };
      a.raf = requestAnimationFrame(frame);
    },
    [clamp, fit, limits],
  );

  /** Multiply the zoom; accumulates on the pending target so fast scrolling stays responsive. */
  const zoomBy = useCallback(
    (factor: number, anchor: Point = { x: 0, y: 0 }, animate?: boolean) => {
      const base = targetScale.current ?? viewRef.current?.scale ?? 1;
      zoomTo(base * factor, anchor, animate);
    },
    [zoomTo],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const cur = viewRef.current;
      if (!cur) return;
      stopAnim();
      setMode((m) => (m === "fit" ? "free" : m));
      setView(clamp({ ...cur, x: cur.x + dx, y: cur.y + dy }));
    },
    [clamp],
  );

  /** Toggle between fit and 100% at the given point (double-click behaviour). */
  const toggleFitActual = useCallback(
    (anchor: Point) => {
      const cur = viewRef.current;
      if (!cur) return;
      const a = actual();
      if (mode === "fit" && Math.abs(cur.scale - a) > 1e-3) zoomTo(a, anchor);
      else if (mode === "fit") zoomTo(Math.min(limits().max, a * 2), anchor);
      else if (opts.current.smooth) zoomTo(fit(), { x: 0, y: 0 });
      else applyFit();
    },
    [actual, applyFit, fit, limits, mode, zoomTo],
  );

  const pannable = !!view && !!o.content && (() => {
    const r = o.rotation % 180 === 0 ? o.content : { w: o.content.h, h: o.content.w };
    return r.w * view.scale > o.viewport.w + 0.5 || r.h * view.scale > o.viewport.h + 0.5;
  })();

  return { view, mode, fit: applyFit, actual: (anchor?: Point) => zoomTo(actual(), anchor ?? { x: 0, y: 0 }), zoomBy, zoomTo, panBy, toggleFitActual, pannable };
}
