/**
 * URLs for the `lumen://` protocol. WebView2 (Windows) exposes custom schemes
 * as http://<scheme>.localhost, WebKitGTK as <scheme>://localhost.
 */
const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
const BASE = isWindows ? "http://lumen.localhost" : "lumen://localhost";

const enc = (path: string) => encodeURIComponent(path);

/** Thumbnail edge buckets – must match `lumen_core::thumbs::BUCKETS`. */
const BUCKETS = [128, 256, 384, 512, 768];
export const thumbBucket = (px: number) => BUCKETS.find((b) => b >= px) ?? BUCKETS[BUCKETS.length - 1];

export const thumbUrl = (path: string, px: number, generation: number, version: number) =>
  `${BASE}/thumb/${thumbBucket(px)}/${generation}?p=${enc(path)}&v=${version}`;

/** Backend-decoded full image (lossless PNG). */
export const fullUrl = (path: string, version: number) => `${BASE}/full?p=${enc(path)}&v=${version}`;

/** Original file bytes (supports Range for video). */
export const fileUrl = (path: string, version = 0) => `${BASE}/file?p=${enc(path)}&v=${version}`;

/**
 * Video URLs. WebKitGTK (Linux) can only stream media over http(s), so videos go
 * through Lumen's loopback media server there; WebView2 handles lumen:// fine.
 */
let mediaBase: string | null = null;
export const setMediaBase = (base: string | null) => (mediaBase = base);
export const videoUrl = (path: string, version = 0) =>
  !isWindows && mediaBase ? `${mediaBase}/media?p=${enc(path)}&v=${version}` : fileUrl(path, version);

export const platform = { isWindows, isMac: typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) };
