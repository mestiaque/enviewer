import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Star, StarOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { selectedItems } from "../../lib/actions";
import { api, errorMessage, newTaskId } from "../../lib/api";
import { basename, cn, formatBytes, formatCaptured } from "../../lib/format";
import type { ExportFormat, ImageInfo, OpResult, Progress, RenamePlan } from "../../lib/types";
import { useLibrary, visibleSnapshot } from "../../store/library";
import { confirmDialog, toast, useUi } from "../../store/ui";
import { Dialog } from "../ui/overlays";
import { Button, Input, ProgressBar, Segmented, Select, Spinner, Switch } from "../ui/primitives";

type Tab = "rename" | "convert" | "favorite" | "inspect";

export function BatchDialog() {
  const open = useUi((s) => s.dialog === "batch");
  const close = () => useUi.getState().openDialog(null);
  const [tab, setTab] = useState<Tab>("rename");
  const targets = useMemo(() => {
    if (!open) return [];
    const sel = selectedItems();
    return (sel.length ? sel : visibleSnapshot()).filter((i) => !i.companion);
  }, [open]);
  const usingSelection = useLibrary((s) => s.selection.size > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Batch operations"
      description={`${targets.length} ${usingSelection ? "selected" : "visible"} item${targets.length === 1 ? "" : "s"}`}
      className="w-[min(760px,94vw)]"
    >
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "rename", label: "Rename" },
            { value: "convert", label: "Convert & resize" },
            { value: "favorite", label: "Favorites" },
            { value: "inspect", label: "Inspect metadata" },
          ]}
        />
      </div>
      {tab === "rename" && <RenameTab targets={targets} onDone={close} />}
      {tab === "convert" && <ConvertTab targets={targets.filter((t) => t.kind === "image")} />}
      {tab === "favorite" && <FavoriteTab targets={targets} />}
      {tab === "inspect" && <InspectTab targets={targets.filter((t) => t.kind === "image")} />}
    </Dialog>
  );
}

type Targets = ReturnType<typeof visibleSnapshot>;

