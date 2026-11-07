import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { cn, formatBytes } from "../../lib/format";
import type { CacheStats } from "../../lib/types";
import { useLibrary } from "../../store/library";
import { useSettings, type Settings } from "../../store/settings";
import { confirmDialog, toast, useUi } from "../../store/ui";
import { Dialog } from "../ui/overlays";
import { Button, Select, Slider, Switch } from "../ui/primitives";
import appIcon from "../../assets/enviewer-icon.svg";
import { useUpdate } from "../../store/update";

const SECTIONS = [
  ["general", "General"],
  ["appearance", "Appearance"],
  ["viewer", "Viewer"],
  ["performance", "Performance"],
  ["formats", "File formats"],
  ["privacy", "Privacy"],
  ["about", "About"],
] as const;

const THEME_CARDS: { id: Settings["theme"]; label: string; bg: string; side: string; bar: string; tile: string }[] = [
  { id: "dark", label: "Dark", bg: "#131315", side: "#19191c", bar: "#2c2c32", tile: "#222226" },
  { id: "light", label: "Light", bg: "#f4f4f6", side: "#fcfcfd", bar: "#dcdce2", tile: "#ffffff" },
  {
    id: "glass",
    label: "Glass",
    bg: "radial-gradient(circle at 15% 20%, rgba(139,108,255,.9), transparent 55%), radial-gradient(circle at 90% 10%, rgba(226,64,122,.8), transparent 50%), radial-gradient(circle at 70% 95%, rgba(56,189,248,.75), transparent 55%), #1a1530",
    side: "rgba(255,255,255,.14)",
    bar: "rgba(255,255,255,.3)",
    tile: "rgba(255,255,255,.18)",
  },
  { id: "system", label: "System", bg: "linear-gradient(135deg, #f4f4f6 50%, #131315 50%)", side: "rgba(127,127,127,.25)", bar: "rgba(127,127,127,.4)", tile: "rgba(127,127,127,.3)" },
];

/** Theme picker with small previews (same design as NEPLAYER's). */
function ThemeCards({ value, onChange }: { value: Settings["theme"]; onChange: (v: Settings["theme"]) => void }) {
  return (
    <div className="border-b border-line/60 py-3">
      <div className="text-[13px]">Theme</div>
      <div className="mt-2.5 grid grid-cols-4 gap-3">
        {THEME_CARDS.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "rounded-[10px] border p-2 pb-1.5 text-[12px] transition-colors",
              value === t.id ? "border-accent bg-accent/[0.07] text-fg ring-1 ring-accent" : "border-line text-muted hover:border-faint",
            )}
          >
            <div className="flex h-[70px] overflow-hidden rounded-md border border-black/10" style={{ background: t.bg }}>
              <div className="w-[26%]" style={{ background: t.side }} />
              <div className="flex flex-1 flex-col gap-1.5 p-1.5">
                <div className="h-2 rounded-sm" style={{ background: t.bar }} />
                <div className="grid flex-1 grid-cols-3 gap-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="rounded-[3px]" style={{ background: t.tile }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-1.5">{t.label}</div>
          </button>
        ))}
      </div>
      <div className="mt-2 text-[11px] text-faint">Glass uses frosted, blurred panels over a colour gradient.</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line/60 py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function UpdateRow() {
  const check = useUpdate((u) => u.check);
  const checking = useUpdate((u) => u.checking);
  const [status, setStatus] = useState("");
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  return (
    <Field label="Updates" hint={status || `You have version ${version}`}>
      <Button size="sm" disabled={checking} onClick={async () => setStatus(await check(true))}>
        {checking ? "Checking…" : "Check now"}
      </Button>
    </Field>
  );
}

function Toggle<K extends keyof Settings>({ k, label, hint }: { k: K; label: string; hint?: string }) {
  const { settings, set } = useSettings();
  return (
    <Field label={label} hint={hint}>
      <Switch checked={settings[k] as boolean} onChange={(v) => set(k, v as Settings[K])} />
    </Field>
  );
}

const ACCENTS = ["#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4"];

