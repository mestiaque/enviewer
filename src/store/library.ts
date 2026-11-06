import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { EMPTY_FILTER, computeVisible, type Filter, type SortDir, type SortKey } from "../engines/library";
import { api, errorMessage } from "../lib/api";
import type { Collection, FormatCapability, MediaItem, PinnedFolder, Probe, RecentEntry, ScanEvent, ScanSummary, StandardFolder, SubFolder } from "../lib/types";
import { useSettings } from "./settings";

export type View =
  | { kind: "home" }
  | { kind: "folder"; path: string }
  | { kind: "favorites" }
  | { kind: "recent" }
  | { kind: "collection"; id: number; name: string };

export const viewKey = (v: View) => (v.kind === "folder" ? `folder:${v.path}` : v.kind === "collection" ? `collection:${v.id}` : v.kind);

export type Status = "idle" | "listing" | "probing" | "ready" | "error";

interface LibraryStore {
  view: View;
  history: View[];
  historyIndex: number;
  items: MediaItem[];
  probes: Map<string, Probe>;
  status: Status;
  error: string | null;
  summary: ScanSummary | null;
  probed: number;
  generation: number;
  subfolders: SubFolder[];
  sortKey: SortKey;
  sortDir: SortDir;
  filter: Filter;
  search: string;
  selection: Set<string>;
  anchor: string | null;
  focused: string | null;
  favorites: Set<string>;
  collections: Collection[];
  pinned: PinnedFolder[];
  standard: StandardFolder[];
  recentFolders: RecentEntry[];
  formats: FormatCapability[];
  heifVersion: string | null;
  columns: number;

  init(): Promise<void>;
  navigate(view: View, push?: boolean): Promise<void>;
  back(): void;
  forward(): void;
  refresh(): void;
  setSort(key: SortKey, dir?: SortDir): void;
  setFilter(f: Partial<Filter>): void;
  resetFilter(): void;
  setSearch(s: string): void;
  select(path: string, mode: "single" | "toggle" | "range", visible: MediaItem[]): void;
  setSelection(paths: string[]): void;
  clearSelection(): void;
  setFocused(path: string | null): void;
  setFavorite(paths: string[], fav: boolean): Promise<void>;
  refreshCollections(): Promise<void>;
  refreshPinned(): Promise<void>;
  refreshRecentFolders(): Promise<void>;
  removePaths(paths: string[]): void;
  replacePath(from: string, to: string): void;
}

