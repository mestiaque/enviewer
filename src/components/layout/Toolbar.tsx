import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  FileImage,
  Filter as FilterIcon,
  FolderOpen,
  FolderUp,
  Grid2x2,
  Keyboard,
  LayoutDashboard,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Play,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { activeFilterCount, type SortKey } from "../../engines/library";
import { openFileDialog, openFolderDialog, selectedItems, startCompare, startSlideshow } from "../../lib/actions";
import { basename, cn, dirname } from "../../lib/format";
import { useLibrary } from "../../store/library";
import { useSettings } from "../../store/settings";
import { useUi } from "../../store/ui";
import { DropdownMenu } from "../ui/menus";
import { IconButton, Segmented } from "../ui/primitives";
import { FilterPanel } from "./FilterPanel";
import { Popover } from "../ui/menus";
import { WindowControls, windowDragProps } from "../ui/WindowControls";
import { useViewer } from "../../store/viewer";

const sortLabels: Record<SortKey, string> = {
  name: "Name",
  captured: "Date captured",
  created: "Date created",
  modified: "Date modified",
  size: "File size",
  dimensions: "Dimensions",
  type: "File type",
};

function Title() {
  const view = useLibrary((s) => s.view);
  const navigate = useLibrary((s) => s.navigate);
  if (view.kind === "folder") {
    const parent = dirname(view.path);
    return (
      <div className="flex min-w-0 items-center gap-1">
        {parent && parent !== view.path && (
          <IconButton label={`Up to ${basename(parent) || parent}`} shortcut="Alt+↑" onClick={() => navigate({ kind: "folder", path: parent })}>
            <FolderUp className="h-4 w-4" />
          </IconButton>
        )}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{basename(view.path) || view.path}</div>
          <div className="truncate text-[11px] text-faint" title={view.path}>
            {view.path}
          </div>
        </div>
      </div>
    );
  }
  const t = { home: "Home", favorites: "Favorites", recent: "Recently viewed", collection: view.kind === "collection" ? view.name : "" }[view.kind];
  return <div className="truncate text-[13px] font-semibold">{t}</div>;
}

