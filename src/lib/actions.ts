/** User-facing operations shared by menus, toolbars and shortcuts. */
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLibrary, visibleSnapshot } from "../store/library";
import { useSettings } from "../store/settings";
import { confirmDialog, promptDialog, toast, useUi } from "../store/ui";
import { useViewer } from "../store/viewer";
import { api, errorMessage, newTaskId } from "./api";
import { basename, dirname } from "./format";
import type { MediaItem, OpResult } from "./types";

const IMAGE_EXTS = () =>
  useLibrary
    .getState()
    .formats.filter((f) => f.available && f.kind === "image")
    .flatMap((f) => f.extensions);

export async function openFolderDialog() {
  const dir = await openDialog({ directory: true, multiple: false, title: "Open folder" });
  if (typeof dir === "string") await useLibrary.getState().navigate({ kind: "folder", path: dir });
}

export async function openFileDialog() {
  const file = await openDialog({ multiple: false, title: "Open image", filters: [{ name: "Images", extensions: IMAGE_EXTS() }] });
  if (typeof file === "string") await openPath(file);
}

/** Open a file (scan its folder, then show it in the viewer) or a folder. */
export async function openPath(path: string) {
  const kind = await api.pathKind(path);
  if (!kind.exists) return toast({ kind: "error", title: "Not found", detail: path });
  if (kind.isDir) return useLibrary.getState().navigate({ kind: "folder", path });
  if (!kind.supported) return toast({ kind: "error", title: "ENViewer opens images only", detail: `${basename(path)} is not a supported image. Videos open in ENPlayer.` });
  const lib = useLibrary.getState();
  const folder = kind.parent ?? dirname(path);
  await lib.navigate({ kind: "folder", path: folder });
  // Wait until the target item is listed, then open it.
  const start = Date.now();
  const tryOpen = () => {
    const visible = visibleSnapshot();
    const idx = visible.findIndex((i) => i.path === path);
    if (idx >= 0) {
      useLibrary.getState().select(path, "single", visible);
      useViewer.getState().openAt(visible, idx);
    } else if (Date.now() - start < 15000 && useLibrary.getState().status !== "error") {
      setTimeout(tryOpen, 60);
    }
  };
  tryOpen();
}

export function openInViewer(item: MediaItem) {
  const visible = visibleSnapshot();
  const idx = visible.findIndex((i) => i.path === item.path);
  if (idx >= 0) useViewer.getState().openAt(visible, idx);
}

/** Include the Live Photo motion file when operating on a still. */
function withCompanions(items: MediaItem[]): string[] {
  return items.flatMap((i) => (i.live ? [i.path, i.live.video] : [i.path]));
}

function report(results: OpResult[], verb: string) {
  const failed = results.filter((r) => r.error);
  const ok = results.length - failed.length;
  if (failed.length === 0) toast({ kind: "success", title: `${verb} ${ok} file${ok === 1 ? "" : "s"}` });
  else
    toast(
      { kind: "error", title: `${verb} ${ok}, ${failed.length} failed`, detail: failed.slice(0, 3).map((f) => `${basename(f.source)}: ${f.error}`).join("\n") },
      8000,
    );
}

export async function trashItems(items: MediaItem[]) {
  if (!items.length) return;
  const paths = withCompanions(items);
  if (useSettings.getState().settings.confirmTrash) {
    const ok = await confirmDialog({
      title: items.length === 1 ? `Move “${items[0].name}” to the Trash?` : `Move ${items.length} items to the Trash?`,
      message: `${items.some((i) => i.live) ? "Live Photo motion files are included. " : ""}You can restore them from the system Trash.`,
      confirmLabel: "Move to Trash",
      danger: true,
    });
    if (!ok) return;
  }
  const res = await api.trashPaths(paths);
  const removed = res.filter((r) => !r.error).map((r) => r.source);
  useLibrary.getState().removePaths(removed);
  useViewer.getState().remove(removed);
  report(res, "Moved to Trash:");
}

export async function renameItem(item: MediaItem) {
  const name = await promptDialog({ title: "Rename", label: "New name", initial: item.name, confirmLabel: "Rename", selectStem: true });
  if (!name || name === item.name) return;
  try {
    const to = await api.renamePath(item.path, name);
    if (item.live) {
      const ext = item.live.video.slice(item.live.video.lastIndexOf("."));
      const stemName = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
      await api.renamePath(item.live.video, stemName + ext).catch(() => {});
    }
    useLibrary.getState().replacePath(item.path, to);
    useViewer.getState().replace(item.path, to);
    if (item.live) useLibrary.getState().refresh();
  } catch (e) {
    toast({ kind: "error", title: "Rename failed", detail: errorMessage(e) });
  }
}