function RenameTab({ targets, onDone }: { targets: Targets; onDone: () => void }) {
  const probes = useLibrary((s) => s.probes);
  const [pattern, setPattern] = useState("{name}");
  const [start, setStart] = useState(1);
  const [plan, setPlan] = useState<RenamePlan[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .planBatchRename(
          targets.map((i) => ({ path: i.path, modified: i.modified, captured: probes.get(i.path)?.captured ?? null })),
          pattern,
          start,
          true,
        )
        .then(setPlan, () => {});
    }, 150);
    return () => clearTimeout(t);
  }, [pattern, start, targets, probes]);

  const conflicts = plan.filter((p) => p.conflict).length;
  const changes = plan.filter((p) => basename(p.source) !== p.newName).length;

  const run = async () => {
    if (!(await confirmDialog({ title: `Rename ${changes} files?`, message: "Files are renamed in place. Live Photo motion files are not renamed by batch rename.", confirmLabel: "Rename" }))) return;
    setBusy(true);
    try {
      const res = await api.runBatchRename(plan.filter((p) => basename(p.source) !== p.newName));
      const failed = res.filter((r) => r.error);
      toast({ kind: failed.length ? "error" : "success", title: `Renamed ${res.length - failed.length} files${failed.length ? `, ${failed.length} failed` : ""}` });
      useLibrary.getState().refresh();
      onDone();
    } catch (e) {
      toast({ kind: "error", title: "Rename failed", detail: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted">Pattern</span>
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Start number</span>
          <Input type="number" min={0} value={start} onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))} />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {["{name}", "{n}", "{n:4}", "{date}", "{captured}", "{ext}"].map((t) => (
          <button key={t} className="rounded border border-line px-1.5 py-0.5 font-mono text-muted hover:text-fg" onClick={() => setPattern((p) => p + t)}>
            {t}
          </button>
        ))}
        <span className="ml-1 self-center text-faint">The extension is kept unless {"{ext}"} is used.</span>
      </div>
      <div className="max-h-[300px] overflow-y-auto rounded-md border border-line">
        <table className="w-full text-[12px]">
          <tbody>
            {plan.slice(0, 500).map((p) => (
              <tr key={p.source} className="border-b border-line/50 last:border-0">
                <td className="max-w-0 truncate px-3 py-1 text-muted">{basename(p.source)}</td>
                <td className="w-6 text-faint">→</td>
                <td className={cn("max-w-0 truncate px-3 py-1", p.conflict ? "text-danger" : "text-fg")} title={p.conflict ?? undefined}>
                  {p.newName}
                  {p.conflict && <span className="ml-2 text-[11px]">({p.conflict})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <span className={cn("text-xs", conflicts ? "text-danger" : "text-muted")}>{conflicts ? `${conflicts} conflict${conflicts > 1 ? "s" : ""} – fix the pattern to continue` : `${changes} file${changes === 1 ? "" : "s"} will be renamed`}</span>
        <Button variant="primary" disabled={busy || conflicts > 0 || changes === 0} onClick={run}>
          {busy && <Spinner className="h-3.5 w-3.5" />} Rename
        </Button>
      </div>
    </div>
  );
}

function ConvertTab({ targets }: { targets: Targets }) {
  const [format, setFormat] = useState<ExportFormat>("jpeg");
  const [quality, setQuality] = useState(90);
  const [maxW, setMaxW] = useState("");
  const [maxH, setMaxH] = useState("");
  const [suffix, setSuffix] = useState("");
  const [dest, setDest] = useState<string | null>(null);
  const [applyEdits, setApplyEdits] = useState(true);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [results, setResults] = useState<OpResult[] | null>(null);

  const run = async () => {
    if (!dest) return;
    const id = newTaskId("convert");
    setTask(id);
    setResults(null);
    setProgress({ done: 0, total: targets.length });
    try {
      const res = await api.batchConvert(
        targets.map((t) => t.path),
        { format, quality, maxWidth: Number(maxW) || null, maxHeight: Number(maxH) || null, destDir: dest, suffix },
        applyEdits,
        id,
        setProgress,
      );
      setResults(res);
    } catch (e) {
      toast({ kind: "error", title: "Conversion failed", detail: errorMessage(e) });
    } finally {
      setTask(null);
    }
  };
  const failed = results?.filter((r) => r.error) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted">Format</span>
          <Select
            className="w-full"
            value={format}
            onChange={setFormat}
            options={[
              { value: "jpeg", label: "JPEG" },
              { value: "png", label: "PNG" },
              { value: "webp", label: "WebP (lossless)" },
              { value: "tiff", label: "TIFF" },
              { value: "bmp", label: "BMP" },
            ]}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">JPEG quality</span>
          <Select className="w-full" value={quality} onChange={setQuality} options={[100, 95, 90, 85, 80, 70, 60].map((q) => ({ value: q, label: String(q) }))} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Max width (px, optional)</span>
          <Input inputMode="numeric" placeholder="Original" value={maxW} onChange={(e) => setMaxW(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Max height (px, optional)</span>
          <Input inputMode="numeric" placeholder="Original" value={maxH} onChange={(e) => setMaxH(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">File name suffix</span>
          <Input placeholder="e.g. _web" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
        </label>
        <div className="space-y-1">
          <span className="text-xs text-muted">Destination folder</span>
          <Button
            className="w-full justify-start truncate"
            onClick={async () => {
              const d = await openDialog({ directory: true, title: "Export to folder" });
              if (typeof d === "string") setDest(d);
            }}
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            <span className="truncate">{dest ?? "Choose…"}</span>
          </Button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <Switch checked={applyEdits} onChange={setApplyEdits} /> Apply saved non-destructive edits
      </label>
      <p className="text-xs text-faint">Originals are never modified. Existing files are never overwritten; a numbered name is used instead. Images are never upscaled.</p>
      {progress && (
        <div className="space-y-1">
          <ProgressBar value={progress.done} total={progress.total} />
          <div className="text-xs text-muted">
            {progress.done} / {progress.total}
          </div>
        </div>
      )}
      {results && (
        <div className={cn("rounded-md p-2 text-xs", failed.length ? "bg-danger/10 text-danger" : "bg-success/10 text-success")}>
          {results.length - failed.length} exported{failed.length > 0 && `, ${failed.length} failed: ${failed.slice(0, 3).map((f) => `${basename(f.source)} (${f.error})`).join("; ")}`}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {task && <Button onClick={() => api.cancelTask(task)}>Cancel</Button>}
        <Button variant="primary" disabled={!dest || !!task || targets.length === 0} onClick={run}>
          {task && <Spinner className="h-3.5 w-3.5" />} Export {targets.length} image{targets.length === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}

function FavoriteTab({ targets }: { targets: Targets }) {
  const setFavorite = useLibrary((s) => s.setFavorite);
  const favs = useLibrary((s) => s.favorites);
  const count = targets.filter((t) => favs.has(t.path)).length;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">
        {count} of {targets.length} items are favorites.
      </p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => setFavorite(targets.map((t) => t.path), true)}>
          <Star className="h-4 w-4" /> Favorite all
        </Button>
        <Button onClick={() => setFavorite(targets.map((t) => t.path), false)}>
          <StarOff className="h-4 w-4" /> Unfavorite all
        </Button>
      </div>
    </div>
  );
}

function InspectTab({ targets }: { targets: Targets }) {
  const LIMIT = 300;
  const [rows, setRows] = useState<ImageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setRows([]);
    setLoading(true);
    (async () => {
      const list = targets.slice(0, LIMIT);
      for (let i = 0; i < list.length && alive; i += 8) {
        const chunk = await Promise.all(list.slice(i, i + 8).map((t) => api.getImageInfo(t.path).catch(() => null)));
        if (alive) setRows((r) => [...r, ...(chunk.filter(Boolean) as ImageInfo[])]);
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [targets]);

  return (
    <div className="space-y-2">
      {targets.length > LIMIT && <p className="text-xs text-faint">Showing the first {LIMIT} items.</p>}
      <div className="max-h-[420px] overflow-auto rounded-md border border-line">
        <table className="w-full whitespace-nowrap text-[12px]">
          <thead className="sticky top-0 bg-raised text-left text-muted">
            <tr>
              {["Name", "Size", "Dimensions", "Camera", "Lens", "Exposure", "ISO", "Captured", "GPS"].map((h) => (
                <th key={h} className="px-3 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.path} className="border-t border-line/50">
                <td className="max-w-[200px] truncate px-3 py-1">{r.name}</td>
                <td className="px-3 py-1 text-muted">{formatBytes(r.fileSize)}</td>
                <td className="px-3 py-1 text-muted">{r.width ? `${r.width}×${r.height}` : "—"}</td>
                <td className="px-3 py-1 text-muted">{[r.camera.make, r.camera.model].filter(Boolean).join(" ") || "—"}</td>
                <td className="max-w-[160px] truncate px-3 py-1 text-muted">{r.camera.lens ?? "—"}</td>
                <td className="px-3 py-1 text-muted">{[r.camera.aperture && `ƒ/${r.camera.aperture.toFixed(1)}`, r.camera.exposureTime].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-3 py-1 text-muted">{r.camera.iso ?? "—"}</td>
                <td className="px-3 py-1 text-muted">{r.camera.captured ?? "—"}</td>
                <td className="px-3 py-1 text-muted">{r.camera.gps ? "Yes" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Spinner className="h-3 w-3" /> Reading metadata… {rows.length}/{Math.min(LIMIT, targets.length)}
        </div>
      )}
    </div>
  );
}

export { formatCaptured };
