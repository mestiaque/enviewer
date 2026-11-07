import * as Tooltip from "@radix-ui/react-tooltip";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { BatchDialog } from "./components/tools/BatchDialog";
import { Compare } from "./components/tools/Compare";
import { OrganizeDialog } from "./components/tools/OrganizeDialog";
import { Slideshow } from "./components/tools/Slideshow";
import { Grid } from "./components/layout/Grid";
import { HomeView } from "./components/layout/Home";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { Toolbar } from "./components/layout/Toolbar";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { UpdateDialog } from "./components/update/UpdateDialog";
import { scheduleUpdateCheck } from "./store/update";
import { ShortcutsDialog } from "./components/settings/ShortcutsDialog";
import { ConfirmHost, PromptHost, Toaster } from "./components/ui/overlays";
import { Viewer } from "./components/viewer/Viewer";
import { copyImage, copyPath, openFileDialog, openFolderDialog, openInViewer, openPath, renameItem, selectedItems, startSlideshow, toggleFavorite, trashItems } from "./lib/actions";
import { api } from "./lib/api";
import { dirname } from "./lib/format";
import { setMediaBase } from "./lib/urls";
import { useLibrary, visibleSnapshot } from "./store/library";
import { useSettings } from "./store/settings";
import { toast, useUi } from "./store/ui";
import { useViewer } from "./store/viewer";

function hexToRgb(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : "59 130 246";
}

function useTheme() {
  const theme = useSettings((s) => s.settings.theme);
  const accent = useSettings((s) => s.settings.accent);
  const animations = useSettings((s) => s.settings.animations);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || theme === "glass" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
      document.documentElement.classList.toggle("glass", theme === "glass");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", hexToRgb(accent));
  }, [accent]);
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", !animations);
  }, [animations]);
}

/** Keyboard handling for the library (the viewer installs its own handler). */
function useLibraryKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (useViewer.getState().open || ui.dialog || ui.confirmReq || ui.promptReq || ui.slideshow || ui.compare) return;
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      // Keys inside open menus / dialogs belong to them.
      if (t.closest?.('[role="menu"],[role="dialog"],[role="listbox"]')) return;
      const lib = useLibrary.getState();
      const settings = useSettings.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key;
      const visible = () => visibleSnapshot();
      const focusedItem = () => visible().find((i) => i.path === lib.focused);
      const targets = () => {
        const sel = selectedItems();
        const f = focusedItem();
        return sel.length ? sel : f ? [f] : [];
      };
      const move = (delta: number, extend: boolean) => {
        const v = visible();
        if (!v.length) return;
        const cur = v.findIndex((i) => i.path === lib.focused);
        const next = cur < 0 ? 0 : Math.min(v.length - 1, Math.max(0, cur + delta));
        lib.select(v[next].path, extend ? "range" : "single", v);
      };
      let handled = true;
      if (ctrl && key.toLowerCase() === "o") e.shiftKey ? openFileDialog() : openFolderDialog();
      else if (ctrl && key.toLowerCase() === "b") settings.set("sidebarCollapsed", !settings.settings.sidebarCollapsed);
      else if (ctrl && key === ",") ui.openDialog("settings");
      else if (key === "?") ui.openDialog("shortcuts");
      else if (key === "F5") lib.refresh();
      else if (key === "F6") startSlideshow(lib.focused ?? undefined);
      else if (e.altKey && key === "ArrowLeft") lib.back();
      else if (e.altKey && key === "ArrowRight") lib.forward();
      else if ((e.altKey && key === "ArrowUp") || key === "Backspace") {
        if (lib.view.kind === "folder") {
          const parent = dirname(lib.view.path);
          if (parent && parent !== lib.view.path) lib.navigate({ kind: "folder", path: parent });
        }
      } else if (lib.view.kind === "home") handled = false;
      else if (ctrl && key.toLowerCase() === "a") lib.setSelection(visible().map((i) => i.path));
      else if (key === "Escape") lib.clearSelection();
      else if (key === "ArrowRight") move(1, e.shiftKey);
      else if (key === "ArrowLeft") move(-1, e.shiftKey);
      else if (key === "ArrowDown") move(lib.columns, e.shiftKey);
      else if (key === "ArrowUp") move(-lib.columns, e.shiftKey);
      else if (key === "Home") move(-Infinity, e.shiftKey);
      else if (key === "End") move(Infinity, e.shiftKey);
      else if (key === "Enter") {
        const f = focusedItem();
        if (f) openInViewer(f);
      } else if (key === " ") {
        if (lib.focused) lib.select(lib.focused, "toggle", visible());
      } else if (key === "Delete") trashItems(targets());
      else if (key === "F2") {
        const f = focusedItem();
        if (f) renameItem(f);
      } else if (ctrl && key.toLowerCase() === "c") {
        const ts = targets();
        if (e.shiftKey) copyPath(ts);
        else if (ts.length === 1 && ts[0].kind === "image") copyImage(ts[0]);
        else if (ts.length) copyPath(ts);
      } else if (key === ".") toggleFavorite(targets());
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Keeps the window's always-on-top state in step with the setting. */
function useAlwaysOnTop() {
  const on = useSettings((s) => s.settings.alwaysOnTop);
  const loaded = useSettings((s) => s.loaded);
  const applied = useRef<boolean | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const changed = applied.current !== null && applied.current !== on;
    applied.current = on;
    getCurrentWindow().setAlwaysOnTop(on).catch((e) => console.error("always on top failed", e));
    api
      .prepareAlwaysOnTop(on)
      .then((restart) => {
        if (restart && changed) toast({ kind: "info", title: "Restart ENViewer to turn on Always on top" });
      })
      .catch((e) => console.error("always on top failed", e));
  }, [on, loaded]);
}

