import { Check, Film, ImageOff, Sparkles, Star, Zap } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/format";
import type { MediaItem, Probe } from "../../lib/types";
import { thumbUrl, videoUrl } from "../../lib/urls";

const BADGE_FORMATS = new Set(["heic", "avif", "jxl", "tiff", "psd", "svg", "svgz", "gif", "webp", "png", "hdr", "exr", "bmp"]);

interface Props {
  item: MediaItem;
  probe?: Probe;
  width: number;
  height: number;
  fit: "cover" | "contain";
  selected: boolean;
  focused: boolean;
  favorite: boolean;
  showName: boolean;
  generation: number;
  dpr: number;
  liveHover: boolean;
  onPointerSelect: (e: React.MouseEvent, item: MediaItem) => void;
  onOpen: (item: MediaItem) => void;
  onToggle: (item: MediaItem) => void;
}

export const Tile = memo(function Tile(p: Props) {
  const { item, probe } = p;
  const [state, setState] = useState<"loading" | "ok" | "retry" | "error">("loading");
  const [playing, setPlaying] = useState(false);
  const hoverTimer = useRef<number>();
  const px = Math.round(Math.max(p.width, p.height) * p.dpr);
  const isVideo = item.kind === "video";
  const src = isVideo ? null : thumbUrl(item.path, px, p.generation, item.modified) + (state === "retry" ? "&r=1" : "");

  useEffect(() => setState("loading"), [item.path, item.modified]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const badge = item.raw ? item.ext.toUpperCase() : BADGE_FORMATS.has(item.format) ? item.ext.toUpperCase() : null;

  return (
    <div
      className="group absolute flex flex-col"
      style={{ width: p.width, height: p.height + (p.showName ? 22 : 0) }}
      onMouseEnter={() => {
        if (item.live && p.liveHover) hoverTimer.current = window.setTimeout(() => setPlaying(true), 350);
      }}
      onMouseLeave={() => {
        window.clearTimeout(hoverTimer.current);
        setPlaying(false);
      }}
    >
      <div
        role="gridcell"
        aria-selected={p.selected}
        data-path={item.path}
        onClick={(e) => p.onPointerSelect(e, item)}
        onDoubleClick={() => p.onOpen(item)}
        className={cn(
          "relative overflow-hidden rounded-lg bg-raised transition-shadow",
          p.selected ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : p.focused ? "ring-1 ring-faint" : "",
        )}
        style={{ width: p.width, height: p.height }}
      >
        {src && state !== "error" && (
          <img
            src={src}
            alt=""
            draggable={false}
            decoding="async"
            onLoad={() => setState("ok")}
            onError={() => setState((s) => (s === "loading" ? "retry" : "error"))}
            className={cn("h-full w-full transition-opacity duration-200", p.fit === "cover" ? "object-cover" : "object-contain", state === "ok" ? "opacity-100" : "opacity-0")}
          />
        )}
        {state === "loading" && !isVideo && <div className="skeleton absolute inset-0" />}
        {(isVideo || state === "error") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-faint">
            {isVideo ? <Film className="h-7 w-7" /> : <ImageOff className="h-7 w-7" />}
            <span className="text-[10px] font-medium uppercase tracking-wide">{isVideo ? item.ext : `${item.ext} · unreadable`}</span>
          </div>
        )}
        {playing && item.live && (
          <video
            src={videoUrl(item.live.video)}
            className="absolute inset-0 h-full w-full object-cover animate-fade-in"
            autoPlay
            muted
            playsInline
            onEnded={() => setPlaying(false)}
            onError={() => setPlaying(false)}
          />
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-1.5">
          <button
            aria-label={p.selected ? "Deselect" : "Select"}
            onClick={(e) => {
              e.stopPropagation();
              p.onToggle(item);
            }}
            className={cn(
              "pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full border transition-opacity",
              p.selected ? "border-accent bg-accent text-white opacity-100" : "border-white/80 bg-black/25 text-transparent opacity-0 group-hover:opacity-100",
            )}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </button>
          <div className="flex gap-1">
            {item.live && (
              <span className="flex items-center gap-0.5 rounded bg-black/55 px-1 py-0.5 text-[9px] font-bold tracking-wide text-white backdrop-blur" title={item.live.verified ? "Live Photo" : "Live Photo (matched by file name)"}>
                <Zap className="h-2.5 w-2.5" fill="currentColor" />
                LIVE
              </span>
            )}
            {probe?.animated && (
              <span className="rounded bg-black/55 p-0.5 text-white backdrop-blur" title="Animated">
                <Sparkles className="h-3 w-3" />
              </span>
            )}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-1.5">
          {badge ? <span className="rounded bg-black/55 px-1 py-px text-[9px] font-semibold tracking-wide text-white/90 backdrop-blur">{badge}</span> : <span />}
          {p.favorite && <Star className="h-3.5 w-3.5 text-amber-400 drop-shadow" fill="currentColor" />}
        </div>
      </div>
      {p.showName && (
        <div className={cn("mt-1 truncate px-0.5 text-center text-[11px] leading-4", p.selected ? "text-fg" : "text-muted")} title={item.name}>
          {item.name}
        </div>
      )}
    </div>
  );
});
