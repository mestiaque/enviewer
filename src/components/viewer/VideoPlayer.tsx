import { FilmIcon, Pause, Play, Repeat, Volume1, Volume2, VolumeX } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "../../lib/format";
import type { MediaItem } from "../../lib/types";
import { videoUrl } from "../../lib/urls";
import { IconButton, Slider } from "../ui/primitives";
import { useSettings } from "../../store/settings";

export interface VideoHandle {
  togglePlay(): void;
}

const fmt = (t: number) => {
  if (!Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/** Basic video preview: play/pause, timeline, volume, mute, loop. */
export const VideoPlayer = forwardRef<VideoHandle, { item: MediaItem; controlsVisible: boolean }>(function VideoPlayer({ item, controlsVisible }, ref) {
  const v = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const glass = useSettings((st) => st.settings.viewerTheme === "glass");
  const backdrop = useRef<HTMLCanvasElement>(null);

  // Glass style: a tiny, heavily blurred live copy of the video behind it.
  useEffect(() => {
    if (!glass) return;
    const id = window.setInterval(() => {
      const el = v.current;
      const c = backdrop.current;
      if (!el || !c || el.readyState < 2) return;
      c.getContext("2d")?.drawImage(el, 0, 0, c.width, c.height);
    }, 150);
    return () => window.clearInterval(id);
  }, [glass]);

  const toggle = () => {
    const el = v.current;
    if (!el) return;
    if (el.paused) el.play().catch((e) => setError(String(e)));
    else el.pause();
  };
  useImperativeHandle(ref, () => ({ togglePlay: toggle }));

  useEffect(() => {
    if (v.current) {
      v.current.volume = volume;
      v.current.muted = muted;
    }
  }, [volume, muted]);

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {glass && <canvas ref={backdrop} width={48} height={27} className="absolute inset-[-8%] h-[116%] w-[116%] opacity-80 blur-3xl saturate-150" />}
      {error ? (
        <div className="flex max-w-md flex-col items-center gap-2 p-6 text-center text-vfg/80">
          <FilmIcon className="h-10 w-10 text-vfg/40" />
          <div className="font-semibold">This video can’t be played</div>
          <div className="text-xs text-vfg/55">
            {item.ext.toUpperCase()} playback depends on the codecs available to the system media framework (GStreamer on Linux, Media Foundation on Windows). HEVC videos may require an additional codec
            package.
          </div>
        </div>
      ) : (
        <video
          ref={v}
          src={videoUrl(item.path, item.modified)}
          className="relative max-h-full max-w-full rounded-lg shadow-2xl"
          autoPlay
          loop={loop}
          playsInline
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onError={(e) => {
            const err = e.currentTarget.error;
            console.error(`video playback failed: code=${err?.code} message=${err?.message ?? ""} src=${e.currentTarget.currentSrc}`);
            setError("unsupported");
          }}
        />
      )}
      {!error && (
        <div
          className={cn(
            "absolute bottom-20 left-1/2 flex w-[min(720px,90%)] -translate-x-1/2 items-center gap-2 viewer-pill rounded-xl px-3 py-2 text-vfg transition-opacity duration-300",
            controlsVisible ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <IconButton dark label={playing ? "Pause" : "Play"} shortcut="Space" onClick={toggle} side="top">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </IconButton>
          <span className="w-10 text-right text-[11px] tabular-nums text-vfg/70">{fmt(time)}</span>
          <Slider
            dark
            value={time}
            min={0}
            max={duration || 1}
            step={0.01}
            onChange={(t) => {
              setTime(t);
              if (v.current) v.current.currentTime = t;
            }}
          />
          <span className="w-10 text-[11px] tabular-nums text-vfg/70">{fmt(duration)}</span>
          <IconButton dark label={loop ? "Loop on" : "Loop off"} active={loop} onClick={() => setLoop(!loop)} side="top">
            <Repeat className="h-4 w-4" />
          </IconButton>
          <IconButton dark label={muted ? "Unmute" : "Mute"} onClick={() => setMuted(!muted)} side="top">
            {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : volume < 0.5 ? <Volume1 className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </IconButton>
          <div className="w-24">
            <Slider dark value={muted ? 0 : volume} min={0} max={1} onChange={(x) => (setVolume(x), setMuted(x === 0))} />
          </div>
        </div>
      )}
    </div>
  );
});
