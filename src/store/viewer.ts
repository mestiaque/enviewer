import { getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";
import { step } from "../engines/navigation";
import { api } from "../lib/api";
import type { MediaItem } from "../lib/types";
import { useSettings } from "./settings";

interface ViewerStore {
  open: boolean;
  /** Snapshot of the visible list when the viewer opened (stable order while viewing). */
  list: MediaItem[];
  index: number;
  direction: 1 | -1;
  panel: null | "info" | "edit";
  fullscreen: boolean;
  /** Zoom % shown in the status bar. */
  zoomPercent: number | null;
  openAt(list: MediaItem[], index: number): void;
  close(): void;
  go(delta: number): void;
  goTo(index: number): void;
  togglePanel(p: "info" | "edit"): void;
  setFullscreen(on: boolean): Promise<void>;
  remove(paths: string[]): void;
  replace(from: string, to: string): void;
}

export const useViewer = create<ViewerStore>((set, get) => ({
  open: false,
  list: [],
  index: 0,
  direction: 1,
  panel: null,
  fullscreen: false,
  zoomPercent: null,
  openAt(list, index) {
    set({ open: true, list, index, direction: 1 });
    const it = list[index];
    if (it) api.addRecent(it.path, "file").catch(() => {});
  },
  close() {
    set({ open: false, panel: get().panel === "edit" ? null : get().panel, zoomPercent: null });
    if (get().fullscreen) get().setFullscreen(false);
  },
  go(delta) {
    const { index, list } = get();
    const next = step(index, delta, list.length, useSettings.getState().settings.wrapNavigation);
    if (next !== index && next >= 0) get().goTo(next);
    set({ direction: delta >= 0 ? 1 : -1 });
  },
  goTo(index) {
    const it = get().list[index];
    if (!it) return;
    set({ index, direction: index >= get().index ? 1 : -1, panel: get().panel === "edit" ? null : get().panel });
    api.addRecent(it.path, "file").catch(() => {});
  },
  togglePanel(p) {
    set({ panel: get().panel === p ? null : p });
  },
  async setFullscreen(on) {
    try {
      await getCurrentWindow().setFullscreen(on);
      set({ fullscreen: on });
    } catch (e) {
      console.error(e);
    }
  },
  remove(paths) {
    const gone = new Set(paths);
    const { list, index } = get();
    const current = list[index];
    const next = list.filter((i) => !gone.has(i.path));
    if (next.length === 0) {
      set({ list: next });
      get().close();
      return;
    }
    let ni = current && !gone.has(current.path) ? next.indexOf(current) : Math.min(index, next.length - 1);
    if (ni < 0) ni = 0;
    set({ list: next, index: ni });
  },
  replace(from, to) {
    const name = to.slice(Math.max(to.lastIndexOf("/"), to.lastIndexOf("\\")) + 1);
    set({ list: get().list.map((i) => (i.path === from ? { ...i, path: to, name } : i)) });
  },
}));
