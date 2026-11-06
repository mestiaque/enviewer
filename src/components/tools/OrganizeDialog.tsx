import { FolderOpen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { reveal, trashItems } from "../../lib/actions";
import { api, errorMessage, newTaskId } from "../../lib/api";
import { basename, formatBytes, formatDate } from "../../lib/format";
import type { BrokenFile, DuplicateGroup, MediaItem, Progress, SimilarGroup } from "../../lib/types";
import { thumbUrl } from "../../lib/urls";
import { useLibrary } from "../../store/library";
import { useUi } from "../../store/ui";
import { Dialog } from "../ui/overlays";
import { Button, ProgressBar, Segmented, Select, Spinner } from "../ui/primitives";

type Tab = "duplicates" | "similar" | "broken" | "large" | "old" | "storage";

function Thumb({ path, size = 72 }: { path: string; size?: number }) {
  return <img src={thumbUrl(path, 256, 0, 0)} alt="" className="shrink-0 rounded-md bg-raised object-cover" style={{ width: size, height: size }} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />;
}

function FileRow({ item, extra }: { item: MediaItem | undefined; extra?: React.ReactNode }) {
  if (!item) return null;
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-raised">
      <Thumb path={item.path} size={44} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{item.name}</div>
        <div className="truncate text-[11px] text-faint">{extra}</div>
      </div>
      <button className="rounded p-1.5 text-muted hover:bg-line hover:text-fg" title="Show in folder" onClick={() => reveal(item)}>
        <FolderOpen className="h-3.5 w-3.5" />
      </button>
      <button className="rounded p-1.5 text-muted hover:bg-danger/20 hover:text-danger" title="Move to Trash" onClick={() => trashItems([item])}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function OrganizeDialog() {
  const open = useUi((s) => s.dialog === "organize");
  const items = useLibrary((s) => s.items);
  const probes = useLibrary((s) => s.probes);
  const byPath = useMemo(() => new Map(items.map((i) => [i.path, i])), [items]);
  const images = useMemo(() => items.filter((i) => i.kind === "image"), [items]);
  const [tab, setTab] = useState<Tab>("duplicates");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [dups, setDups] = useState<DuplicateGroup[] | null>(null);
  const [similar, setSimilar] = useState<SimilarGroup[] | null>(null);
  const [threshold, setThreshold] = useState(6);
  const [broken, setBroken] = useState<BrokenFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async <T,>(fn: (id: string) => Promise<T>, set: (v: T) => void) => {
    const id = newTaskId("organize");
    setTask(id);
    setError(null);
    setProgress({ done: 0, total: images.length });
    try {
      set(await fn(id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTask(null);
      setProgress(null);
    }
  };
  const paths = images.map((i) => i.path);

  const largest = useMemo(() => [...images].sort((a, b) => b.size - a.size).slice(0, 100), [images]);
  const oldest = useMemo(() => [...images].sort((a, b) => (probes.get(a.path)?.captured ?? a.modified) - (probes.get(b.path)?.captured ?? b.modified)).slice(0, 100), [images, probes]);
  const storage = useMemo(() => {
    const m = new Map<string, { count: number; bytes: number }>();
    for (const i of items) {
      const k = i.format;
      const e = m.get(k) ?? { count: 0, bytes: 0 };
      e.count++;
      e.bytes += i.size;
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  }, [items]);
  const totalBytes = storage.reduce((n, [, e]) => n + e.bytes, 0);
  const formats = useLibrary((s) => s.formats);
  const formatName = (id: string) => formats.find((f) => f.id === id)?.name ?? id;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && useUi.getState().openDialog(null)} title="Organize & clean up" description={`${images.length} images in the current view · everything runs locally`} className="w-[min(820px,94vw)]">
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "duplicates", label: "Duplicates" },
            { value: "similar", label: "Similar" },
            { value: "broken", label: "Broken" },
            { value: "large", label: "Largest" },
            { value: "old", label: "Oldest" },
            { value: "storage", label: "Storage" },
          ]}
        />
      </div>
      {progress && (
        <div className="mb-3 flex items-center gap-3">
          <ProgressBar value={progress.done} total={progress.total} />
          <Button size="sm" onClick={() => task && api.cancelTask(task)}>
            Cancel
          </Button>
        </div>
      )}
      {error && <div className="mb-3 rounded-md bg-danger/10 p-2 text-xs text-danger">{error}</div>}

      {tab === "duplicates" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">Byte-identical files, found by size and BLAKE3 content hash.</p>
            <Button variant="primary" size="sm" disabled={!!task} onClick={() => run((id) => api.findDuplicates(paths, id, setProgress), setDups)}>
              {task && <Spinner className="h-3 w-3" />} Find duplicates
            </Button>
          </div>
          {dups?.length === 0 && <p className="text-[13px] text-success">No duplicates found.</p>}
          {dups?.map((g, gi) => (
            <div key={gi} className="rounded-lg border border-line p-2">
              <div className="mb-1 px-2 text-[11px] text-faint">
                {g.paths.length} copies · {formatBytes(g.size)} each · {formatBytes(g.size * (g.paths.length - 1))} reclaimable
              </div>
              {g.paths.map((p) => (
                <FileRow key={p} item={byPath.get(p)} extra={p} />
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "similar" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Perceptual hashing (dHash) on thumbnails. Optional, local only – no images leave this computer.</p>
            <Select
              value={threshold}
              onChange={setThreshold}
              options={[
                { value: 2, label: "Very strict" },
                { value: 6, label: "Normal" },
                { value: 10, label: "Loose" },
              ]}
            />
            <Button variant="primary" size="sm" disabled={!!task} onClick={() => run((id) => api.findSimilar(paths, threshold, id, setProgress), setSimilar)}>
              {task && <Spinner className="h-3 w-3" />} Find similar
            </Button>
          </div>
          {similar?.length === 0 && <p className="text-[13px] text-success">No similar images found.</p>}
          {similar?.map((g, gi) => (
            <div key={gi} className="rounded-lg border border-line p-2">
              <div className="mb-1 px-2 text-[11px] text-faint">
                {g.paths.length} images · {g.maxDistance === 0 ? "visually identical" : `distance ≤ ${g.maxDistance}`}
              </div>
              {g.paths.map((p) => (
                <FileRow key={p} item={byPath.get(p)} extra={`${formatBytes(byPath.get(p)?.size ?? 0)} · ${p}`} />
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "broken" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">Decodes every image and lists the ones that fail.</p>
            <Button variant="primary" size="sm" disabled={!!task} onClick={() => run((id) => api.findBroken(paths, id, setProgress), setBroken)}>
              {task && <Spinner className="h-3 w-3" />} Check images
            </Button>
          </div>
          {broken?.length === 0 && <p className="text-[13px] text-success">All images decoded successfully.</p>}
          {broken?.map((b) => (
            <FileRow key={b.path} item={byPath.get(b.path)} extra={<span className="text-danger">{b.error}</span>} />
          ))}
        </div>
      )}

      {tab === "large" && (
        <div>
          {largest.map((i) => (
            <FileRow key={i.path} item={i} extra={`${formatBytes(i.size)} · ${probes.get(i.path)?.width ?? "?"}×${probes.get(i.path)?.height ?? "?"}`} />
          ))}
        </div>
      )}

      {tab === "old" && (
        <div>
          {oldest.map((i) => {
            const cap = probes.get(i.path)?.captured;
            return <FileRow key={i.path} item={i} extra={cap ? `Captured ${new Date(cap).toISOString().slice(0, 10)}` : `Modified ${formatDate(i.modified, false)}`} />;
          })}
        </div>
      )}

      {tab === "storage" && (
        <div className="space-y-2">
          <div className="text-[13px]">
            {items.length} files · <span className="font-semibold">{formatBytes(totalBytes)}</span>
          </div>
          {storage.map(([fmt, e]) => (
            <div key={fmt} className="grid grid-cols-[160px_1fr_120px] items-center gap-3 text-[12px]">
              <span className="truncate">{formatName(fmt)}</span>
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(e.bytes / Math.max(1, totalBytes)) * 100}%` }} />
              </div>
              <span className="text-right text-muted">
                {e.count} · {formatBytes(e.bytes)}
              </span>
            </div>
          ))}
          <p className="pt-2 text-xs text-faint">Based on the files in the current view: {basename(useLibrary.getState().view.kind === "folder" ? (useLibrary.getState().view as { path: string }).path : "")}</p>
        </div>
      )}
    </Dialog>
  );
}
