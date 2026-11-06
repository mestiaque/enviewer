import { useRef } from "react";
import { clamp } from "../../lib/format";
import type { Crop } from "../../lib/types";

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const MIN = 0.02;

/** Crop rectangle in normalised coordinates over the (unrotated) image box. */
export function CropOverlay({ crop, onChange }: { crop: Crop | null; onChange: (c: Crop | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const drag = useRef<{ handle: Handle; start: Crop; px: number; py: number } | null>(null);

  const onDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = { handle, start: c, px: e.clientX, py: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const box = ref.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.px) / box.width;
    const dy = (e.clientY - d.py) / box.height;
    let { x, y, w, h } = d.start;
    if (d.handle === "move") {
      x = clamp(x + dx, 0, 1 - w);
      y = clamp(y + dy, 0, 1 - h);
    } else {
      if (d.handle.includes("w")) {
        const nx = clamp(x + dx, 0, x + w - MIN);
        w += x - nx;
        x = nx;
      }
      if (d.handle.includes("e")) w = clamp(w + dx, MIN, 1 - x);
      if (d.handle.includes("n")) {
        const ny = clamp(y + dy, 0, y + h - MIN);
        h += y - ny;
        y = ny;
      }
      if (d.handle.includes("s")) h = clamp(h + dy, MIN, 1 - y);
    }
    const full = x <= 0.001 && y <= 0.001 && w >= 0.999 && h >= 0.999;
    onChange(full ? null : { x, y, w, h });
  };
  const onUp = () => (drag.current = null);

  const pct = (v: number) => `${v * 100}%`;
  const handles: [Handle, string][] = [
    ["nw", "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"],
    ["ne", "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"],
    ["sw", "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"],
    ["se", "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"],
    ["n", "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize"],
    ["s", "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize"],
    ["w", "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize"],
    ["e", "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize"],
  ];

  return (
    <div ref={ref} className="absolute inset-0" onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={(e) => e.stopPropagation()}>
      {/* Dim outside the crop */}
      <div className="pointer-events-none absolute inset-0 bg-black/55" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${pct(c.x)} ${pct(c.y)},${pct(c.x)} ${pct(c.y + c.h)},${pct(c.x + c.w)} ${pct(c.y + c.h)},${pct(c.x + c.w)} ${pct(c.y)},${pct(c.x)} ${pct(c.y)})` }} />
      <div className="absolute cursor-move border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.4)]" style={{ left: pct(c.x), top: pct(c.y), width: pct(c.w), height: pct(c.h) }} onPointerDown={onDown("move")}>
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="border border-white/20" />
          ))}
        </div>
        {handles.map(([h, cls]) => (
          <div key={h} onPointerDown={onDown(h)} className={`absolute h-3.5 w-3.5 rounded-sm border border-black/40 bg-white ${cls}`} />
        ))}
      </div>
    </div>
  );
}
