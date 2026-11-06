import { Link2, Link2Off, Table2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clampPan, fitScale, wheelZoomFactor, zoomAt, type Size } from "../../engines/zoomPan";
import { api } from "../../lib/api";
import { basename, cn, formatBytes } from "../../lib/format";
import type { ImageInfo } from "../../lib/types";
import { useLibrary } from "../../store/library";
import { useSettings } from "../../store/settings";
import { useUi } from "../../store/ui";
import { sourcesFor } from "../viewer/ImageStage";
import { IconButton } from "../ui/primitives";

/**
 * Shared view in resolution-independent units: `k` is the zoom relative to
 * each pane's fit scale, and (nx, ny) the pan as a fraction of the rendered
 * image size, so images of different resolutions stay aligned.
 */
interface NormView {
  k: number;
  nx: number;
  ny: number;
}
const START: NormView = { k: 1, nx: 0, ny: 0 };

function Pane({ path, view, onView }: { path: string; view: NormView; onView: (v: NormView) => void }) {
  const item = useLibrary((s) => s.items.find((i) => i.path === path));
  const zoomSpeed = useSettings((s) => s.settings.zoomSpeed);
  const ref = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Size>({ w: 1, h: 1 });
  const [nat, setNat] = useState<Size | null>(null);
  const [src, setSrc] = useState(0);
  const sources = item ? sourcesFor(item) : [];

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = nat ? fitScale(nat, vp) : 1;
  const scale = fit * view.k;
  const px = { scale, x: view.nx * (nat?.w ?? 0) * scale, y: view.ny * (nat?.h ?? 0) * scale };
  const toNorm = useCallback(
    (v: { scale: number; x: number; y: number }): NormView => (nat ? { k: v.scale / fit, nx: v.x / (nat.w * v.scale), ny: v.y / (nat.h * v.scale) } : START),
    [nat, fit],
  );

  const viewRef = useRef({ px, onView, toNorm, nat, vp });
  viewRef.current = { px, onView, toNorm, nat, vp };
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { px, onView, toNorm, nat, vp } = viewRef.current;
      if (!nat) return;
      const r = el.getBoundingClientRect();
      const anchor = { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
      const f = wheelZoomFactor(e, zoomSpeed);
      const ns = Math.min(64, Math.max(fitScale(nat, vp) * 0.5, px.scale * f));
      onView(toNorm(clampPan(zoomAt(px, ns, anchor), nat, vp)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomSpeed]);

  const drag = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      ref={ref}
      className="relative flex-1 cursor-grab overflow-hidden bg-[#111113] active:cursor-grabbing"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current || !nat) return;
        const dx = e.clientX - drag.current.x;
        const dy = e.clientY - drag.current.y;
        drag.current = { x: e.clientX, y: e.clientY };
        onView(toNorm(clampPan({ ...px, x: px.x + dx, y: px.y + dy }, nat, vp)));
      }}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => onView(START)}
    >
      {item && sources[src] && (
        <img
          src={sources[src]}
          alt=""
          draggable={false}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => src + 1 < sources.length && setSrc(src + 1)}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: (nat?.w ?? 0) * scale,
            height: (nat?.h ?? 0) * scale,
            maxWidth: "none",
            transform: `translate(-50%,-50%) translate(${px.x}px, ${px.y}px)`,
            visibility: nat ? "visible" : "hidden",
            imageRendering: scale * devicePixelRatio >= 3 ? "pixelated" : "auto",
          }}
        />
      )}
      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/85 backdrop-blur">
        {basename(path)} {nat && `· ${nat.w}×${nat.h} · ${Math.round(scale * devicePixelRatio * 100)}%`}
      </div>
    </div>
  );
}

const fields: [string, (i: ImageInfo) => string | number | null | undefined][] = [
  ["Dimensions", (i) => (i.width ? `${i.width} × ${i.height}` : null)],
  ["File size", (i) => formatBytes(i.fileSize)],
  ["Format", (i) => i.format],
  ["Camera", (i) => [i.camera.make, i.camera.model].filter(Boolean).join(" ")],
  ["Lens", (i) => i.camera.lens],
  ["Focal length", (i) => (i.camera.focalLength ? `${Math.round(i.camera.focalLength)} mm` : null)],
  ["Aperture", (i) => (i.camera.aperture ? `ƒ/${i.camera.aperture.toFixed(1)}` : null)],
  ["Shutter", (i) => i.camera.exposureTime],
  ["ISO", (i) => i.camera.iso],
  ["Exposure comp.", (i) => (i.camera.exposureCompensation != null ? `${i.camera.exposureCompensation.toFixed(1)} EV` : null)],
  ["Captured", (i) => i.camera.captured],
  ["Color space", (i) => i.colorSpace],
  ["Bit depth", (i) => i.bitDepth],
];

export function Compare() {
  const pair = useUi((s) => s.compare);
  const [linked, setLinked] = useState(true);
  const [views, setViews] = useState<[NormView, NormView]>([START, START]);
  const [showTable, setShowTable] = useState(false);
  const [infos, setInfos] = useState<[ImageInfo | null, ImageInfo | null]>([null, null]);

  useEffect(() => {
    if (!pair) return;
    setViews([START, START]);
    setInfos([null, null]);
    Promise.all(pair.map((p) => api.getImageInfo(p).catch(() => null))).then((r) => setInfos([r[0], r[1]]));
  }, [pair]);

  useEffect(() => {
    if (!pair) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        useUi.setState({ compare: null });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pair]);

  if (!pair) return null;
  const update = (i: 0 | 1) => (v: NormView) => setViews((cur) => (linked ? [v, v] : i === 0 ? [v, cur[1]] : [cur[0], v]));

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white animate-fade-in">
      <div className="flex h-12 items-center gap-2 border-b border-white/10 px-3">
        <span className="flex-1 text-[13px] font-medium">Compare</span>
        <IconButton dark label={linked ? "Zoom & pan synchronised" : "Independent zoom & pan"} active={linked} onClick={() => setLinked(!linked)}>
          {linked ? <Link2 className="h-4 w-4" /> : <Link2Off className="h-4 w-4" />}
        </IconButton>
        <IconButton dark label="Compare details" active={showTable} onClick={() => setShowTable(!showTable)}>
          <Table2 className="h-4 w-4" />
        </IconButton>
        <IconButton dark label="Close" shortcut="Esc" onClick={() => useUi.setState({ compare: null })}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 gap-px bg-white/10">
        <Pane path={pair[0]} view={views[0]} onView={update(0)} />
        <Pane path={pair[1]} view={views[1]} onView={update(1)} />
      </div>
      {showTable && (
        <div className="max-h-[38%] overflow-y-auto border-t border-white/10 bg-[#141416]">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-[#141416] text-left text-white/50">
              <tr>
                <th className="w-40 px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 font-medium">{basename(pair[0])}</th>
                <th className="px-4 py-2 font-medium">{basename(pair[1])}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map(([label, get]) => {
                const a = infos[0] ? get(infos[0]) : null;
                const b = infos[1] ? get(infos[1]) : null;
                if ((a == null || a === "") && (b == null || b === "")) return null;
                const diff = String(a ?? "") !== String(b ?? "");
                return (
                  <tr key={label} className="border-t border-white/5">
                    <td className="px-4 py-1.5 text-white/50">{label}</td>
                    <td className={cn("px-4 py-1.5", diff && "text-amber-200")}>{a ?? "—"}</td>
                    <td className={cn("px-4 py-1.5", diff && "text-amber-200")}>{b ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
