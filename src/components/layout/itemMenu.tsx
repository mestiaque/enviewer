import {
  Clipboard,
  ClipboardCopy,
  Columns2,
  Copy,
  ExternalLink,
  FolderInput,
  FolderOpen,
  Library,
  Maximize2,
  Pencil,
  Play,
  Plus,
  Star,
  StarOff,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  addToCollection,
  copyImage,
  copyPath,
  openExternal,
  openInViewer,
  removeFromCurrentCollection,
  renameItem,
  reveal,
  startCompare,
  startSlideshow,
  toggleFavorite,
  transferItems,
  trashItems,
} from "../../lib/actions";
import type { MediaItem } from "../../lib/types";
import { useLibrary } from "../../store/library";
import { useUi } from "../../store/ui";
import type { MenuEntry } from "../ui/menus";

const ico = "h-3.5 w-3.5";

/** Context menu for one item, acting on the whole selection when it is part of it. */
export function itemMenu(item: MediaItem, targets: MediaItem[], opts: { inViewer?: boolean } = {}): MenuEntry[] {
  const lib = useLibrary.getState();
  const many = targets.length > 1;
  const allFav = targets.every((t) => lib.favorites.has(t.path));
  const inCollection = lib.view.kind === "collection";
  return [
    { label: "Open", icon: <Maximize2 className={ico} />, shortcut: "Enter", hidden: opts.inViewer || many, onSelect: () => openInViewer(item) },
    { label: "Open with default app", icon: <ExternalLink className={ico} />, hidden: many, onSelect: () => openExternal(item) },
    { label: "Show in file manager", icon: <FolderOpen className={ico} />, hidden: many, onSelect: () => reveal(item) },
    { separator: true },
    {
      label: allFav ? (many ? "Unfavorite all" : "Unfavorite") : many ? "Favorite all" : "Favorite",
      icon: allFav ? <StarOff className={ico} /> : <Star className={ico} />,
      shortcut: many ? undefined : ".",
      onSelect: () => toggleFavorite(targets),
    },
    {
      label: "Add to collection",
      icon: <Library className={ico} />,
      submenu: [
        { label: "New collection…", icon: <Plus className={ico} />, onSelect: () => addToCollection(targets, "new") },
        ...(lib.collections.length ? [{ separator: true } as MenuEntry] : []),
        ...lib.collections.map((c) => ({ label: c.name, onSelect: () => addToCollection(targets, c.id) })),
      ],
    },
    { label: "Remove from this collection", icon: <Library className={ico} />, hidden: !inCollection, onSelect: () => removeFromCurrentCollection(targets) },
    { separator: true },
    { label: "Copy image", icon: <Clipboard className={ico} />, shortcut: "Ctrl+C", hidden: many || item.kind !== "image", onSelect: () => copyImage(item) },
    { label: many ? "Copy paths" : "Copy path", icon: <ClipboardCopy className={ico} />, shortcut: "Ctrl+Shift+C", onSelect: () => copyPath(targets) },
    { label: "Copy to…", icon: <Copy className={ico} />, onSelect: () => transferItems(targets, "copy") },
    { label: "Move to…", icon: <FolderInput className={ico} />, onSelect: () => transferItems(targets, "move") },
    { label: "Rename…", icon: <Pencil className={ico} />, shortcut: "F2", hidden: many, onSelect: () => renameItem(item) },
    { separator: true, hidden: opts.inViewer },
    { label: "Compare", icon: <Columns2 className={ico} />, hidden: targets.length !== 2 || opts.inViewer, onSelect: () => startCompare(targets) },
    { label: "Slideshow from here", icon: <Play className={ico} />, hidden: many || opts.inViewer, onSelect: () => startSlideshow(item.path) },
    { label: "Batch operations…", icon: <Wand2 className={ico} />, hidden: !many, onSelect: () => useUi.getState().openDialog("batch") },
    { separator: true },
    { label: many ? `Move ${targets.length} to Trash` : "Move to Trash", icon: <Trash2 className={ico} />, shortcut: "Del", danger: true, onSelect: () => trashItems(targets) },
  ];
}
