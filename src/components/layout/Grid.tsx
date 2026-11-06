import { useVirtualizer } from "@tanstack/react-virtual";
import { Folder, FolderOpen, ImageOff, SearchX } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { activeFilterCount } from "../../engines/library";
import { justifiedRows, uniformGrid } from "../../engines/layout";
import { openFolderDialog, openInViewer } from "../../lib/actions";
import type { MediaItem } from "../../lib/types";
import { useLibrary, useVisibleItems } from "../../store/library";
import { GRID_SIZES, useSettings } from "../../store/settings";
import { ContextMenu } from "../ui/menus";
import { Button, Spinner } from "../ui/primitives";
import { itemMenu } from "./itemMenu";
import { Tile } from "./Tile";

const GAP = 8;
const PAD = 16;
const CAPTION = 22;

/** Width of an element that may mount later (callback-ref driven). */
function useWidth(el: HTMLElement | null) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [el]);
  return w;
}

interface Placed {
  item: MediaItem;
  x: number;
  w: number;
  h: number;
}
interface Row {
  top: number;
  height: number;
  cells: Placed[];
}

export function Grid() {
  const visible = useVisibleItems();
  const lib = useLibrary();
  const { gridSize, gridLayout, showFilenames, livePhotoHover } = useSettings((s) => s.settings);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);
  const width = Math.max(0, useWidth(scrollEl) - PAD * 2);
  const dpr = window.devicePixelRatio || 1;
  const target = GRID_SIZES[gridSize];
  const caption = showFilenames ? CAPTION : 0;

  // Layout rows.
  const rows: Row[] = useMemo(() => {
    if (width <= 0) return [];
    if (gridLayout === "justified") {
      const aspects = visible.map((i) => {
        const p = lib.probes.get(i.path);
        return p?.width && p?.height ? p.width / p.height : 4 / 3;
      });
      return justifiedRows(aspects, width, target, GAP, caption).map((r) => {
        let x = 0;
        return {
          top: r.top,
          height: r.height + caption + GAP,
          cells: r.widths.map((w, k) => {
            const cell = { item: visible[r.start + k], x, w, h: r.height };
            x += w + GAP;
            return cell;
          }),
        };
      });
    }
    const g = uniformGrid(width, target, GAP, caption);
    const out: Row[] = [];
    for (let i = 0; i < visible.length; i += g.columns) {
      out.push({
        top: (i / g.columns) * g.rowHeight,
        height: g.rowHeight,
        cells: visible.slice(i, i + g.columns).map((item, k) => ({ item, x: k * (g.tile + GAP), w: g.tile, h: g.tile })),
      });
    }
    return out;
  }, [visible, width, target, gridLayout, caption, lib.probes]);

  const columns = gridLayout === "grid" ? (rows[0]?.cells.length ?? 1) : Math.round(visible.length / Math.max(1, rows.length));
  useEffect(() => {
    useLibrary.setState({ columns: Math.max(1, columns) });
  }, [columns]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => rows[i]?.height ?? target,
    overscan: 3,
    paddingStart: PAD,
    paddingEnd: PAD,
  });
  useEffect(() => virt.measure(), [rows, virt]);

  // Scroll to top when the view changes.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [lib.generation]);

  // Keep the focused item visible (keyboard navigation, returning from the viewer).
  useEffect(() => {
    if (!lib.focused) return;
    const ri = rows.findIndex((r) => r.cells.some((c) => c.item.path === lib.focused));
    if (ri >= 0) virt.scrollToIndex(ri, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.focused]);

  const onPointerSelect = useCallback(
    (e: React.MouseEvent, item: MediaItem) => {
      const mode = e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "single";
      useLibrary.getState().select(item.path, mode, visible);
    },
    [visible],
  );
  const onToggle = useCallback((item: MediaItem) => useLibrary.getState().select(item.path, "toggle", visible), [visible]);
  const onOpen = useCallback((item: MediaItem) => openInViewer(item), []);

  // Right-clicking an unselected tile selects it; the menu then acts on the selection.
  const selectForMenu = (item: MediaItem) => {
    if (!useLibrary.getState().selection.has(item.path)) useLibrary.getState().select(item.path, "single", visible);
  };
  const menuFor = (item: MediaItem) => {
    const sel = useLibrary.getState().selection;
    return itemMenu(item, sel.has(item.path) ? visible.filter((i) => sel.has(i.path)) : [item]);
  };

  if (lib.view.kind === "folder" && lib.status === "error")
    return <Empty icon={<ImageOff className="h-10 w-10" />} title="This folder can’t be opened" detail={lib.error ?? undefined} action={<Button onClick={openFolderDialog}>Open another folder</Button>} />;

  if (visible.length === 0) {
    if (lib.status === "listing")
      return (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted">
          <Spinner /> Scanning…
        </div>
      );
    const filtered = lib.items.some((i) => !i.companion);
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {lib.subfolders.length > 0 && <Subfolders />}
        {filtered ? (
          <Empty
            icon={<SearchX className="h-10 w-10" />}
            title="No matching items"
            detail="Try a different search or clear the filters."
            action={
              (activeFilterCount(lib.filter) > 0 || lib.search) && (
                <Button
                  onClick={() => {
                    lib.resetFilter();
                    lib.setSearch("");
                  }}
                >
                  Clear search & filters
                </Button>
              )
            }
          />
        ) : (
          <Empty
            icon={<FolderOpen className="h-10 w-10" />}
            title={lib.view.kind === "favorites" ? "No favorites yet" : lib.view.kind === "collection" ? "This collection is empty" : lib.view.kind === "recent" ? "Nothing viewed yet" : "No images here"}
            detail={
              lib.view.kind === "favorites"
                ? "Press . or use the star in the viewer to mark favorites."
                : lib.view.kind === "collection"
                  ? "Right-click images and choose Add to collection."
                  : lib.view.kind === "folder"
                    ? "This folder has no supported images or videos."
                    : undefined
            }
            action={lib.view.kind === "folder" && <Button onClick={openFolderDialog}>Open another folder</Button>}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {lib.subfolders.length > 0 && <Subfolders />}
      <div ref={setScroll} className="min-h-0 flex-1 overflow-y-auto outline-none" role="grid" aria-label="Images">
      <div style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map((vr) => {
          const row = rows[vr.index];
          if (!row) return null;
          return (
            <div key={vr.key} style={{ position: "absolute", top: vr.start, left: PAD, right: PAD, height: row.height }}>
              {row.cells.map((c) => (
                <ContextMenu key={c.item.path} onOpen={() => selectForMenu(c.item)} entries={() => menuFor(c.item)}>
                  <div style={{ position: "absolute", left: c.x, top: 0 }}>
                    <Tile
                      item={c.item}
                      probe={lib.probes.get(c.item.path)}
                      width={c.w}
                      height={c.h}
                      fit={gridLayout === "justified" ? "contain" : "cover"}
                      selected={lib.selection.has(c.item.path)}
                      focused={lib.focused === c.item.path}
                      favorite={lib.favorites.has(c.item.path)}
                      showName={showFilenames}
                      generation={lib.generation}
                      dpr={dpr}
                      liveHover={livePhotoHover}
                      onPointerSelect={onPointerSelect}
                      onOpen={onOpen}
                      onToggle={onToggle}
                    />
                  </div>
                </ContextMenu>
              ))}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

function Subfolders() {
  const { subfolders, navigate } = useLibrary();
  return (
    <div className="flex max-h-[28%] shrink-0 flex-wrap gap-2 overflow-y-auto border-b border-line/60 px-4 py-3">
      {subfolders.slice(0, 200).map((f) => (
        <button
          key={f.path}
          onClick={() => navigate({ kind: "folder", path: f.path })}
          className="flex h-8 max-w-[220px] items-center gap-2 rounded-md border border-line bg-panel px-2.5 text-[12px] text-muted transition-colors hover:border-faint hover:text-fg"
          title={f.path}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="truncate">{f.name}</span>
        </button>
      ))}
    </div>
  );
}

function Empty({ icon, title, detail, action }: { icon: React.ReactNode; title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center animate-fade-in">
      <div className="text-faint">{icon}</div>
      <div className="text-[15px] font-semibold">{title}</div>
      {detail && <div className="max-w-sm text-[13px] text-muted">{detail}</div>}
      {action}
    </div>
  );
}
