import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Aperture,
  Clock,
  Download,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  History,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  Library,
  Monitor,
  Plus,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { EMPTY_FILTER, type Filter } from "../../engines/library";
import { api, errorMessage } from "../../lib/api";
import { basename, cn } from "../../lib/format";
import { useLibrary, viewKey, type View } from "../../store/library";
import { useSettings } from "../../store/settings";
import { confirmDialog, promptDialog, toast } from "../../store/ui";
import { ContextMenu } from "../ui/menus";
import { Tip } from "../ui/primitives";
import appIcon from "../../assets/enviewer-icon.svg";

const folderIcon: Record<string, ReactNode> = {
  home: <Home className="h-4 w-4" />,
  pictures: <ImageIcon className="h-4 w-4" />,
  downloads: <Download className="h-4 w-4" />,
  desktop: <Monitor className="h-4 w-4" />,
  documents: <Folder className="h-4 w-4" />,
};

function Row({ icon, label, active, onClick, collapsed, count }: { icon: ReactNode; label: string; active?: boolean; onClick: () => void; collapsed: boolean; count?: number }) {
  const btn = (
    <button
      onClick={onClick}
      className={cn(
        "group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors",
        active ? "bg-accent/15 text-fg" : "text-muted hover:bg-raised hover:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      <span className={cn("shrink-0", active && "text-accent")}>{icon}</span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && count != null && count > 0 && <span className="text-[11px] text-faint">{count}</span>}
    </button>
  );
  return collapsed ? (
    <Tip label={label} side="right">
      {btn}
    </Tip>
  ) : (
    btn
  );
}

function Section({ title, children, collapsed, action }: { title: string; children: ReactNode; collapsed: boolean; action?: ReactNode }) {
  return (
    <div className="mt-4 first:mt-1">
      {!collapsed ? (
        <div className="mb-1 flex h-6 items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
          {title}
          {action}
        </div>
      ) : (
        <div className="mx-3 mb-2 h-px bg-line" />
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

const smartAlbums: { id: string; label: string; icon: ReactNode; filter: Partial<Filter> }[] = [
  { id: "live", label: "Live Photos", icon: <Zap className="h-4 w-4" />, filter: { live: true } },
  { id: "raw", label: "RAW", icon: <Aperture className="h-4 w-4" />, filter: { raw: true } },
  { id: "animated", label: "Animated", icon: <Sparkles className="h-4 w-4" />, filter: { animated: true } },
  { id: "videos", label: "Videos", icon: <Film className="h-4 w-4" />, filter: { videos: "only" } },
];

export function Sidebar() {
  const collapsed = useSettings((s) => s.settings.sidebarCollapsed);
  const { view, standard, pinned, collections, recentFolders, filter, favorites, navigate, setFilter, refreshPinned, refreshCollections } = useLibrary();
  const go = (v: View) => navigate(v);
  const isView = (v: View) => viewKey(view) === viewKey(v);
  const folderView = view.kind === "folder" ? view.path : null;
  const albumActive = (f: Partial<Filter>) => Object.entries(f).every(([k, v]) => filter[k as keyof Filter] === v);

  const addFolder = async () => {
    const dir = await openDialog({ directory: true, title: "Add folder to sidebar" });
    if (typeof dir === "string") {
      await api.pinFolder(dir);
      refreshPinned();
    }
  };
  const newCollection = async () => {
    const name = await promptDialog({ title: "New collection", label: "Name", initial: "", confirmLabel: "Create" });
    if (!name?.trim()) return;
    try {
      const id = await api.createCollection(name.trim());
      await refreshCollections();
      navigate({ kind: "collection", id, name: name.trim() });
    } catch (e) {
      toast({ kind: "error", title: "Could not create collection", detail: errorMessage(e) });
    }
  };

  return (
    <aside className={cn("flex shrink-0 flex-col border-r border-line bg-panel transition-[width] duration-200", collapsed ? "w-[52px]" : "w-[232px]")}>
      <div className={cn("flex h-11 items-center gap-2 px-4", collapsed && "justify-center px-0")}>
        <img src={appIcon} alt="" className="h-6 w-6 shrink-0" draggable={false} />
        {!collapsed && <span className="text-[14px] font-semibold tracking-tight">ENViewer</span>}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <Section title="Library" collapsed={collapsed}>
          <Row collapsed={collapsed} icon={<Home className="h-4 w-4" />} label="Home" active={isView({ kind: "home" })} onClick={() => go({ kind: "home" })} />
          <Row
            collapsed={collapsed}
            icon={<LayoutGrid className="h-4 w-4" />}
            label="Browse"
            active={view.kind === "folder"}
            onClick={() => {
              const last = useSettings.getState().settings.lastFolder ?? standard.find((s) => s.id === "pictures")?.path;
              if (folderView) return;
              if (last) go({ kind: "folder", path: last });
            }}
          />
          <Row collapsed={collapsed} icon={<Clock className="h-4 w-4" />} label="Recent" active={isView({ kind: "recent" })} onClick={() => go({ kind: "recent" })} />
          <Row collapsed={collapsed} icon={<Star className="h-4 w-4" />} label="Favorites" count={favorites.size} active={isView({ kind: "favorites" })} onClick={() => go({ kind: "favorites" })} />
        </Section>

        {view.kind !== "home" && (
          <Section title="Albums" collapsed={collapsed}>
            {smartAlbums.map((a) => (
              <Row
                key={a.id}
                collapsed={collapsed}
                icon={a.icon}
                label={a.label}
                active={albumActive(a.filter)}
                onClick={() => (albumActive(a.filter) ? setFilter({ ...Object.fromEntries(Object.keys(a.filter).map((k) => [k, EMPTY_FILTER[k as keyof Filter]])) }) : setFilter({ ...EMPTY_FILTER, ...a.filter }))}
              />
            ))}
          </Section>
        )}

        <Section
          title="Collections"
          collapsed={collapsed}
          action={
            <button onClick={newCollection} className="rounded p-0.5 hover:bg-raised hover:text-fg" aria-label="New collection">
              <Plus className="h-3.5 w-3.5" />
            </button>
          }
        >
          {collections.length === 0 && !collapsed && <div className="px-2 py-1 text-xs text-faint">No collections yet</div>}
          {collections.map((c) => (
            <ContextMenu
              key={c.id}
              entries={() => [
                {
                  label: "Rename…",
                  onSelect: async () => {
                    const name = await promptDialog({ title: "Rename collection", initial: c.name, confirmLabel: "Rename" });
                    if (name?.trim()) {
                      await api.renameCollection(c.id, name.trim());
                      refreshCollections();
                    }
                  },
                },
                {
                  label: "Delete collection",
                  danger: true,
                  onSelect: async () => {
                    if (await confirmDialog({ title: `Delete “${c.name}”?`, message: "The images themselves are not affected.", confirmLabel: "Delete", danger: true })) {
                      await api.deleteCollection(c.id);
                      await refreshCollections();
                      if (view.kind === "collection" && view.id === c.id) go({ kind: "home" });
                    }
                  },
                },
              ]}
            >
              <div>
                <Row
                  collapsed={collapsed}
                  icon={<Library className="h-4 w-4" />}
                  label={c.name}
                  count={c.count}
                  active={view.kind === "collection" && view.id === c.id}
                  onClick={() => go({ kind: "collection", id: c.id, name: c.name })}
                />
              </div>
            </ContextMenu>
          ))}
        </Section>

        <Section
          title="Folders"
          collapsed={collapsed}
          action={
            <button onClick={addFolder} className="rounded p-0.5 hover:bg-raised hover:text-fg" aria-label="Add folder">
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          }
        >
          {standard
            .filter((s) => s.id !== "documents")
            .map((s) => (
              <Row key={s.id} collapsed={collapsed} icon={folderIcon[s.id]} label={s.name} active={folderView === s.path} onClick={() => go({ kind: "folder", path: s.path })} />
            ))}
          {pinned.map((p) => (
            <ContextMenu
              key={p.id}
              entries={() => [
                {
                  label: "Remove from sidebar",
                  onSelect: async () => {
                    await api.unpinFolder(p.path);
                    refreshPinned();
                  },
                },
              ]}
            >
              <div>
                <Row collapsed={collapsed} icon={<FolderOpen className="h-4 w-4" />} label={p.name} active={folderView === p.path} onClick={() => go({ kind: "folder", path: p.path })} />
              </div>
            </ContextMenu>
          ))}
        </Section>

        {!collapsed && recentFolders.length > 0 && (
          <Section title="Recently opened" collapsed={collapsed}>
            {recentFolders.slice(0, 6).map((r) => (
              <Row key={r.path} collapsed={collapsed} icon={<History className="h-4 w-4" />} label={basename(r.path)} active={folderView === r.path} onClick={() => go({ kind: "folder", path: r.path })} />
            ))}
          </Section>
        )}
      </nav>
    </aside>
  );
}
