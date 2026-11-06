import { Clock, Download, FileImage, Folder, FolderOpen, Image as ImageIcon, Library, Monitor, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { openFileDialog, openFolderDialog, openPath } from "../../lib/actions";
import { api } from "../../lib/api";
import { basename, dirname, formatDate } from "../../lib/format";
import type { RecentEntry } from "../../lib/types";
import { thumbUrl } from "../../lib/urls";
import { useLibrary } from "../../store/library";
import { Button, Kbd } from "../ui/primitives";

const icons: Record<string, React.ReactNode> = {
  pictures: <ImageIcon className="h-5 w-5" />,
  downloads: <Download className="h-5 w-5" />,
  desktop: <Monitor className="h-5 w-5" />,
  home: <Folder className="h-5 w-5" />,
  documents: <Folder className="h-5 w-5" />,
};

function Card({ icon, title, subtitle, onClick }: { icon: React.ReactNode; title: string; subtitle?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left transition-colors hover:border-faint hover:bg-raised">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">{icon}</div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{title}</div>
        {subtitle && <div className="truncate text-[11px] text-faint">{subtitle}</div>}
      </div>
    </button>
  );
}

export function HomeView() {
  const { standard, recentFolders, collections, favorites, navigate } = useLibrary();
  const [recentFiles, setRecentFiles] = useState<RecentEntry[]>([]);
  useEffect(() => {
    api.getRecents("file", 16).then(setRecentFiles, () => {});
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-10 animate-fade-in">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to ENViewer</h1>
        <p className="mt-1 text-[13px] text-muted">Open a folder to browse it, or drop files and folders anywhere in this window.</p>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" onClick={openFolderDialog}>
            <FolderOpen className="h-4 w-4" /> Open folder <Kbd>Ctrl+O</Kbd>
          </Button>
          <Button onClick={openFileDialog}>
            <FileImage className="h-4 w-4" /> Open file
          </Button>
        </div>

        <h2 className="mb-3 mt-10 text-[11px] font-semibold uppercase tracking-wider text-faint">Locations</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {standard.map((s) => (
            <Card key={s.id} icon={icons[s.id]} title={s.name} subtitle={s.path} onClick={() => navigate({ kind: "folder", path: s.path })} />
          ))}
          <Card icon={<Star className="h-5 w-5" />} title="Favorites" subtitle={`${favorites.size} items`} onClick={() => navigate({ kind: "favorites" })} />
        </div>

        {recentFiles.length > 0 && (
          <>
            <h2 className="mb-3 mt-10 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              <Clock className="h-3.5 w-3.5" /> Recently viewed
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
              {recentFiles.map((r) => (
                <button key={r.path} onClick={() => openPath(r.path)} className="group relative aspect-square overflow-hidden rounded-lg bg-raised" title={r.path}>
                  <img src={thumbUrl(r.path, 256, 0, r.openedAt)} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] text-white">{basename(r.path)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {recentFolders.length > 0 && (
          <>
            <h2 className="mb-3 mt-10 text-[11px] font-semibold uppercase tracking-wider text-faint">Recent folders</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
              {recentFolders.map((r) => (
                <Card key={r.path} icon={<Folder className="h-5 w-5" />} title={basename(r.path) || r.path} subtitle={`${dirname(r.path)} · ${formatDate(r.openedAt)}`} onClick={() => navigate({ kind: "folder", path: r.path })} />
              ))}
            </div>
          </>
        )}

        {collections.length > 0 && (
          <>
            <h2 className="mb-3 mt-10 text-[11px] font-semibold uppercase tracking-wider text-faint">Collections</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {collections.map((c) => (
                <Card key={c.id} icon={<Library className="h-5 w-5" />} title={c.name} subtitle={`${c.count} items`} onClick={() => navigate({ kind: "collection", id: c.id, name: c.name })} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