export const useLibrary = create<LibraryStore>((set, get) => ({
  view: { kind: "home" },
  history: [{ kind: "home" }],
  historyIndex: 0,
  items: [],
  probes: new Map(),
  status: "idle",
  error: null,
  summary: null,
  probed: 0,
  generation: 1,
  subfolders: [],
  sortKey: "name",
  sortDir: "asc",
  filter: EMPTY_FILTER,
  search: "",
  selection: new Set(),
  anchor: null,
  focused: null,
  favorites: new Set(),
  collections: [],
  pinned: [],
  standard: [],
  recentFolders: [],
  formats: [],
  heifVersion: null,
  columns: 1,

  async init() {
    const [favs, formats, standard] = await Promise.all([api.getFavorites(), api.getFormats(), api.standardFolders()]);
    set({ favorites: new Set(favs), formats: formats.formats, heifVersion: formats.heifVersion, standard });
    await Promise.all([get().refreshCollections(), get().refreshPinned(), get().refreshRecentFolders()]);
  },

  async navigate(view, push = true) {
    const st = get();
    if (push) {
      const history = st.history.slice(0, st.historyIndex + 1);
      if (viewKey(history[history.length - 1]) !== viewKey(view)) history.push(view);
      set({ history: history.slice(-100), historyIndex: Math.min(history.length, 100) - 1 });
    }
    const generation = st.generation + 1;
    api.setThumbGeneration(generation).catch(() => {});
    set({
      view,
      generation,
      items: [],
      probes: new Map(),
      status: view.kind === "home" ? "idle" : "listing",
      error: null,
      summary: null,
      probed: 0,
      selection: new Set(),
      anchor: null,
      focused: null,
      subfolders: [],
    });

    const onEvent = (e: ScanEvent) => {
      if (get().generation !== generation) return;
      switch (e.type) {
        case "items":
          set({ items: get().items.concat(e.items) });
          break;
        case "listed":
          set({ summary: e.summary, status: "probing" });
          break;
        case "probes": {
          const probes = new Map(get().probes);
          for (const p of e.probes) probes.set(p.path, p);
          set({ probes, probed: get().probed + e.probes.length });
          break;
        }
        case "done":
          set({ status: "ready" });
          break;
        case "error":
          set({ status: "error", error: e.message });
          break;
      }
    };

    try {
      const settings = useSettings.getState();
      switch (view.kind) {
        case "home":
          api.cancelScan().catch(() => {});
          get().refreshRecentFolders();
          return;
        case "folder":
          await api.scanFolder(view.path, settings.settings.showHidden, onEvent);
          api.listSubfolders(view.path, settings.settings.showHidden).then((subfolders) => {
            if (get().generation === generation) set({ subfolders });
          }, () => {});
          api.addRecent(view.path, "folder").then(() => get().refreshRecentFolders()).catch(() => {});
          if (settings.settings.rememberLastFolder) settings.set("lastFolder", view.path);
          return;
        case "favorites":
          await api.loadItems(await api.getFavorites(), onEvent);
          return;
        case "recent":
          await api.loadItems((await api.getRecents("file", 500)).map((r) => r.path), onEvent);
          return;
        case "collection":
          await api.loadItems(await api.collectionItems(view.id), onEvent);
          return;
      }
    } catch (e) {
      if (get().generation === generation) set({ status: "error", error: errorMessage(e) });
    }
  },

  back() {
    const { historyIndex, history } = get();
    if (historyIndex > 0) {
      set({ historyIndex: historyIndex - 1 });
      get().navigate(history[historyIndex - 1], false);
    }
  },
  forward() {
    const { historyIndex, history } = get();
    if (historyIndex < history.length - 1) {
      set({ historyIndex: historyIndex + 1 });
      get().navigate(history[historyIndex + 1], false);
    }
  },
  refresh() {
    get().navigate(get().view, false);
  },

  setSort(key, dir) {
    const cur = get();
    const defaultDir: SortDir = key === "name" || key === "type" ? "asc" : "desc";
    set({ sortKey: key, sortDir: dir ?? (cur.sortKey === key ? (cur.sortDir === "asc" ? "desc" : "asc") : defaultDir) });
  },
  setFilter(f) {
    set({ filter: { ...get().filter, ...f } });
  },
  resetFilter() {
    set({ filter: EMPTY_FILTER });
  },
  setSearch(search) {
    set({ search });
  },

  select(path, mode, visible) {
    const { selection, anchor } = get();
    if (mode === "single") {
      set({ selection: new Set([path]), anchor: path, focused: path });
    } else if (mode === "toggle") {
      const next = new Set(selection);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      set({ selection: next, anchor: path, focused: path });
    } else {
      const a = visible.findIndex((i) => i.path === (anchor ?? path));
      const b = visible.findIndex((i) => i.path === path);
      if (a < 0 || b < 0) return get().select(path, "single", visible);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      set({ selection: new Set(visible.slice(lo, hi + 1).map((i) => i.path)), focused: path });
    }
  },
  setSelection(paths) {
    set({ selection: new Set(paths) });
  },
  clearSelection() {
    set({ selection: new Set() });
  },
  setFocused(focused) {
    set({ focused });
  },

  async setFavorite(paths, fav) {
    const favorites = new Set(get().favorites);
    for (const p of paths) {
      if (fav) favorites.add(p);
      else favorites.delete(p);
    }
    set({ favorites });
    await api.setFavorite(paths, fav);
  },
  async refreshCollections() {
    set({ collections: await api.listCollections() });
  },
  async refreshPinned() {
    set({ pinned: await api.getPinnedFolders() });
  },
  async refreshRecentFolders() {
    set({ recentFolders: await api.getRecents("folder", 12) });
  },

  removePaths(paths) {
    const gone = new Set(paths);
    const selection = new Set([...get().selection].filter((p) => !gone.has(p)));
    set({ items: get().items.filter((i) => !gone.has(i.path)), selection });
  },
  replacePath(from, to) {
    const name = to.slice(Math.max(to.lastIndexOf("/"), to.lastIndexOf("\\")) + 1);
    set({
      items: get().items.map((i) => (i.path === from ? { ...i, path: to, name } : i)),
      favorites: new Set([...get().favorites].map((p) => (p === from ? to : p))),
    });
  },
}));

/** The filtered + sorted list shown in the grid. */
export function useVisibleItems(): MediaItem[] {
  const { items, probes, search, filter, favorites, sortKey, sortDir, formats } = useLibrary(
    useShallow((s) => ({ items: s.items, probes: s.probes, search: s.search, filter: s.filter, favorites: s.favorites, sortKey: s.sortKey, sortDir: s.sortDir, formats: s.formats })),
  );
  const disabled = useSettings((s) => s.settings.disabledFormats);
  return useMemo(() => {
    const enabled = disabled.length ? items.filter((i) => !disabled.includes(i.format)) : items;
    return computeVisible(enabled, probes, search, filter, favorites, sortKey, sortDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, probes, search, filter, favorites, sortKey, sortDir, disabled, formats]);
}

export const visibleSnapshot = () => {
  const s = useLibrary.getState();
  const disabled = useSettings.getState().settings.disabledFormats;
  const enabled = disabled.length ? s.items.filter((i) => !disabled.includes(i.format)) : s.items;
  return computeVisible(enabled, s.probes, s.search, s.filter, s.favorites, s.sortKey, s.sortDir);
};