export function Toolbar() {
  const { settings, set } = useSettings();
  const lib = useLibrary();
  const [query, setQuery] = useState(lib.search);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterCount = activeFilterCount(lib.filter);
  const fullscreen = useViewer((v) => v.fullscreen);
  const inLibrary = lib.view.kind !== "home";

  useEffect(() => setQuery(lib.search), [lib.search]);
  useEffect(() => {
    const t = setTimeout(() => lib.setSearch(query), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const themeIcon = settings.theme === "light" ? <Sun className="h-4 w-4" /> : settings.theme === "dark" ? <Moon className="h-4 w-4" /> : settings.theme === "glass" ? <Sparkles className="h-4 w-4" /> : <Monitor className="h-4 w-4" />;

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel/80 px-2 backdrop-blur" {...windowDragProps}>
      <IconButton label={settings.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"} shortcut="Ctrl+B" onClick={() => set("sidebarCollapsed", !settings.sidebarCollapsed)}>
        <PanelLeft className="h-4 w-4" />
      </IconButton>
      <IconButton label="Back" shortcut="Alt+←" disabled={lib.historyIndex === 0} onClick={lib.back}>
        <ChevronLeft className="h-4 w-4" />
      </IconButton>
      <IconButton label="Forward" shortcut="Alt+→" disabled={lib.historyIndex >= lib.history.length - 1} onClick={lib.forward}>
        <ChevronRight className="h-4 w-4" />
      </IconButton>
      <div className="mx-1 min-w-0 flex-1">
        <Title />
      </div>

      {inLibrary && (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  (e.target as HTMLInputElement).blur();
                }
                e.stopPropagation();
              }}
              placeholder="Search   ext:heic  w>4000  date:2024"
              title="Search by name or folder. Tokens: ext:jpg, folder:name, date:2024-05, w>3000, h<1000"
              className="h-8 w-[min(280px,26vw)] rounded-md border border-line bg-bg pl-8 pr-7 text-[13px] outline-none placeholder:text-faint focus:border-accent"
            />
            {query && (
              <button className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg" onClick={() => setQuery("")} aria-label="Clear search">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <DropdownMenu
            trigger={
              <IconButton label={`Sort: ${sortLabels[lib.sortKey]}`}>{lib.sortDir === "asc" ? <ArrowUpNarrowWide className="h-4 w-4" /> : <ArrowDownWideNarrow className="h-4 w-4" />}</IconButton>
            }
            entries={[
              { heading: "Sort by" },
              ...(Object.keys(sortLabels) as SortKey[]).map((k) => ({ label: sortLabels[k], checked: lib.sortKey === k, onSelect: () => lib.setSort(k, lib.sortKey === k ? lib.sortDir : undefined) })),
              { separator: true },
              { label: "Ascending", checked: lib.sortDir === "asc", onSelect: () => lib.setSort(lib.sortKey, "asc") },
              { label: "Descending", checked: lib.sortDir === "desc", onSelect: () => lib.setSort(lib.sortKey, "desc") },
            ]}
          />

          <Popover
            trigger={
              <IconButton label="Filter" active={filterCount > 0} className="relative">
                <FilterIcon className="h-4 w-4" />
                {filterCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-fg">{filterCount}</span>}
              </IconButton>
            }
          >
            <FilterPanel />
          </Popover>

          <div className="mx-1">
            <Segmented
              value={settings.gridSize}
              onChange={(v) => set("gridSize", v)}
              options={[
                { value: "small", label: "S", title: "Small thumbnails" },
                { value: "medium", label: "M", title: "Medium thumbnails" },
                { value: "large", label: "L", title: "Large thumbnails" },
              ]}
            />
          </div>
          <IconButton
            label={settings.gridLayout === "grid" ? "Switch to justified layout" : "Switch to square grid"}
            onClick={() => set("gridLayout", settings.gridLayout === "grid" ? "justified" : "grid")}
          >
            {settings.gridLayout === "grid" ? <LayoutDashboard className="h-4 w-4" /> : <Grid2x2 className="h-4 w-4" />}
          </IconButton>
          <IconButton label="Reload" shortcut="F5" onClick={lib.refresh}>
            <RefreshCw className={cn("h-4 w-4", (lib.status === "listing" || lib.status === "probing") && "animate-spin")} />
          </IconButton>
        </>
      )}

      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton label="Open folder" shortcut="Ctrl+O" onClick={openFolderDialog}>
        <FolderOpen className="h-4 w-4" />
      </IconButton>
      <IconButton label="Open file" shortcut="Ctrl+Shift+O" onClick={openFileDialog}>
        <FileImage className="h-4 w-4" />
      </IconButton>
      <DropdownMenu
        trigger={<IconButton label="Theme">{themeIcon}</IconButton>}
        entries={[
          { label: "Dark", icon: <Moon className="h-3.5 w-3.5" />, checked: settings.theme === "dark", onSelect: () => set("theme", "dark") },
          { label: "Light", icon: <Sun className="h-3.5 w-3.5" />, checked: settings.theme === "light", onSelect: () => set("theme", "light") },
          { label: "Glass", icon: <Sparkles className="h-3.5 w-3.5" />, checked: settings.theme === "glass", onSelect: () => set("theme", "glass") },
          { label: "System", icon: <Monitor className="h-3.5 w-3.5" />, checked: settings.theme === "system", onSelect: () => set("theme", "system") },
        ]}
      />
      <DropdownMenu
        trigger={
          <IconButton label="More tools">
            <MoreHorizontal className="h-4 w-4" />
          </IconButton>
        }
        entries={[
          { label: "Slideshow", icon: <Play className="h-3.5 w-3.5" />, shortcut: "F6", disabled: !inLibrary, onSelect: () => startSlideshow(useLibrary.getState().focused ?? undefined) },
          { label: "Compare selected", icon: <Columns2 className="h-3.5 w-3.5" />, disabled: lib.selection.size !== 2, onSelect: () => startCompare(selectedItems()) },
          { label: "Batch operations…", icon: <Wand2 className="h-3.5 w-3.5" />, disabled: !inLibrary, onSelect: () => useUi.getState().openDialog("batch") },
          { label: "Organize & clean up…", icon: <Copy className="h-3.5 w-3.5" />, disabled: !inLibrary, onSelect: () => useUi.getState().openDialog("organize") },
          { separator: true },
          { label: "Keyboard shortcuts", icon: <Keyboard className="h-3.5 w-3.5" />, shortcut: "?", onSelect: () => useUi.getState().openDialog("shortcuts") },
        ]}
      />
      <IconButton label="Settings" shortcut="Ctrl+," onClick={() => useUi.getState().openDialog("settings")}>
        <Settings className="h-4 w-4" />
      </IconButton>
      {!fullscreen && <WindowControls />}
    </header>
  );
}