export function SettingsDialog() {
  const open = useUi((s) => s.dialog === "settings");
  const section = useUi((s) => s.settingsSection);
  const { settings: s, set } = useSettings();
  const { formats, heifVersion } = useLibrary();
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [version, setVersion] = useState("");
  const [paths, setPaths] = useState<{ data: string; cache: string; logs: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    api.cacheStats().then(setStats, () => {});
    getVersion().then(setVersion, () => {});
    api.appPaths().then(setPaths, () => {});
  }, [open, section]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && useUi.getState().openDialog(null)} title="Settings" className="h-[min(640px,88vh)] w-[min(820px,94vw)]">
      <div className="-mx-5 -my-4 flex h-full min-h-[480px]">
        <nav className="w-44 shrink-0 space-y-0.5 border-r border-line p-2">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => useUi.setState({ settingsSection: id })}
              className={cn("block h-8 w-full rounded-md px-3 text-left text-[13px]", section === id ? "bg-accent/15 text-fg" : "text-muted hover:bg-raised hover:text-fg")}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-2">
          {section === "general" && (
            <>
              <Field label="On startup" hint="What ENViewer shows when it starts">
                <Select
                  value={s.startup}
                  onChange={(v) => set("startup", v)}
                  options={[
                    { value: "home", label: "Home" },
                    { value: "lastFolder", label: "Last folder" },
                    { value: "defaultLocation", label: "Default location" },
                  ]}
                />
              </Field>
              <Field label="Default location" hint={s.defaultLocation ?? "Not set (uses Pictures)"}>
                <Button
                  size="sm"
                  onClick={async () => {
                    const d = await openDialog({ directory: true });
                    if (typeof d === "string") set("defaultLocation", d);
                  }}
                >
                  Choose…
                </Button>
              </Field>
              <Toggle k="rememberLastFolder" label="Remember last folder" />
              <Toggle k="showHidden" label="Show hidden files and folders" />
              <Toggle k="alwaysOnTop" label="Always on top" hint="Keep ENViewer above other windows" />
              <Toggle k="confirmTrash" label="Confirm before moving to Trash" hint="Files always go to the system Trash, never deleted permanently" />
              <Field label="Default viewer zoom">
                <Select
                  value={s.defaultZoom}
                  onChange={(v) => set("defaultZoom", v)}
                  options={[
                    { value: "fitLarge", label: "Fit, don’t upscale small images" },
                    { value: "fit", label: "Always fit to screen" },
                    { value: "actual", label: "Actual size (100%)" },
                  ]}
                />
              </Field>
              <Toggle k="checkUpdates" label="Check for updates automatically" hint="Looks for a new ENViewer release on GitHub once a day" />
              <UpdateRow />
            </>
          )}

          {section === "appearance" && (
            <>
              <ThemeCards value={s.theme} onChange={(v) => set("theme", v)} />
              <Field label="Accent color">
                <div className="flex gap-1.5">
                  {ACCENTS.map((c) => (
                    <button key={c} onClick={() => set("accent", c)} className="flex h-6 w-6 items-center justify-center rounded-full ring-offset-2 ring-offset-panel" style={{ background: c, boxShadow: s.accent === c ? `0 0 0 2px ${c}` : undefined }} aria-label={c}>
                      {s.accent === c && <Check className="h-3.5 w-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Thumbnail size">
                <Select
                  value={s.gridSize}
                  onChange={(v) => set("gridSize", v)}
                  options={[
                    { value: "small", label: "Small" },
                    { value: "medium", label: "Medium" },
                    { value: "large", label: "Large" },
                  ]}
                />
              </Field>
              <Field label="Grid layout" hint="Justified keeps each photo’s aspect ratio">
                <Select
                  value={s.gridLayout}
                  onChange={(v) => set("gridLayout", v)}
                  options={[
                    { value: "grid", label: "Square grid" },
                    { value: "justified", label: "Justified" },
                  ]}
                />
              </Field>
              <Toggle k="showFilenames" label="Show file names under thumbnails" />
              <Toggle k="livePhotoHover" label="Play Live Photos on hover" />
              <Toggle k="animations" label="Animations" hint="Turn off to reduce motion" />
            </>
          )}

          {section === "viewer" && (
            <>
              <Field label="Viewer style" hint="Applies to the image viewer and the video player">
                <Select
                  value={s.viewerTheme}
                  onChange={(v) => set("viewerTheme", v)}
                  options={[
                    { value: "dark", label: "Dark" },
                    { value: "light", label: "Light" },
                    { value: "glass", label: "Glass (frosted)" },
                  ]}
                />
              </Field>
              <Field label="Mouse wheel zoom speed" hint={`${Math.round(s.zoomSpeed * 100)}% per wheel notch`}>
                <div className="w-48">
                  <Slider value={s.zoomSpeed} min={0.05} max={0.6} step={0.01} onChange={(v) => set("zoomSpeed", Math.round(v * 100) / 100)} />
                </div>
              </Field>
              <Toggle k="smoothZoom" label="Smooth zoom" hint="Animate wheel zoom; the point under the cursor stays fixed" />
              <Field label="Minimum zoom">
                <Select value={s.minZoom} onChange={(v) => set("minZoom", v)} options={[1, 2, 5, 10, 25].map((v) => ({ value: v, label: `${v}%` }))} />
              </Field>
              <Field label="Maximum zoom">
                <Select value={s.maxZoom} onChange={(v) => set("maxZoom", v)} options={[800, 1600, 3200, 6400].map((v) => ({ value: v, label: `${v}%` }))} />
              </Field>
              <Toggle k="pixelatedZoom" label="Show pixels sharply at high zoom" hint="Nearest-neighbour rendering above 300%" />
              <Field label="Background" hint="Used by the Dark viewer style">
                <Select
                  value={s.viewerBackground}
                  onChange={(v) => set("viewerBackground", v)}
                  options={[
                    { value: "black", label: "Black" },
                    { value: "dark", label: "Charcoal" },
                    { value: "gray", label: "Gray" },
                    { value: "checker", label: "Checkerboard" },
                    { value: "theme", label: "Follow theme" },
                  ]}
                />
              </Field>
              <Toggle k="wrapNavigation" label="Wrap around at the first/last image" />
              <Toggle k="mouseSideButtons" label="Mouse back/forward buttons navigate images" />
              <Toggle k="touchpadSwipe" label="Horizontal touchpad swipe navigates images" hint="When the image is not zoomed past the window" />
              <Toggle k="autoHideControls" label="Auto-hide viewer controls" />
            </>
          )}

          {section === "performance" && (
            <>
              <Field label="Thumbnail cache size" hint={stats ? `Using ${formatBytes(stats.bytes)} for ${stats.entries.toLocaleString()} thumbnails` : undefined}>
                <Select value={s.thumbCacheMb} onChange={(v) => set("thumbCacheMb", v)} options={[256, 512, 1024, 2048, 4096, 8192].map((v) => ({ value: v, label: formatBytes(v * 1024 * 1024) }))} />
              </Field>
              <Field label="Decoded image memory cache" hint="For HEIC, RAW, TIFF and other formats decoded by ENViewer">
                <Select value={s.memoryCacheMb} onChange={(v) => set("memoryCacheMb", v)} options={[128, 256, 512, 1024, 2048].map((v) => ({ value: v, label: formatBytes(v * 1024 * 1024) }))} />
              </Field>
              <Field label="Preload neighbouring images" hint="In each direction while viewing">
                <Select value={s.preloadCount} onChange={(v) => set("preloadCount", v)} options={[0, 1, 2, 3].map((v) => ({ value: v, label: v === 0 ? "Off" : String(v) }))} />
              </Field>
              <Field label="Thumbnail cache" hint={stats?.dir}>
                <Button
                  size="sm"
                  onClick={async () => {
                    if (await confirmDialog({ title: "Clear thumbnail cache?", message: "Thumbnails will be regenerated as you browse.", confirmLabel: "Clear" })) {
                      await api.clearThumbnailCache();
                      setStats(await api.cacheStats());
                      toast({ kind: "success", title: "Thumbnail cache cleared" });
                    }
                  }}
                >
                  Clear cache
                </Button>
              </Field>
            </>
          )}

          {section === "formats" && (
            <>
              <Field label="RAW display" hint="Embedded preview is fast and matches the camera; full develop demosaics the sensor data">
                <Select
                  value={s.rawMode}
                  onChange={(v) => set("rawMode", v)}
                  options={[
                    { value: "embedded", label: "Embedded preview" },
                    { value: "develop", label: "Full RAW develop" },
                  ]}
                />
              </Field>
              <div className="py-3 text-[11px] text-faint">HEIC/HEIF decoder: {heifVersion ? `libheif ${heifVersion}` : "not available in this build"}</div>
              <table className="w-full text-[12px]">
                <thead className="text-left text-faint">
                  <tr>
                    <th className="py-1 font-medium">Format</th>
                    <th className="py-1 font-medium">Extensions</th>
                    <th className="py-1 font-medium">Decoder</th>
                    <th className="py-1 font-medium">Status</th>
                    <th className="py-1 text-right font-medium">Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {formats.filter((f) => f.kind === "image").map((f) => (
                    <tr key={f.id} className="border-t border-line/60" title={f.notes}>
                      <td className="py-1.5 pr-2">{f.name}</td>
                      <td className="py-1.5 pr-2 font-mono text-[11px] text-muted">{f.extensions.join(" ")}</td>
                      <td className="py-1.5 pr-2 text-muted">{f.webviewNative ? `WebView${f.decoder === "video" ? "" : ` + ${f.decoder}`}` : f.decoder}</td>
                      <td className="py-1.5 pr-2">{f.available ? <Check className="h-3.5 w-3.5 text-success" /> : <X className="h-3.5 w-3.5 text-danger" />}</td>
                      <td className="py-1.5 text-right">
                        <Switch
                          checked={!s.disabledFormats.includes(f.id)}
                          onChange={(on) => set("disabledFormats", on ? s.disabledFormats.filter((x) => x !== f.id) : [...s.disabledFormats, f.id])}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {section === "privacy" && (
            <>
              <Toggle k="keepHistory" label="Keep recently viewed history" />
              <Field label="History">
                <Button
                  size="sm"
                  onClick={async () => {
                    await api.clearRecents();
                    useLibrary.getState().refreshRecentFolders();
                    toast({ kind: "success", title: "History cleared" });
                  }}
                >
                  Clear history
                </Button>
              </Field>
              <Toggle k="showGps" label="Show GPS location in image information" />
              <div className="mt-4 rounded-lg bg-raised p-3 text-[12px] leading-relaxed text-muted">
                ENViewer works offline. It never uploads your images or metadata anywhere; the only network request is the optional update check (General → Check for updates), which asks GitHub for the latest version number; duplicate and similar-image detection run on this computer. Viewing, rotating or editing never modifies your original files.
              </div>
            </>
          )}

          {section === "about" && (
            <div className="space-y-2 py-3 text-[13px]">
              <div className="flex items-center gap-3.5 pb-2">
                <img src={appIcon} alt="" className="h-16 w-16" draggable={false} />
                <div>
                  <div className="text-lg font-semibold">ENViewer {version}</div>
                  <div className="text-muted">A fast, offline image viewer and photo browser.</div>
                </div>
              </div>
              <div className="pt-2 text-[12px] text-faint">HEIF decoder: {heifVersion ? `libheif ${heifVersion} (LGPL-3.0, dynamically linked)` : "not built in"}</div>
              <div className="text-[12px] text-faint">RAW decoding: rawler (LGPL-2.1) · JPEG XL: jxl-oxide · SVG: resvg</div>
              <div className="text-[12px] text-faint">Settings and library data: {paths?.data}</div>
              <div className="text-[12px] text-faint">Thumbnail cache: {stats?.dir}</div>
              <div className="text-[12px] text-faint">Logs: {paths?.logs}</div>
              <div className="pt-4 text-[11px] font-semibold uppercase tracking-wider text-faint">Developer</div>
              <div className="divide-y divide-line rounded-lg bg-raised px-3">
                <div className="flex items-center justify-between py-2.5">
                  <span>Developed by</span>
                  <span className="text-muted">M. Estiaque Ahmed Khan</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span>
                    Contact
                    <span className="block text-[11px] text-faint">Bug reports, ideas and feedback are welcome</span>
                  </span>
                  <button
                    className="text-accent hover:underline"
                    onClick={() => api.contactDeveloper().catch(() => toast({ kind: "error", title: "No mail app found", detail: "info@mestiaque.com" }))}
                  >
                    info@mestiaque.com
                  </button>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span>Website</span>
                  <button className="text-accent hover:underline" onClick={() => void api.openDeveloperWebsite().catch(() => {})}>
                    mestiaque.com
                  </button>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span>
                    Also by the developer
                    <span className="block text-[11px] text-faint">The matching video and music player</span>
                  </span>
                  <span className="text-muted">ENPlayer</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span>Copyright</span>
                  <span className="text-muted">© 2026 M. Estiaque Ahmed Khan · MIT</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
