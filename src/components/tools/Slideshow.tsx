import { ChevronLeft, ChevronRight, Pause, Play, Repeat, Shuffle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { randomEffect, shuffledOrder, type Effect } from "../../engines/navigation";
import { cn } from "../../lib/format";
import { useLibrary } from "../../store/library";
import { useSettings } from "../../store/settings";
import { useUi } from "../../store/ui";
import { useViewer } from "../../store/viewer";
import { sourcesFor } from "../viewer/ImageStage";
import { IconButton, Select } from "../ui/primitives";

/** Longest transition below, in milliseconds. */
const TRANSITION_MS = 900;

export function Slideshow() {
  const show = useUi((s) => s.slideshow);
  const { settings: s, set } = useSettings();
  const settingsRef = useRef(s);
  settingsRef.current = s;
  const items = useLibrary((st) => st.items);
  const byPath = useMemo(() => new Map(items.map((i) => [i.path, i])), [items]);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [controls, setControls] = useState(true);
  const [layers, setLayers] = useState<{ key: number; src: string; effect: Effect }[]>([]);
  const keyRef = useRef(0);
  const hideTimer = useRef<number>();

  const order = useMemo(() => {
    if (!show) return [];
    return s.slideshowRandom ? shuffledOrder(show.paths.length, show.start) : show.paths.map((_, i) => i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, s.slideshowRandom]);

  useEffect(() => {
    if (!show) return;
    setPos(s.slideshowRandom ? 0 : show.start);
    setPlaying(true);
    const wasFullscreen = useViewer.getState().fullscreen;
    useViewer.getState().setFullscreen(true);
    return () => {
      if (!wasFullscreen) useViewer.getState().setFullscreen(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const exit = useCallback(() => useUi.setState({ slideshow: null }), []);
  const advance = useCallback(
    (d: number) => {
      setPos((p) => {
        const n = p + d;
        if (n >= order.length) {
          if (!s.slideshowLoop) {
            setPlaying(false);
            return p;
          }
          return 0;
        }
        return n < 0 ? order.length - 1 : n;
      });
    },
    [order.length, s.slideshowLoop],
  );

  const path = show ? show.paths[order[pos]] : null;
  const item = path ? byPath.get(path) : undefined;

  // Swap layers for transitions once the next image has loaded.
  useEffect(() => {
    if (!item) return;
    const src = sourcesFor(item)[item.webviewNative ? 0 : 0];
    const img = new Image();
    let cancelled = false;
    const commit = (url: string) => {
      if (cancelled) return;
      keyRef.current += 1;
      const tr = settingsRef.current.animations ? settingsRef.current.slideshowTransition : "none";
      // "Random" picks a different effect for every slide (never the same twice in a row).
      setLayers((l) => {
        const effect = tr === "random" ? randomEffect(l[l.length - 1]?.effect) : tr;
        const layer = { key: keyRef.current, src: url, effect };
        return effect === "none" ? [layer] : [...l.slice(-1), layer];
      });
    };
    img.onload = () => commit(src);
    img.onerror = () => {
      const fb = sourcesFor(item)[1];
      if (fb) commit(fb);
      else commit(src);
    };
    img.src = src;
    // Preload the next one.
    const nextPath = show!.paths[order[(pos + 1) % order.length]];
    const next = nextPath ? byPath.get(nextPath) : undefined;
    if (next) new Image().src = sourcesFor(next)[0];
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.path]);

  // Drop the outgoing image after the transition, or it stays visible behind
  // transparent images.
  useEffect(() => {
    if (layers.length < 2) return;
    const t = window.setTimeout(() => setLayers((l) => l.slice(-1)), TRANSITION_MS);
    return () => window.clearTimeout(t);
  }, [layers]);

  useEffect(() => {
    if (!show || !playing) return;
    const t = window.setTimeout(() => advance(1), s.slideshowInterval * 1000);
    return () => window.clearTimeout(t);
  }, [show, playing, pos, s.slideshowInterval, advance, layers]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      const h: Record<string, () => void> = {
        Escape: exit,
        " ": () => setPlaying((p) => !p),
        ArrowRight: () => advance(1),
        ArrowLeft: () => advance(-1),
      };
      const f = h[e.key];
      if (f) {
        e.preventDefault();
        e.stopPropagation();
        f();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [show, exit, advance]);

  const poke = () => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControls(false), 2000);
  };

  if (!show) return null;

  return (
    <div className={cn("fixed inset-0 z-[70] bg-black", !controls && "cursor-none")} onMouseMove={poke} onClick={() => setPlaying((p) => !p)}>
      <style>{`
        @keyframes ss-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ss-slide { from { opacity: 0; transform: translateX(6%) } to { opacity: 1; transform: none } }
        @keyframes ss-zoom { from { opacity: 0; transform: scale(1.06) } to { opacity: 1; transform: none } }
        .slideshow-fade { animation: ss-fade .8s ease both }
        .slideshow-slide { animation: ss-slide .7s cubic-bezier(.2,.8,.2,1) both }
        .slideshow-zoom { animation: ss-zoom .9s ease both }
        @keyframes ss-slide-up { from { opacity: 0; transform: translateY(6%) } to { opacity: 1; transform: none } }
        @keyframes ss-blur { from { opacity: 0; filter: blur(24px); transform: scale(1.02) } to { opacity: 1; filter: blur(0); transform: none } }
        .slideshow-slideUp { animation: ss-slide-up .7s cubic-bezier(.2,.8,.2,1) both }
        .slideshow-blur { animation: ss-blur .9s ease both }
        @keyframes ss-out { from { opacity: 1 } to { opacity: 0 } }
        .slideshow-out { animation: ss-out .7s ease both }
      `}</style>
      {layers.map((l, i) => (
        <img key={l.key} src={l.src} alt="" className={cn("absolute inset-0 h-full w-full object-contain", i < layers.length - 1 ? "slideshow-out" : l.effect !== "none" && `slideshow-${l.effect}`)} draggable={false} />
      ))}
      <div
        className={cn(
          "absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-black/70 p-1.5 text-white backdrop-blur transition-opacity",
          controls ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <IconButton dark side="top" label="Previous" shortcut="←" onClick={() => advance(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <IconButton dark side="top" label={playing ? "Pause" : "Play"} shortcut="Space" onClick={() => setPlaying(!playing)}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </IconButton>
        <IconButton dark side="top" label="Next" shortcut="→" onClick={() => advance(1)}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
        <span className="mx-2 text-[11px] tabular-nums text-white/60">
          {pos + 1} / {order.length}
        </span>
        <Select
          className="h-7 border-white/15 bg-white/5 text-xs text-white"
          value={s.slideshowInterval}
          onChange={(v) => set("slideshowInterval", v)}
          options={[2, 3, 4, 6, 8, 12, 20].map((n) => ({ value: n, label: `${n} s` }))}
        />
        <Select
          className="h-7 border-white/15 bg-white/5 text-xs text-white"
          value={s.slideshowTransition}
          onChange={(v) => set("slideshowTransition", v)}
          options={[
            { value: "random", label: "Random" },
            { value: "fade", label: "Fade" },
            { value: "slide", label: "Slide" },
            { value: "slideUp", label: "Slide up" },
            { value: "zoom", label: "Zoom" },
            { value: "blur", label: "Blur" },
            { value: "none", label: "None" },
          ]}
        />
        <IconButton dark side="top" label="Loop" active={s.slideshowLoop} onClick={() => set("slideshowLoop", !s.slideshowLoop)}>
          <Repeat className="h-4 w-4" />
        </IconButton>
        <IconButton dark side="top" label="Random order" active={s.slideshowRandom} onClick={() => set("slideshowRandom", !s.slideshowRandom)}>
          <Shuffle className="h-4 w-4" />
        </IconButton>
        <IconButton dark side="top" label="Exit slideshow" shortcut="Esc" onClick={exit}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
