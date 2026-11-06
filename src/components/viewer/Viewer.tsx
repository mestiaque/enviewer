import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Expand,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Info,
  Maximize,
  Minimize,
  Minus,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Scan,
  SlidersHorizontal,
  Star,
  Undo2,
  Zap,
  Moon,
  Sun,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_EDIT } from "../../engines/editPreview";
import { preloadOrder } from "../../engines/navigation";
import { copyImage, copyPath, renameItem, reveal, startSlideshow, toggleFavorite, trashItems } from "../../lib/actions";
import { api } from "../../lib/api";
import { cn, formatBytes } from "../../lib/format";
import type { EditParams } from "../../lib/types";
import { useLibrary } from "../../store/library";
import { useSettings } from "../../store/settings";
import { useUi } from "../../store/ui";
import { useViewer } from "../../store/viewer";
import { itemMenu } from "../layout/itemMenu";
import { DropdownMenu } from "../ui/menus";
import { thumbUrl } from "../../lib/urls";
import { WindowControls, windowDragProps } from "../ui/WindowControls";
import { IconButton } from "../ui/primitives";
import { EditFilterDefs, EditPanel } from "./EditPanel";
import { ImageStage, sourcesFor, type StageHandle, type ViewTransform } from "./ImageStage";
import { InfoPanel } from "./InfoPanel";
import { VideoPlayer, type VideoHandle } from "./VideoPlayer";

const NO_TRANSFORM: ViewTransform = { rotation: 0, flipH: false, flipV: false };

/** Keep preloaded images referenced so the browser keeps them decoded. */
const preloaded = new Map<string, HTMLImageElement>();

