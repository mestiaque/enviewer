/** Typed wrappers around the Rust commands. One function per command. */
import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  BrokenFile,
  CacheStats,
  Collection,
  DuplicateGroup,
  EditParams,
  ExportFormat,
  FormatCapability,
  ImageInfo,
  OpResult,
  PinnedFolder,
  Progress,
  RecentEntry,
  RenamePlan,
  ScanEvent,
  SimilarGroup,
  StandardFolder,
  SubFolder,
} from "./types";

function progressChannel(onProgress?: (p: Progress) => void) {
  const ch = new Channel<Progress>();
  if (onProgress) ch.onmessage = onProgress;
  return ch;
}

export interface UpdateInfo {
  version: string;
  notes: string;
  page: string;
  assetName: string;
  url: string;
  size: number;
  sha256: string;
  installable: boolean;
}

export const api = {
  getFormats: () => invoke<{ formats: FormatCapability[]; heifVersion: string | null }>("get_formats"),
  getLaunchPaths: () => invoke<string[]>("get_launch_paths"),
  standardFolders: () => invoke<StandardFolder[]>("standard_folders"),
  pathKind: (path: string) => invoke<{ exists: boolean; isDir: boolean; parent: string | null; supported: boolean }>("path_kind", { path }),
  listSubfolders: (path: string, includeHidden: boolean) => invoke<SubFolder[]>("list_subfolders", { path, includeHidden }),

  scanFolder(path: string, includeHidden: boolean, onEvent: (e: ScanEvent) => void) {
    const ch = new Channel<ScanEvent>();
    ch.onmessage = onEvent;
    return invoke<void>("scan_folder", { path, includeHidden, onEvent: ch });
  },
  loadItems(paths: string[], onEvent: (e: ScanEvent) => void) {
    const ch = new Channel<ScanEvent>();
    ch.onmessage = onEvent;
    return invoke<void>("load_items", { paths, onEvent: ch });
  },
  cancelScan: () => invoke<void>("cancel_scan"),
  mediaBaseUrl: () => invoke<string | null>("media_base_url"),
  prepareAlwaysOnTop: (on: boolean) => invoke<boolean>("prepare_always_on_top", { on }),
  appPaths: () => invoke<{ data: string; cache: string; logs: string }>("app_paths"),
  aboutInfo: () => invoke<{ build: string; tauriVersion: string; webviewVersion: string; platform: string; arch: string }>("about_info"),
  setThumbGeneration: (generation: number) => invoke<void>("set_thumb_generation", { generation }),
  getImageInfo: (path: string) => invoke<ImageInfo>("get_image_info", { path }),

  getFavorites: () => invoke<string[]>("get_favorites"),
  setFavorite: (paths: string[], favorite: boolean) => invoke<void>("set_favorite", { paths, favorite }),
  listCollections: () => invoke<Collection[]>("list_collections"),
  createCollection: (name: string) => invoke<number>("create_collection", { name }),
  renameCollection: (id: number, name: string) => invoke<void>("rename_collection", { id, name }),
  deleteCollection: (id: number) => invoke<void>("delete_collection", { id }),
  addToCollection: (id: number, paths: string[]) => invoke<void>("add_to_collection", { id, paths }),
  removeFromCollection: (id: number, paths: string[]) => invoke<void>("remove_from_collection", { id, paths }),
  collectionItems: (id: number) => invoke<string[]>("collection_items", { id }),
  addRecent: (path: string, kind: "file" | "folder") => invoke<void>("add_recent", { path, kind }),
  getRecents: (kind: "file" | "folder", limit: number) => invoke<RecentEntry[]>("get_recents", { kind, limit }),
  clearRecents: () => invoke<void>("clear_recents"),
  getPinnedFolders: () => invoke<PinnedFolder[]>("get_pinned_folders"),
  pinFolder: (path: string) => invoke<void>("pin_folder", { path }),
  unpinFolder: (path: string) => invoke<void>("unpin_folder", { path }),
  getSettings: () => invoke<Record<string, unknown>>("get_settings"),
  setSetting: (key: string, value: unknown) => invoke<void>("set_setting", { key, value }),
  cacheStats: () => invoke<CacheStats>("cache_stats"),
  clearThumbnailCache: () => invoke<void>("clear_thumbnail_cache"),
  getEdit: (path: string) => invoke<EditParams | null>("get_edit", { path }),
  saveEdit: (path: string, params: EditParams | null) => invoke<void>("save_edit", { path, params }),

  revealInFolder: (path: string) => invoke<void>("reveal_in_folder", { path }),
  contactDeveloper: () => invoke<void>("contact_developer"),
  openDeveloperWebsite: () => invoke<void>("open_developer_website"),
  checkUpdate: () => invoke<UpdateInfo | null>("check_update"),
  installUpdate: (info: UpdateInfo) => invoke<"restart" | "exiting">("install_update", { info }),
  restartApp: () => invoke<void>("restart_app"),
  openExternal: (path: string) => invoke<void>("open_external", { path }),
  copyText: (text: string) => invoke<void>("copy_text", { text }),
  copyImage: (path: string) => invoke<void>("copy_image", { path }),
  trashPaths: (paths: string[]) => invoke<OpResult[]>("trash_paths", { paths }),
  renamePath: (path: string, newName: string) => invoke<string>("rename_path", { path, newName }),
  transferPaths: (paths: string[], destDir: string, mode: "copy" | "move", taskId: string, onProgress?: (p: Progress) => void) =>
    invoke<OpResult[]>("transfer_paths", { paths, destDir, mode, taskId, onProgress: progressChannel(onProgress) }),
  cancelTask: (taskId: string) => invoke<void>("cancel_task", { taskId }),

  exportImage: (path: string, params: EditParams | null, dest: string, format: ExportFormat, quality: number) =>
    invoke<string>("export_image", { path, params, dest, format, quality }),
  planBatchRename: (inputs: { path: string; modified: number; captured: number | null }[], pattern: string, start: number, keepExt: boolean) =>
    invoke<RenamePlan[]>("plan_batch_rename", { inputs, pattern, start, keepExt }),
  runBatchRename: (plan: RenamePlan[]) => invoke<OpResult[]>("run_batch_rename", { plan }),
  batchConvert: (
    paths: string[],
    options: { format: ExportFormat; quality: number; maxWidth: number | null; maxHeight: number | null; destDir: string; suffix: string },
    applyEdits: boolean,
    taskId: string,
    onProgress?: (p: Progress) => void,
  ) => invoke<OpResult[]>("batch_convert", { paths, options, applyEdits, taskId, onProgress: progressChannel(onProgress) }),
  findDuplicates: (paths: string[], taskId: string, onProgress?: (p: Progress) => void) =>
    invoke<DuplicateGroup[]>("find_duplicates", { paths, taskId, onProgress: progressChannel(onProgress) }),
  findSimilar: (paths: string[], threshold: number, taskId: string, onProgress?: (p: Progress) => void) =>
    invoke<SimilarGroup[]>("find_similar", { paths, threshold, taskId, onProgress: progressChannel(onProgress) }),
  findBroken: (paths: string[], taskId: string, onProgress?: (p: Progress) => void) =>
    invoke<BrokenFile[]>("find_broken", { paths, taskId, onProgress: progressChannel(onProgress) }),
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

let taskCounter = 0;
export const newTaskId = (prefix: string) => `${prefix}-${Date.now()}-${++taskCounter}`;
