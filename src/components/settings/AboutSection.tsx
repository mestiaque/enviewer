import { getVersion } from "@tauri-apps/api/app";
import { Copy, ExternalLink, FolderOpen } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import appIcon from "../../assets/enviewer-icon.svg";
import { api } from "../../lib/api";
import type { CacheStats } from "../../lib/types";
import { useLibrary } from "../../store/library";
import { toast } from "../../store/ui";
import { Button } from "../ui/primitives";

type About = Awaited<ReturnType<typeof api.aboutInfo>>;

const PLATFORM: Record<string, string> = { linux: "Linux", windows: "Windows", macos: "macOS" };
const LIBRARIES: [string, string, string][] = [
  ["Tauri", "desktop shell", "MIT / Apache-2.0"],
  ["Rust · image · zune", "image decoding", "MIT / Apache-2.0"],
  ["libheif", "HEIC / HEIF (iPhone photos)", "LGPL-3.0, dynamically linked"],
  ["rawler", "camera RAW", "LGPL-2.1"],
  ["jxl-oxide · resvg", "JPEG XL · SVG", "MIT / Apache-2.0 · MPL-2.0"],
  ["BLAKE3 · SQLite", "thumbnail cache · library data", "CC0 / Apache-2.0 · public domain"],
  ["React · Radix UI · zustand", "interface", "MIT"],
  ["Tailwind CSS · Lucide", "styling · icons", "MIT · ISC"],
];

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section>
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{title}</div>
    <div className="divide-y divide-line rounded-lg bg-raised px-3">{children}</div>
  </section>
);
const Row = ({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-2.5">
    <span className="min-w-0">
      {label}
      {hint && <span className="block truncate text-[11px] text-faint">{hint}</span>}
    </span>
    {children}
  </div>
);

export function AboutSection() {
  const { heifVersion } = useLibrary();
  const [version, setVersion] = useState("");
  const [about, setAbout] = useState<About | null>(null);
  const [paths, setPaths] = useState<{ data: string; cache: string; logs: string } | null>(null);
  const [stats, setStats] = useState<CacheStats | null>(null);
  useEffect(() => {
    getVersion().then(setVersion, () => {});
    api.aboutInfo().then(setAbout, () => {});
    api.appPaths().then(setPaths, () => {});
    api.cacheStats().then(setStats, () => {});
  }, []);

  const open = (path: string | undefined, what: string) =>
    path && api.openExternal(path).catch((e) => toast({ kind: "error", title: `Could not open ${what}`, detail: String(e) }));

  const copyDiagnostics = async () => {
    const text = [
      `ENViewer ${version}${about ? ` (${about.build})` : ""}`,
      about ? `${PLATFORM[about.platform] ?? about.platform} ${about.arch}` : "",
      about ? `Tauri ${about.tauriVersion} · WebView ${about.webviewVersion || "unknown"}` : "",
      `HEIF: ${heifVersion ? `libheif ${heifVersion}` : "not built in"}`,
    ]
      .filter(Boolean)
      .join("\n");
    await navigator.clipboard.writeText(text);
    toast({ kind: "success", title: "Diagnostics copied", detail: "Paste them into your bug report" });
  };

  const mono = "font-mono text-[12px] text-muted";
  return (
    <div className="space-y-5 py-4 text-[13px]">
      <div className="flex items-center gap-4">
        <img src={appIcon} alt="" className="h-16 w-16" draggable={false} />
        <div>
          <div className="text-lg font-semibold">
            ENViewer <span className="font-normal text-muted">{version}</span>
          </div>
          <div className="text-muted">A fast, offline image viewer and photo browser.</div>
          <div className="mt-1 text-[11px] text-faint">HEIC, RAW, JPEG XL, Live Photos and more; your photos never leave this computer.</div>
        </div>
      </div>

      <div>
        <Section title="This copy">
          <Row label="Version">
            <span className={mono}>
              {version} {about?.build === "debug" && <span className="ml-1 rounded bg-amber-500/20 px-1 text-amber-500">debug build</span>}
            </span>
          </Row>
          <Row label="System">
            <span className="text-muted">{about ? `${PLATFORM[about.platform] ?? about.platform} · ${about.arch}` : "…"}</span>
          </Row>
          <Row label="Tauri · WebView">
            <span className={mono}>{about ? `${about.tauriVersion} · ${about.webviewVersion || "unknown"}` : "…"}</span>
          </Row>
          <Row label="HEIC / HEIF decoder">
            <span className="text-muted">{heifVersion ? `libheif ${heifVersion}` : "not built in"}</span>
          </Row>
          <Row label="Library and settings" hint={paths?.data}>
            <Button size="sm" onClick={() => open(paths?.data, "the data folder")}>
              <FolderOpen className="h-3.5 w-3.5" />
              Open
            </Button>
          </Row>
          <Row label="Thumbnail cache" hint={stats ? `${stats.dir}` : paths?.cache}>
            <Button size="sm" onClick={() => open(stats?.dir ?? paths?.cache, "the cache folder")}>
              <FolderOpen className="h-3.5 w-3.5" />
              Open
            </Button>
          </Row>
          <Row label="Logs" hint={paths?.logs}>
            <Button size="sm" onClick={() => open(paths?.logs, "the logs folder")}>
              <FolderOpen className="h-3.5 w-3.5" />
              Open
            </Button>
          </Row>
        </Section>
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => void copyDiagnostics()}>
            <Copy className="h-3.5 w-3.5" />
            Copy diagnostics
          </Button>
        </div>
      </div>

      <Section title="Developer">
        <Row label="Developed by">
          <span className="text-muted">M. Estiaque Ahmed Khan</span>
        </Row>
        <Row label="Contact" hint="Bug reports, ideas and feedback are welcome">
          <button className="text-accent hover:underline" onClick={() => api.contactDeveloper().catch(() => toast({ kind: "error", title: "No mail app found", detail: "info@mestiaque.com" }))}>
            info@mestiaque.com
          </button>
        </Row>
        <Row label="Website">
          <button className="flex items-center gap-1 text-accent hover:underline" onClick={() => void api.openDeveloperWebsite().catch(() => {})}>
            mestiaque.com
            <ExternalLink className="h-3 w-3" />
          </button>
        </Row>
        <Row label="Also by the developer" hint="Same look and themes">
          <span className="text-muted">ENPlayer · ENDownloader · ENPost</span>
        </Row>
        <Row label="Licence">
          <span className="text-muted">© 2026 M. Estiaque Ahmed Khan · MIT</span>
        </Row>
      </Section>

      <Section title="Built with">
        {LIBRARIES.map(([name, what, licence]) => (
          <div key={name} className="flex items-center justify-between gap-4 py-2 text-[12px]">
            <span>
              {name} <span className="text-faint">· {what}</span>
            </span>
            <span className="text-faint">{licence}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}