export function Viewer() {
  const { open, list, index, direction, panel, fullscreen, zoomPercent, go, goTo, close, togglePanel, setFullscreen } = useViewer();
  const s = useSettings((st) => st.settings);
  const probes = useLibrary((st) => st.probes);
  const favorites = useLibrary((st) => st.favorites);
  const item = list[index];
  const probe = item ? probes.get(item.path) : undefined;
  const stage = useRef<StageHandle>(null);
  const video = useRef<VideoHandle>(null);
  const [transform, setTransform] = useState<ViewTransform>(NO_TRANSFORM);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [controls, setControls] = useState(true);
  const [livePlaying, setLivePlaying] = useState(false);
  const [savedEdit, setSavedEdit] = useState<EditParams | null>(null);
  const [draftEdit, setDraftEdit] = useState<EditParams | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const hideTimer = useRef<number>();
  const overControls = useRef(false);

  // Per-image state reset.
  useEffect(() => {
    setTransform(NO_TRANSFORM);
    setNatural(null);
    setCropMode(false);
    setDraftEdit(null);
    setSavedEdit(null);
    if (!item || item.kind !== "image") return;
    let alive = true;
    api.getEdit(item.path).then((e) => alive && setSavedEdit(e), () => {});
    return () => {
      alive = false;
    };
  }, [item?.path]);

  useEffect(() => {
    if (panel === "edit") setDraftEdit((d) => d ?? savedEdit ?? DEFAULT_EDIT);
    else {
      setDraftEdit(null);
      setCropMode(false);
    }
  }, [panel, savedEdit]);

  const edit = panel === "edit" ? draftEdit : savedEdit;

  // Preload neighbours.
  useEffect(() => {
    if (!open || !item) return;
    const idx = preloadOrder(index, list.length, s.preloadCount, direction, s.wrapNavigation);
    const keep = new Set<string>();
    for (const i of idx) {
      const it = list[i];
      if (!it || it.kind !== "image") continue;
      const url = sourcesFor(it)[0];
      keep.add(url);
      if (!preloaded.has(url)) {
        const img = new Image();
        img.decoding = "async";
        img.src = url;
        img.decode?.().catch(() => {});
        preloaded.set(url, img);
      }
    }
    for (const k of [...preloaded.keys()]) if (!keep.has(k)) preloaded.delete(k);
  }, [open, index, list, direction, s.preloadCount, s.wrapNavigation, item]);

  // Auto-hide controls.
  const poke = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    if (s.autoHideControls)
      hideTimer.current = window.setTimeout(() => {
        if (!overControls.current) setControls(false);
      }, 2200);
  }, [s.autoHideControls]);
  useEffect(() => {
    if (open) poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [open, index, poke]);

  const rotate = (d: number) => setTransform((t) => ({ ...t, rotation: t.rotation + d }));
  const resetView = () => {
    setTransform(NO_TRANSFORM);
    stage.current?.fit();
  };

  // Keyboard shortcuts.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().dialog || useUi.getState().confirmReq || useUi.getState().promptReq || useUi.getState().slideshow || useUi.getState().compare) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      if (t.closest?.('[role="menu"],[role="dialog"],[role="listbox"]')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      poke();
      let handled = true;
      switch (e.key) {
        case "ArrowLeft":
        case "PageUp":
          go(-1);
          break;
        case "ArrowRight":
        case "PageDown":
          go(1);
          break;
        case "Home":
          goTo(0);
          break;
        case "End":
          goTo(list.length - 1);
          break;
        case "Escape":
          if (cropMode) setCropMode(false);
          else if (fullscreen) setFullscreen(false);
          else close();
          break;
        case "F11":
          setFullscreen(!fullscreen);
          break;
        case " ":
          if (item?.kind === "video") video.current?.togglePlay();
          else stage.current?.togglePlay();
          break;
        case "0":
          if (ctrl) resetView();
          else stage.current?.fit();
          break;
        case "1":
          stage.current?.actual();
          break;
        case "+":
        case "=":
          stage.current?.zoomIn();
          break;
        case "-":
        case "_":
          stage.current?.zoomOut();
          break;
        case "Delete":
          if (item) trashItems([item]);
          break;
        case "F2":
          if (item) renameItem(item);
          break;
        case "F6":
          if (item) startSlideshow(item.path);
          break;
        default:
          handled = false;
      }
      if (!handled && !e.altKey) {
        handled = true;
        switch (e.key.toLowerCase()) {
          case "f":
            if (ctrl) handled = false;
            else setFullscreen(!fullscreen);
            break;
          case "r":
            rotate(e.shiftKey ? -90 : 90);
            break;
          case "l":
            if (item) toggleFavorite([item]);
            break;
          case ".":
            if (item) toggleFavorite([item]);
            break;
          case "h":
            setTransform((t) => ({ ...t, flipH: !t.flipH }));
            break;
          case "v":
            setTransform((t) => ({ ...t, flipV: !t.flipV }));
            break;
          case "i":
            togglePanel("info");
            break;
          case "e":
            if (item?.kind === "image") togglePanel("edit");
            break;
          case "c":
            if (ctrl && item) {
              if (e.shiftKey) copyPath([item]);
              else if (item.kind === "image") copyImage(item);
            } else handled = false;
            break;
          default:
            handled = false;
        }
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, item, list.length, fullscreen, cropMode, go, goTo, close, togglePanel, setFullscreen, poke]);

  // Mouse back/forward buttons.
  useEffect(() => {
    if (!open || !s.mouseSideButtons) return;
    const onUp = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        go(e.button === 3 ? -1 : 1);
      }
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [open, s.mouseSideButtons, go]);

  const isFav = item ? favorites.has(item.path) : false;
  const dims = natural ?? (probe?.width && probe?.height ? { w: probe.width, h: probe.height } : null);
  const canPlay = item?.kind === "image" && (item.live || probe?.animated);
  const menuEntries = useMemo(() => (item ? itemMenu(item, [item], { inViewer: true }) : []), [item, favorites]);

  if (!open || !item) return null;

  const chrome = cn("transition-opacity duration-300", controls || cropMode ? "opacity-100" : "pointer-events-none opacity-0");
  const hoverControls = { onMouseEnter: () => (overControls.current = true), onMouseLeave: () => (overControls.current = false) };

  return (
    <div className={cn("fixed inset-0 z-50 flex overflow-hidden text-vfg animate-fade-in", `vt-${s.viewerTheme}`, !controls && !cropMode && "cursor-none")} onMouseMove={poke}>
      <EditFilterDefs edit={edit} />
      {s.viewerTheme === "glass" && (
        <>
          <div className="viewer-glass-bg" style={{ backgroundImage: item.kind === "image" ? `url("${thumbUrl(item.path, 256, 0, item.modified)}")` : "linear-gradient(135deg,#1e3a8a,#581c87)" }} />
          <div className="absolute inset-0 bg-black/30" />
        </>
      )}
      <div className="relative min-w-0 flex-1">
        {item.kind === "video" ? (
          <VideoPlayer key={item.path} ref={video} item={item} controlsVisible={controls} />
        ) : (
          <ImageStage
            key={item.path}
            ref={stage}
            item={item}
            probe={probe}
            transform={transform}
            edit={edit}
            cropMode={cropMode}
            onCropChange={(crop) => setDraftEdit((d) => ({ ...(d ?? DEFAULT_EDIT), crop }))}
            onNavigate={go}
            onNatural={setNatural}
            onLiveState={setLivePlaying}
          />
        )}

        {/* Top bar */}
        <div className={cn("viewer-topbar absolute inset-x-0 top-0 flex h-14 items-center gap-2 px-3", chrome)} {...hoverControls} {...(fullscreen ? {} : windowDragProps)}>
          <IconButton dark label="Back to library" shortcut="Esc" onClick={close}>
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-medium">{item.name}</span>
              {item.live && (
                <button
                  className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide transition-colors", livePlaying ? "border-amber-300 bg-amber-300/20 text-amber-500" : "border-vfg/40 text-vfg/80 hover:border-white")}
                  onMouseEnter={() => stage.current?.playLive(false)}
                  onClick={() => stage.current?.playLive(true)}
                  title={`Live Photo${item.live.verified ? "" : " (matched by file name)"} · hover to preview, click or Space to play with sound`}
                >
                  <Zap className="h-3 w-3" fill="currentColor" /> LIVE
                </button>
              )}
            </div>
            <div className="truncate text-[11px] text-vfg/55">
              {index + 1} / {list.length}
              {dims && ` · ${dims.w} × ${dims.h}`}
              {` · ${formatBytes(item.size)}`}
              {item.kind === "image" && zoomPercent != null && ` · ${Math.round(zoomPercent)}%`}
              {savedEdit && " · edited"}
            </div>
          </div>
          <IconButton dark label={isFav ? "Unfavorite" : "Favorite"} shortcut="." onClick={() => toggleFavorite([item])}>
            <Star className={cn("h-4 w-4", isFav && "text-amber-400")} fill={isFav ? "currentColor" : "none"} />
          </IconButton>
          <IconButton dark label="Information" shortcut="I" active={panel === "info"} onClick={() => togglePanel("info")}>
            <Info className="h-4 w-4" />
          </IconButton>
          {item.kind === "image" && (
            <IconButton dark label="Edit" shortcut="E" active={panel === "edit"} onClick={() => togglePanel("edit")}>
              <SlidersHorizontal className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton dark label="Slideshow" shortcut="F6" onClick={() => startSlideshow(item.path)}>
            <Play className="h-4 w-4" />
          </IconButton>
          <IconButton dark label="Show in folder" onClick={() => reveal(item)}>
            <FolderOpen className="h-4 w-4" />
          </IconButton>
          <DropdownMenu
            trigger={
              <IconButton dark label="Viewer style">
                {s.viewerTheme === "light" ? <Sun className="h-4 w-4" /> : s.viewerTheme === "glass" ? <Sparkles className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </IconButton>
            }
            entries={[
              { heading: "Viewer style" },
              { label: "Dark", icon: <Moon className="h-3.5 w-3.5" />, checked: s.viewerTheme === "dark", onSelect: () => useSettings.getState().set("viewerTheme", "dark") },
              { label: "Light", icon: <Sun className="h-3.5 w-3.5" />, checked: s.viewerTheme === "light", onSelect: () => useSettings.getState().set("viewerTheme", "light") },
              { label: "Glass", icon: <Sparkles className="h-3.5 w-3.5" />, checked: s.viewerTheme === "glass", onSelect: () => useSettings.getState().set("viewerTheme", "glass") },
            ]}
          />
          <IconButton dark label={fullscreen ? "Exit full screen" : "Full screen"} shortcut="F" onClick={() => setFullscreen(!fullscreen)}>
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </IconButton>
          <DropdownMenu
            trigger={
              <IconButton dark label="More">
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            }
            entries={menuEntries}
          />
          {!fullscreen && <WindowControls dark />}
        </div>

        {/* Side navigation */}
        {list.length > 1 && !cropMode && (
          <>
            <button
              aria-label="Previous image"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(-1)}
              disabled={!s.wrapNavigation && index === 0}
              className={cn("group absolute bottom-24 left-0 top-16 flex w-20 items-center justify-start pl-3 outline-none focus-visible:outline-none disabled:opacity-0", chrome)}
              {...hoverControls}
            >
              <span className="viewer-nav flex h-11 w-11 items-center justify-center rounded-full text-vfg/80 transition-all group-hover:scale-105 group-hover:text-vfg">
                <ChevronLeft className="h-6 w-6" />
              </span>
            </button>
            <button
              aria-label="Next image"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(1)}
              disabled={!s.wrapNavigation && index === list.length - 1}
              className={cn("group absolute bottom-24 right-0 top-16 flex w-20 items-center justify-end pr-3 outline-none focus-visible:outline-none disabled:opacity-0", chrome)}
              {...hoverControls}
            >
              <span className="viewer-nav flex h-11 w-11 items-center justify-center rounded-full text-vfg/80 transition-all group-hover:scale-105 group-hover:text-vfg">
                <ChevronRight className="h-6 w-6" />
              </span>
            </button>
          </>
        )}

        {/* Bottom toolbar */}
        {item.kind === "image" && (
          <div className={cn("absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 viewer-pill rounded-xl p-1", chrome)} {...hoverControls} onPointerDown={(e) => e.stopPropagation()}>
            <IconButton dark side="top" label="Zoom out" shortcut="−" onClick={() => stage.current?.zoomOut()}>
              <Minus className="h-4 w-4" />
            </IconButton>
            <DropdownMenu
              align="center"
              trigger={<button className="h-8 min-w-[58px] rounded-md px-1.5 text-[12px] tabular-nums text-vfg/85 hover:bg-vfg/10">{zoomPercent != null ? `${Math.round(zoomPercent)}%` : "—"}</button>}
              entries={[
                { label: "Fit to screen", shortcut: "0", onSelect: () => stage.current?.fit() },
                { label: "Actual size (100%)", shortcut: "1", onSelect: () => stage.current?.actual() },
                { separator: true },
                ...[25, 50, 200, 400, 800].map((p) => ({ label: `${p}%`, onSelect: () => stage.current?.zoomTo(p) })),
              ]}
            />
            <IconButton dark side="top" label="Zoom in" shortcut="+" onClick={() => stage.current?.zoomIn()}>
              <Plus className="h-4 w-4" />
            </IconButton>
            <div className="mx-1 h-5 w-px bg-vfg/15" />
            <IconButton dark side="top" label="Fit to screen" shortcut="0" onClick={() => stage.current?.fit()}>
              <Expand className="h-4 w-4" />
            </IconButton>
            <IconButton dark side="top" label="Actual size" shortcut="1" onClick={() => stage.current?.actual()}>
              <Scan className="h-4 w-4" />
            </IconButton>
            <div className="mx-1 h-5 w-px bg-vfg/15" />
            <IconButton dark side="top" label="Rotate left" shortcut="Shift+R" onClick={() => rotate(-90)}>
              <RotateCcw className="h-4 w-4" />
            </IconButton>
            <IconButton dark side="top" label="Rotate right" shortcut="R" onClick={() => rotate(90)}>
              <RotateCw className="h-4 w-4" />
            </IconButton>
            <IconButton dark side="top" label="Flip horizontal" shortcut="H" active={transform.flipH} onClick={() => setTransform((t) => ({ ...t, flipH: !t.flipH }))}>
              <FlipHorizontal2 className="h-4 w-4" />
            </IconButton>
            <IconButton dark side="top" label="Flip vertical" shortcut="V" active={transform.flipV} onClick={() => setTransform((t) => ({ ...t, flipV: !t.flipV }))}>
              <FlipVertical2 className="h-4 w-4" />
            </IconButton>
            <IconButton dark side="top" label="Reset view" shortcut="Ctrl+0" onClick={resetView}>
              <Undo2 className="h-4 w-4" />
            </IconButton>
            {canPlay && (
              <>
                <div className="mx-1 h-5 w-px bg-vfg/15" />
                <IconButton dark side="top" label={item.live ? "Play Live Photo" : "Play / pause animation"} shortcut="Space" onClick={() => stage.current?.togglePlay()}>
                  {item.live ? <Zap className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </IconButton>
              </>
            )}
          </div>
        )}
      </div>
      {panel === "info" && <InfoPanel item={item} onClose={() => togglePanel("info")} />}
      {panel === "edit" && item.kind === "image" && draftEdit && (
        <EditPanel item={item} edit={draftEdit} onChange={setDraftEdit} cropMode={cropMode} setCropMode={setCropMode} saved={savedEdit} onSaved={setSavedEdit} onClose={() => togglePanel("edit")} />
      )}
    </div>
  );
}
