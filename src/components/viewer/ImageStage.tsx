import { ExternalLink, FolderOpen, ImageOff } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { cssFilter } from "../../engines/editPreview";
import { wheelZoomFactor, zoomPercent, type Point, type Size } from "../../engines/zoomPan";
import { openExternal, reveal } from "../../lib/actions";
import { cn } from "../../lib/format";
import type { EditParams, MediaItem, Probe } from "../../lib/types";
import { fileUrl, fullUrl, thumbUrl, videoUrl } from "../../lib/urls";
import { useSettings } from "../../store/settings";
import { useViewer } from "../../store/viewer";
import { Button, Spinner } from "../ui/primitives";
import { CropOverlay } from "./CropOverlay";
import { useZoomPan } from "./useZoomPan";

export interface StageHandle {
  fit(): void;
  actual(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomTo(percent: number): void;
  togglePlay(): void;
  playLive(withSound: boolean): void;
}

export interface ViewTransform {
  rotation: number; // degrees, multiple of 90
  flipH: boolean;
  flipV: boolean;
}

interface Props {
  item: MediaItem;
  probe?: Probe;
  transform: ViewTransform;
  edit: EditParams | null;
  cropMode: boolean;
  onCropChange?: (c: EditParams["crop"]) => void;
  onNavigate: (delta: number) => void;
  /** Report the natural size once known (used by the info bar). */
  onNatural?: (s: Size) => void;
  onLiveState?: (playing: boolean) => void;
}

/** Ordered source candidates: original bytes first when the webview can decode them. */
export function sourcesFor(item: MediaItem): string[] {
  return item.webviewNative ? [fileUrl(item.path, item.modified), fullUrl(item.path, item.modified)] : [fullUrl(item.path, item.modified)];
}

export const ImageStage = forwardRef<StageHandle, Props>(function ImageStage({ item, probe, transform, edit, cropMode, onCropChange, onNavigate, onNatural, onLiveState }, ref) {
  const s = useSettings((st) => st.settings);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [viewport, setViewport] = useState<Size>({ w: 1, h: 1 });
  const [natural, setNatural] = useState<Size | null>(probe?.width && probe?.height ? { w: probe.width, h: probe.height } : null);
  const sources = useRef(sourcesFor(item));
  const [srcIndex, setSrcIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState<null | "muted" | "sound">(null);
  const dpr = window.devicePixelRatio || 1;

  // Effective geometry: crop (in original orientation) → rotate → flip.
  const crop = !cropMode && edit?.crop ? edit.crop : null;
  // Crop mode shows the original orientation so the crop box maps 1:1 to pixels.
  const rotation = cropMode ? 0 : transform.rotation + (edit?.rotate ?? 0) * 90;
  const flipH = !cropMode && transform.flipH !== !!edit?.flipH;
  const flipV = !cropMode && transform.flipV !== !!edit?.flipV;
  const content: Size | null = natural ? (crop ? { w: natural.w * crop.w, h: natural.h * crop.h } : natural) : null;

  const zp = useZoomPan({
    content,
    viewport,
    rotation,
    dpr,
    minPercent: s.minZoom,
    maxPercent: s.maxZoom,
    smooth: s.smoothZoom && s.animations,
    initial: s.defaultZoom,
  });

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (zp.view) useViewer.setState({ zoomPercent: zoomPercent(zp.view.scale, dpr) });
  }, [zp.view, dpr]);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 250);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => onLiveState?.(live !== null), [live, onLiveState]);

  const anchorOf = (e: { clientX: number; clientY: number }): Point => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };

  const step = s.zoomSpeed;
  useImperativeHandle(ref, () => ({
    fit: zp.fit,
    actual: () => zp.actual(),
    zoomIn: () => zp.zoomBy(1 + step),
    zoomOut: () => zp.zoomBy(1 / (1 + step)),
    zoomTo: (pct: number) => zp.zoomTo(pct / 100 / dpr),
    togglePlay() {
      if (probe?.animated) return togglePause();
      if (item.live) setLive((l) => (l ? null : "sound"));
    },
    playLive(withSound) {
      if (item.live) setLive(withSound ? "sound" : "muted");
    },
  }));

  const togglePause = () => {
    if (!paused) {
      const img = imgRef.current;
      const c = canvasRef.current;
      if (img && c) {
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d")?.drawImage(img, 0, 0);
      }
    }
    setPaused((p) => !p);
  };

  // Wheel: vertical = zoom at cursor; horizontal (touchpad swipe) = pan or navigate.
  const swipe = useRef({ acc: 0, last: 0, cooldown: 0 });
  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (cropMode) return;
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2 && !e.ctrlKey;
      if (horizontal) {
        if (zp.pannable) return zp.panBy(-e.deltaX, 0);
        if (!s.touchpadSwipe) return;
        const now = performance.now();
        const sw = swipe.current;
        if (now < sw.cooldown) return;
        if (now - sw.last > 250) sw.acc = 0;
        sw.last = now;
        sw.acc += e.deltaX;
        if (Math.abs(sw.acc) > 140) {
          onNavigate(sw.acc > 0 ? 1 : -1);
          sw.acc = 0;
          sw.cooldown = now + 450;
        }
        return;
      }
      if (e.deltaY === 0) return;
      const pinch = e.ctrlKey && Math.abs(e.deltaY) < 50;
      zp.zoomBy(wheelZoomFactor(e, step), anchorOf(e), pinch ? false : undefined);
    },
    [cropMode, zp, s.touchpadSwipe, step, onNavigate],
  );
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  // Drag to pan (left or middle button).
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (cropMode || (e.button !== 0 && e.button !== 1)) return;
    if (e.button === 1) e.preventDefault();
    if (!zp.pannable && e.button === 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    zp.panBy(e.clientX - d.x, e.clientY - d.y);
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const onImgError = async () => {
    if (srcIndex + 1 < sources.current.length) {
      setSrcIndex(srcIndex + 1);
      return;
    }
    // Ask the backend why it failed, for a useful error message.
    try {
      const r = await fetch(sources.current[srcIndex]);
      setError(r.ok ? "The image data could not be displayed." : await r.text());
    } catch {
      setError("The image could not be loaded.");
    }
  };

  const onImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const n = { w: img.naturalWidth || 1024, h: img.naturalHeight || 1024 };
    setNatural((prev) => (prev && prev.w === n.w && prev.h === n.h ? prev : n));
    onNatural?.(n);
    setLoaded(true);
  };

  const v = zp.view;
  const sc = v?.scale ?? 0;
  const pixelated = s.pixelatedZoom && sc * dpr >= 3;
  // Light and glass viewer styles provide their own backdrop; the background setting applies to the dark style.
  const bg = s.viewerTheme !== "dark" ? "bg-transparent" : { black: "bg-black", dark: "bg-[#111113]", gray: "bg-[#2b2b2f]", checker: "checker", theme: "bg-bg" }[s.viewerBackground];
  const box = content && v ? { w: content.w * sc, h: content.h * sc } : null;
  const imgStyle: React.CSSProperties | undefined =
    natural && v
      ? {
          position: "absolute",
          width: natural.w * sc,
          height: natural.h * sc,
          left: -(crop?.x ?? 0) * natural.w * sc,
          top: -(crop?.y ?? 0) * natural.h * sc,
          maxWidth: "none",
          imageRendering: pixelated ? "pixelated" : "auto",
          filter: edit ? cssFilter(edit) : undefined,
        }
      : undefined;

  return (
    <div
      ref={stageRef}
      className={cn("absolute inset-0 overflow-hidden", bg, dragging ? "cursor-grabbing" : zp.pannable && !cropMode ? "cursor-grab" : "cursor-default")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(e) => !cropMode && zp.toggleFitActual(anchorOf(e))}
      onAuxClick={(e) => e.button === 1 && e.preventDefault()}
    >
      {/* Low-res placeholder while the full image decodes. */}
      {!loaded && !error && (
        <img
          src={thumbUrl(item.path, 768, 0, item.modified)}
          alt=""
          draggable={false}
          className="absolute left-1/2 top-1/2 max-h-[85%] max-w-[85%] -translate-x-1/2 -translate-y-1/2 object-contain opacity-60 blur-[1px]"
          style={box ? { width: box.w, height: box.h, maxWidth: "none", maxHeight: "none", objectFit: "fill" } : undefined}
        />
      )}
      {!error && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: box?.w ?? 0,
            height: box?.h ?? 0,
            transform: `translate(-50%, -50%) translate(${v?.x ?? 0}px, ${v?.y ?? 0}px) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1}) rotate(${rotation}deg)`,
            visibility: loaded && box ? "visible" : "hidden",
          }}
        >
          <div className="relative h-full w-full overflow-hidden">
            <img key={srcIndex} ref={imgRef} src={sources.current[srcIndex]} alt={item.name} draggable={false} decoding="async" onLoad={onImgLoad} onError={onImgError} style={imgStyle} />
            {probe?.animated && <canvas ref={canvasRef} style={{ ...imgStyle, display: paused ? "block" : "none" }} />}
            {live && item.live && (
              <video
                ref={videoRef}
                src={videoUrl(item.live.video)}
                autoPlay
                playsInline
                muted={live === "muted"}
                onEnded={() => setLive(null)}
                onError={() => setLive(null)}
                className="animate-fade-in"
                style={{ ...imgStyle, objectFit: "cover", filter: imgStyle?.filter }}
              />
            )}
          </div>
          {cropMode && natural && onCropChange && <CropOverlay crop={edit?.crop ?? null} onChange={onCropChange} />}
        </div>
      )}

      {!loaded && !error && slow && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-2 viewer-pill rounded-full px-3 py-1.5 text-xs text-vfg/90">
          <Spinner className="h-3.5 w-3.5" /> {item.webviewNative && srcIndex === 0 ? "Loading…" : `Decoding ${item.ext.toUpperCase()}…`}
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-vfg/90">
          <ImageOff className="h-12 w-12 text-vfg/40" />
          <div className="text-[15px] font-semibold">Can’t display {item.name}</div>
          <div className="max-w-md whitespace-pre-line text-[13px] text-vfg/60">{error}</div>
          <div className="mt-2 flex gap-2">
            <Button variant="subtle" onClick={() => openExternal(item)}>
              <ExternalLink className="h-4 w-4" /> Open with default app
            </Button>
            <Button variant="subtle" onClick={() => reveal(item)}>
              <FolderOpen className="h-4 w-4" /> Show in folder
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});