export default function App() {
  const [ready, setReady] = useState(false);
  const view = useLibrary((s) => s.view);
  useTheme();
  useAlwaysOnTop();
  useLibraryKeys();

  useEffect(() => {
    (async () => {
      await useSettings.getState().load();
      setMediaBase(await api.mediaBaseUrl().catch(() => null));
      await useLibrary.getState().init().catch((e) => console.error(e));
      setReady(true);
      const launch = await api.getLaunchPaths().catch(() => []);
      const s = useSettings.getState().settings;
      const lib = useLibrary.getState();
      if (launch.length) await openPath(launch[0]);
      else if (s.startup === "lastFolder" && s.lastFolder) await lib.navigate({ kind: "folder", path: s.lastFolder });
      else if (s.startup === "defaultLocation") {
        const loc = s.defaultLocation ?? lib.standard.find((x) => x.id === "pictures")?.path;
        if (loc) await lib.navigate({ kind: "folder", path: loc });
      }
    })();
  }, []);

  // Files opened while running (second instance / file association) and drag-and-drop.
  useEffect(() => {
    const unlisten = listen<string[]>("open-paths", (e) => e.payload[0] && openPath(e.payload[0]));
    const unDrop = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop" && e.payload.paths.length) openPath(e.payload.paths[0]);
    });
    // Prevent the webview from navigating on stray mouse back/forward buttons.
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        if (!useViewer.getState().open) (e.button === 3 ? useLibrary.getState().back : useLibrary.getState().forward)();
      }
    };
    window.addEventListener("mouseup", onMouseUp);
    const onContext = (e: MouseEvent) => {
      // Native context menus only on text inputs.
      const t = e.target as HTMLElement;
      if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") e.preventDefault();
    };
    window.addEventListener("contextmenu", onContext);
    return () => {
      unlisten.then((f) => f());
      unDrop.then((f) => f());
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("contextmenu", onContext);
    };
  }, []);

  const checkUpdates = useSettings((s) => s.settings.checkUpdates);
  useEffect(() => (ready ? scheduleUpdateCheck(checkUpdates) : undefined), [ready, checkUpdates]);

  if (!ready) return <div className="h-full bg-bg" />;

  return (
    <Tooltip.Provider>
      <div className="flex h-full">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Toolbar />
          {view.kind === "home" ? <HomeView /> : <Grid />}
          <StatusBar />
        </main>
      </div>
      <Viewer />
      <Compare />
      <Slideshow />
      <SettingsDialog />
      <UpdateDialog />
      <ShortcutsDialog />
      <BatchDialog />
      <OrganizeDialog />
      <ConfirmHost />
      <PromptHost />
      <Toaster />
    </Tooltip.Provider>
  );
}