export async function transferItems(items: MediaItem[], mode: "copy" | "move") {
  if (!items.length) return;
  const dest = await openDialog({ directory: true, title: mode === "copy" ? "Copy to folder" : "Move to folder" });
  if (typeof dest !== "string") return;
  const taskId = newTaskId(mode);
  const paths = withCompanions(items);
  const verb = mode === "copy" ? "Copying" : "Moving";
  const tid = toast({ kind: "progress", title: `${verb} ${paths.length} files…`, progress: { done: 0, total: paths.length }, onCancel: () => api.cancelTask(taskId) });
  try {
    const res = await api.transferPaths(paths, dest, mode, taskId, (p) => useUi.getState().updateToast(tid, { progress: p }));
    useUi.getState().dismiss(tid);
    if (mode === "move") {
      const moved = res.filter((r) => !r.error).map((r) => r.source);
      useLibrary.getState().removePaths(moved);
      useViewer.getState().remove(moved);
    }
    report(res, mode === "copy" ? "Copied" : "Moved");
  } catch (e) {
    useUi.getState().updateToast(tid, { kind: "error", title: `${verb} failed`, detail: errorMessage(e) });
  }
}

export async function copyImage(item: MediaItem) {
  const tid = toast({ kind: "progress", title: "Copying image…" });
  try {
    await api.copyImage(item.path);
    useUi.getState().updateToast(tid, { kind: "success", title: "Image copied to clipboard" });
  } catch (e) {
    useUi.getState().updateToast(tid, { kind: "error", title: "Could not copy image", detail: errorMessage(e) });
  }
}

export async function copyPath(items: MediaItem[]) {
  await api.copyText(items.map((i) => i.path).join("\n"));
  toast({ kind: "success", title: items.length > 1 ? `Copied ${items.length} paths` : "Path copied" }, 2000);
}

export async function reveal(item: MediaItem) {
  await api.revealInFolder(item.path).catch((e) => toast({ kind: "error", title: "Could not open folder", detail: errorMessage(e) }));
}

export async function openExternal(item: MediaItem) {
  await api.openExternal(item.path).catch((e) => toast({ kind: "error", title: "No application could open this file", detail: errorMessage(e) }));
}

export async function toggleFavorite(items: MediaItem[]) {
  const lib = useLibrary.getState();
  const fav = !items.every((i) => lib.favorites.has(i.path));
  await lib.setFavorite(
    items.map((i) => i.path),
    fav,
  );
}

export async function addToCollection(items: MediaItem[], id: number | "new") {
  try {
    let cid = id;
    if (cid === "new") {
      const name = await promptDialog({ title: "New collection", label: "Name", initial: "", confirmLabel: "Create" });
      if (!name?.trim()) return;
      cid = await api.createCollection(name.trim());
    }
    await api.addToCollection(
      cid,
      items.map((i) => i.path),
    );
    await useLibrary.getState().refreshCollections();
    const c = useLibrary.getState().collections.find((x) => x.id === cid);
    toast({ kind: "success", title: `Added ${items.length} to “${c?.name ?? "collection"}”` }, 2500);
  } catch (e) {
    toast({ kind: "error", title: "Could not add to collection", detail: errorMessage(e) });
  }
}

export async function removeFromCurrentCollection(items: MediaItem[]) {
  const view = useLibrary.getState().view;
  if (view.kind !== "collection") return;
  await api.removeFromCollection(
    view.id,
    items.map((i) => i.path),
  );
  useLibrary.getState().removePaths(items.map((i) => i.path));
  useLibrary.getState().refreshCollections();
}

export function startCompare(items: MediaItem[]) {
  if (items.length !== 2) return toast({ kind: "info", title: "Select exactly two images to compare" });
  useUi.setState({ compare: [items[0].path, items[1].path] });
}

export function startSlideshow(fromPath?: string) {
  const visible = visibleSnapshot().filter((i) => i.kind === "image");
  if (!visible.length) return toast({ kind: "info", title: "No images to show" });
  const start = Math.max(0, fromPath ? visible.findIndex((i) => i.path === fromPath) : 0);
  useUi.setState({ slideshow: { paths: visible.map((i) => i.path), start } });
}

export function selectedItems(): MediaItem[] {
  const { selection } = useLibrary.getState();
  return visibleSnapshot().filter((i) => selection.has(i.path));
}
