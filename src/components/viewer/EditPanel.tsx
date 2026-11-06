import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Crop, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, Save, Upload, X } from "lucide-react";
import { useState } from "react";
import { DEFAULT_EDIT, isIdentity, sharpenKernel, temperatureGains } from "../../engines/editPreview";
import { api, errorMessage } from "../../lib/api";
import { cn, stem } from "../../lib/format";
import type { EditParams, ExportFormat, MediaItem } from "../../lib/types";
import { toast, useUi } from "../../store/ui";
import { Button, Select, Slider } from "../ui/primitives";

/** SVG filters referenced by the CSS filter preview. Rendered once in the viewer. */
export function EditFilterDefs({ edit }: { edit: EditParams | null }) {
  const t = temperatureGains(edit?.temperature ?? 0);
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <defs>
        <filter id="lumen-temperature" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={`${t.r} 0 0 0 0  0 1 0 0 0  0 0 ${t.b} 0 0  0 0 0 1 0`} />
        </filter>
        <filter id="lumen-sharpen" colorInterpolationFilters="sRGB">
          <feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix={sharpenKernel(edit?.sharpness ?? 0)} />
        </filter>
      </defs>
    </svg>
  );
}

const sliders: { key: keyof EditParams; label: string; min: number; max: number; fmt: (v: number) => string }[] = [
  { key: "exposure", label: "Exposure", min: -3, max: 3, fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV` },
  { key: "brightness", label: "Brightness", min: -1, max: 1, fmt: (v) => `${Math.round(v * 100)}` },
  { key: "contrast", label: "Contrast", min: -1, max: 1, fmt: (v) => `${Math.round(v * 100)}` },
  { key: "saturation", label: "Saturation", min: -1, max: 1, fmt: (v) => `${Math.round(v * 100)}` },
  { key: "temperature", label: "Temperature", min: -1, max: 1, fmt: (v) => (v === 0 ? "0" : v > 0 ? `Warm ${Math.round(v * 100)}` : `Cool ${Math.round(-v * 100)}`) },
  { key: "sharpness", label: "Sharpness", min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}` },
];

