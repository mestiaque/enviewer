import { Aperture, Camera, Copy, FileImage, MapPin, Palette, Tags, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { formatBytes, formatDate } from "../../lib/format";
import type { ImageInfo, MediaItem } from "../../lib/types";
import { useSettings } from "../../store/settings";
import { toast } from "../../store/ui";
import { Spinner } from "../ui/primitives";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="flex gap-3 py-1 text-[12px]">
      <div className="w-[104px] shrink-0 text-vfg/55">{label}</div>
      <div className="min-w-0 flex-1 break-words text-vfg/90">{value}</div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-vfg/10 px-4 py-3">
      <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-vfg/50">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

const orientationNames: Record<number, string> = {
  1: "Normal",
  2: "Mirrored horizontal",
  3: "Rotated 180°",
  4: "Mirrored vertical",
  5: "Mirrored, rotated 90° CCW",
  6: "Rotated 90° CW",
  7: "Mirrored, rotated 90° CW",
  8: "Rotated 90° CCW",
};

export function InfoPanel({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const showGps = useSettings((s) => s.settings.showGps);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setInfo(null);
    setError(null);
    const t = setTimeout(() => {
      api.getImageInfo(item.path).then(
        (i) => alive && setInfo(i),
        (e) => alive && setError(errorMessage(e)),
      );
    }, 80);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [item.path]);

  const c = info?.camera;
  const mp = info?.width && info?.height ? ((info.width * info.height) / 1e6).toFixed(1) : null;

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col viewer-panel border-l text-vfg animate-fade-in" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex h-12 items-center justify-between border-b border-vfg/10 px-4">
        <span className="text-[13px] font-semibold">Information</span>
        <button onClick={onClose} className="rounded p-1 text-vfg/60 hover:bg-vfg/10 hover:text-vfg" aria-label="Close information">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!info && !error && (
          <div className="flex items-center gap-2 p-4 text-xs text-vfg/60">
            <Spinner className="h-3.5 w-3.5" /> Reading metadata…
          </div>
        )}
        {error && <div className="p-4 text-xs text-danger">{error}</div>}
        {info && (
          <>
            <Section icon={<FileImage className="h-3.5 w-3.5" />} title="File">
              <Row label="Name" value={<span className="select-text">{info.name}</span>} />
              <Row label="Format" value={`${info.format}${info.extension ? ` (.${info.extension.toLowerCase()})` : ""}`} />
              <Row label="Size" value={`${formatBytes(info.fileSize)} (${info.fileSize.toLocaleString()} bytes)`} />
              <Row label="Dimensions" value={info.width && info.height ? `${info.width} × ${info.height} px${mp ? ` · ${mp} MP` : ""}` : null} />
              <Row label="Aspect ratio" value={info.aspectRatio} />
              <Row label="Modified" value={formatDate(info.modified)} />
              <Row label="Created" value={info.created ? formatDate(info.created) : null} />
              <Row label="Folder" value={<span className="select-text break-all text-vfg/70">{item.path.slice(0, item.path.length - item.name.length)}</span>} />
            </Section>

            {item.live && (
              <Section icon={<Zap className="h-3.5 w-3.5" />} title="Live Photo">
                <Row label="Motion file" value={item.live.video.split(/[\\/]/).pop()} />
                <Row label="Pairing" value={item.live.verified ? "Verified (content identifier match)" : "Matched by file name"} />
                <Row label="Content ID" value={info.livePhotoId && <span className="font-mono text-[11px]">{info.livePhotoId}</span>} />
              </Section>
            )}

            {c && (c.make || c.model || c.aperture || c.iso) && (
              <Section icon={<Camera className="h-3.5 w-3.5" />} title="Camera">
                <Row label="Camera" value={[c.make, c.model?.startsWith(c.make ?? "\u0000") ? c.model.slice((c.make ?? "").length).trim() : c.model].filter(Boolean).join(" ")} />
                <Row label="Lens" value={c.lens} />
                <div className="my-2 grid grid-cols-4 gap-1 rounded-lg bg-vfg/5 p-2 text-center text-[12px]">
                  <div>
                    <div className="text-vfg/45">
                      <Aperture className="mx-auto h-3 w-3" />
                    </div>
                    {c.aperture ? `ƒ/${c.aperture.toFixed(1)}` : "—"}
                  </div>
                  <div>
                    <div className="text-[10px] text-vfg/45">SHUTTER</div>
                    {c.exposureTime ?? "—"}
                  </div>
                  <div>
                    <div className="text-[10px] text-vfg/45">ISO</div>
                    {c.iso ?? "—"}
                  </div>
                  <div>
                    <div className="text-[10px] text-vfg/45">FOCAL</div>
                    {c.focalLength ? `${Math.round(c.focalLength)}mm` : "—"}
                  </div>
                </div>
                <Row label="35mm equiv." value={c.focalLength35mm ? `${c.focalLength35mm} mm` : null} />
                <Row label="Exposure comp." value={c.exposureCompensation != null ? `${c.exposureCompensation > 0 ? "+" : ""}${c.exposureCompensation.toFixed(1)} EV` : null} />
                <Row label="Program" value={c.exposureProgram} />
                <Row label="Metering" value={c.meteringMode} />
                <Row label="Flash" value={c.flash} />
                <Row label="White balance" value={c.whiteBalance} />
                <Row label="Captured" value={c.captured ? `${c.captured}${c.offsetTime ? ` (UTC${c.offsetTime})` : ""}` : null} />
                <Row label="Orientation" value={c.orientation ? orientationNames[c.orientation] ?? c.orientation : null} />
                <Row label="Software" value={c.software} />
              </Section>
            )}

            {c?.gps && (
              <Section icon={<MapPin className="h-3.5 w-3.5" />} title="Location">
                {showGps ? (
                  <>
                    <Row label="Latitude" value={c.gps.latitude.toFixed(6)} />
                    <Row label="Longitude" value={c.gps.longitude.toFixed(6)} />
                    <Row label="Altitude" value={c.gps.altitude != null ? `${c.gps.altitude.toFixed(1)} m` : null} />
                    <button
                      className="mt-1 flex items-center gap-1.5 text-[12px] text-accent hover:underline"
                      onClick={() => api.copyText(`${c.gps!.latitude.toFixed(6)}, ${c.gps!.longitude.toFixed(6)}`).then(() => toast({ kind: "success", title: "Coordinates copied" }, 2000))}
                    >
                      <Copy className="h-3 w-3" /> Copy coordinates
                    </button>
                  </>
                ) : (
                  <div className="text-[12px] text-vfg/50">Location data present (hidden by your privacy settings).</div>
                )}
              </Section>
            )}

            <Section icon={<Palette className="h-3.5 w-3.5" />} title="Color">
              <Row label="Color space" value={info.colorSpace ?? "Not specified (assumed sRGB)"} />
              <Row label="ICC profile" value={info.iccProfile ? `${info.iccProfile.description ?? "Embedded"} · ${formatBytes(info.iccProfile.size)}` : "None"} />
              <Row label="Bit depth" value={info.bitDepth ? `${info.bitDepth}-bit per channel` : null} />
              <Row label="Alpha" value={info.hasAlpha == null ? null : info.hasAlpha ? "Yes" : "No"} />
              <Row label="HDR" value={info.hdr} />
              <Row label="Animated" value={info.animated ? "Yes" : null} />
              <Row label="Depth maps" value={info.heif?.depthImages ? `${info.heif.depthImages} (portrait / depth data)` : null} />
              <Row label="Embedded thumb" value={info.embeddedThumbnail ? (info.embeddedThumbnail[0] ? `${info.embeddedThumbnail[0]} × ${info.embeddedThumbnail[1]}` : "Yes") : info.heif?.thumbnails ? `${info.heif.thumbnails}` : null} />
            </Section>

            {info.raw && (
              <Section icon={<Aperture className="h-3.5 w-3.5" />} title="RAW">
                <Row label="Camera" value={`${info.raw.make} ${info.raw.model}`} />
                <Row label="Sensor" value={info.raw.sensorWidth ? `${info.raw.sensorWidth} × ${info.raw.sensorHeight}` : null} />
                <Row label="Bits / sample" value={info.raw.bitsPerSample} />
                <Row label="Photometric" value={info.raw.cfa} />
              </Section>
            )}

            {info.tags.length > 0 && (
              <Section icon={<Tags className="h-3.5 w-3.5" />} title={`All EXIF tags (${info.tags.length})`}>
                {showAll ? (
                  <div className="space-y-0.5">
                    {info.tags
                      .filter((t) => showGps || !t.name.startsWith("GPS"))
                      .map((t, i) => (
                        <div key={i} className="flex gap-2 text-[11px]">
                          <span className="w-[130px] shrink-0 truncate text-vfg/45" title={`${t.group} · ${t.name}`}>
                            {t.name}
                          </span>
                          <span className="min-w-0 flex-1 select-text break-words text-vfg/80">{t.value}</span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <button className="text-[12px] text-accent hover:underline" onClick={() => setShowAll(true)}>
                    Show all tags
                  </button>
                )}
              </Section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