export function EditPanel({
  item,
  edit,
  onChange,
  cropMode,
  setCropMode,
  saved,
  onSaved,
  onClose,
}: {
  item: MediaItem;
  edit: EditParams;
  onChange: (p: EditParams) => void;
  cropMode: boolean;
  setCropMode: (v: boolean) => void;
  saved: EditParams | null;
  onSaved: (p: EditParams | null) => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("jpeg");
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(edit) !== JSON.stringify(saved ?? DEFAULT_EDIT);
  const set = (patch: Partial<EditParams>) => onChange({ ...edit, ...patch });

  const saveEdits = async () => {
    await api.saveEdit(item.path, isIdentity(edit) ? null : edit);
    onSaved(isIdentity(edit) ? null : edit);
    toast({ kind: "success", title: "Edits saved", detail: "The original file is unchanged. Use Export to write an edited copy." }, 3500);
  };

  const exportCopy = async () => {
    const ext = { jpeg: "jpg", png: "png", webp: "webp", tiff: "tif", bmp: "bmp" }[format];
    const dir = item.path.slice(0, item.path.length - item.name.length);
    const dest = await saveDialog({ title: "Export edited copy", defaultPath: `${dir}${stem(item.name)}_edited.${ext}`, filters: [{ name: format.toUpperCase(), extensions: [ext] }] });
    if (!dest) return;
    if (dest === item.path) return toast({ kind: "error", title: "Choose a different name", detail: "ENViewer never overwrites the original." });
    setBusy(true);
    const tid = toast({ kind: "progress", title: "Exporting…" });
    try {
      const out = await api.exportImage(item.path, isIdentity(edit) ? null : edit, dest, format, quality);
      useUi.getState().updateToast(tid, { kind: "success", title: "Exported", detail: out, action: { label: "Show", run: () => api.revealInFolder(out) } });
    } catch (e) {
      useUi.getState().updateToast(tid, { kind: "error", title: "Export failed", detail: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col viewer-panel border-l text-vfg animate-fade-in" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex h-12 items-center justify-between border-b border-vfg/10 px-4">
        <span className="text-[13px] font-semibold">Edit</span>
        <button onClick={onClose} className="rounded p-1 text-vfg/60 hover:bg-vfg/10 hover:text-vfg" aria-label="Close editor">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 [--line:70_70_76]">
        <p className="rounded-md bg-vfg/5 px-3 py-2 text-[11px] leading-relaxed text-vfg/60">Edits are non-destructive. The original file is never modified; export to create an edited copy.</p>
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-vfg/45">Geometry</div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="subtle" className={cn("bg-vfg/10 text-vfg hover:bg-vfg/15", cropMode && "bg-accent hover:bg-accent")} onClick={() => setCropMode(!cropMode)}>
              <Crop className="h-3.5 w-3.5" /> {cropMode ? "Done" : "Crop"}
            </Button>
            <Button size="sm" variant="subtle" className="bg-vfg/10 text-vfg hover:bg-vfg/15" onClick={() => set({ rotate: (edit.rotate + 3) % 4 })} title="Rotate left">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="subtle" className="bg-vfg/10 text-vfg hover:bg-vfg/15" onClick={() => set({ rotate: (edit.rotate + 1) % 4 })} title="Rotate right">
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="subtle" className={cn("bg-vfg/10 text-vfg hover:bg-vfg/15", edit.flipH && "text-accent")} onClick={() => set({ flipH: !edit.flipH })} title="Flip horizontal">
              <FlipHorizontal2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="subtle" className={cn("bg-vfg/10 text-vfg hover:bg-vfg/15", edit.flipV && "text-accent")} onClick={() => set({ flipV: !edit.flipV })} title="Flip vertical">
              <FlipVertical2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {cropMode && <p className="mt-2 text-[11px] text-vfg/50">Drag the corners or edges. The crop is shown in the original orientation and applied before rotation.</p>}
          {edit.crop && !cropMode && (
            <button className="mt-2 text-[11px] text-accent hover:underline" onClick={() => set({ crop: null })}>
              Remove crop
            </button>
          )}
        </div>
        <div className="space-y-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-vfg/45">Adjust</div>
          {sliders.map((s) => (
            <div key={s.key}>
              <div className="mb-1 flex justify-between text-[12px]">
                <button className="text-vfg/80 hover:text-vfg" onDoubleClick={() => set({ [s.key]: 0 } as Partial<EditParams>)} title="Double-click to reset">
                  {s.label}
                </button>
                <span className="tabular-nums text-vfg/50">{s.fmt(edit[s.key] as number)}</span>
              </div>
              <Slider dark value={edit[s.key] as number} min={s.min} max={s.max} step={0.01} onChange={(v) => set({ [s.key]: Math.abs(v) < 0.015 ? 0 : v } as Partial<EditParams>)} />
            </div>
          ))}
          <p className="text-[11px] text-vfg/40">Sharpening is approximated in the preview; the export uses a full unsharp mask.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="subtle" className="flex-1 bg-vfg/10 text-vfg hover:bg-vfg/15" disabled={isIdentity(edit)} onClick={() => onChange(DEFAULT_EDIT)}>
            Reset all
          </Button>
          <Button size="sm" variant="primary" className="flex-1" disabled={!dirty} onClick={saveEdits}>
            <Save className="h-3.5 w-3.5" /> Save edits
          </Button>
        </div>
        <div className="space-y-2 border-t border-vfg/10 pt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-vfg/45">Export copy</div>
          <div className="flex gap-2">
            <Select
              className="flex-1 border-vfg/15 bg-vfg/5 text-vfg"
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
            {format === "jpeg" && (
              <Select
                className="w-24 border-vfg/15 bg-vfg/5 text-vfg"
                value={quality}
                onChange={setQuality}
                options={[100, 95, 92, 85, 75, 60].map((q) => ({ value: q, label: `Q ${q}` }))}
              />
            )}
          </div>
          <Button size="sm" variant="subtle" className="w-full bg-vfg/10 text-vfg hover:bg-vfg/15" disabled={busy} onClick={exportCopy}>
            <Upload className="h-3.5 w-3.5" /> Export…
          </Button>
          <p className="text-[11px] text-vfg/40">Exports are rendered from the full-resolution original. Metadata is not copied.</p>
        </div>
      </div>
    </aside>
  );
}
