export type MediaKind = "image" | "video";

export interface LiveInfo {
  video: string;
  verified: boolean;
}

export interface MediaItem {
  path: string;
  name: string;
  ext: string;
  format: string;
  kind: MediaKind;
  size: number;
  modified: number;
  created: number | null;
  raw: boolean;
  mayAnimate: boolean;
  webviewNative: boolean;
  live: LiveInfo | null;
  companion: boolean;
}

export interface Probe {
  width: number | null;
  height: number | null;
  captured: number | null;
  animated: boolean;
  contentId: string | null;
}

export interface ScanSummary {
  total: number;
  livePhotos: number;
  skipped: number;
}

export type ScanEvent =
  | { type: "items"; items: MediaItem[] }
  | { type: "listed"; summary: ScanSummary }
  | { type: "probes"; probes: (Probe & { path: string })[] }
  | { type: "done" }
  | { type: "error"; message: string };

export interface FormatCapability {
  id: string;
  name: string;
  extensions: string[];
  kind: MediaKind;
  decoder: string;
  webviewNative: boolean;
  mayAnimate: boolean;
  raw: boolean;
  notes: string;
  available: boolean;
}

export interface Gps {
  latitude: number;
  longitude: number;
  altitude: number | null;
}

export interface CameraInfo {
  make: string | null;
  model: string | null;
  lens: string | null;
  focalLength: number | null;
  focalLength35mm: number | null;
  aperture: number | null;
  exposureTime: string | null;
  iso: number | null;
  exposureCompensation: number | null;
  captured: string | null;
  offsetTime: string | null;
  orientation: number | null;
  flash: string | null;
  whiteBalance: string | null;
  exposureProgram: string | null;
  meteringMode: string | null;
  software: string | null;
  gps: Gps | null;
}

export interface ImageInfo {
  path: string;
  name: string;
  extension: string;
  format: string;
  fileSize: number;
  modified: number | null;
  created: number | null;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  colorSpace: string | null;
  bitDepth: number | null;
  hasAlpha: boolean | null;
  iccProfile: { size: number; description: string | null } | null;
  animated: boolean;
  camera: CameraInfo;
  embeddedThumbnail: [number, number] | null;
  raw: {
    make: string;
    model: string;
    lens: string | null;
    sensorWidth: number | null;
    sensorHeight: number | null;
    cfa: string | null;
    bitsPerSample: number | null;
  } | null;
  heif?: { width: number; height: number; bitDepth: number; hasAlpha: boolean; depthImages: number; thumbnails: number; iccSize: number } | null;
  hdr: string | null;
  livePhotoId: string | null;
  tags: { group: string; name: string; value: string }[];
}

export interface Collection {
  id: number;
  name: string;
  createdAt: number;
  count: number;
  cover: string | null;
}

export interface RecentEntry {
  path: string;
  kind: "file" | "folder";
  openedAt: number;
}

export interface PinnedFolder {
  id: number;
  path: string;
  name: string;
}

export interface StandardFolder {
  id: string;
  name: string;
  path: string;
}

export interface SubFolder {
  path: string;
  name: string;
}

export interface OpResult {
  source: string;
  target: string | null;
  error: string | null;
}

export interface Progress {
  done: number;
  total: number;
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EditParams {
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  crop: Crop | null;
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  sharpness: number;
}

export type ExportFormat = "jpeg" | "png" | "webp" | "tiff" | "bmp";

export interface RenamePlan {
  source: string;
  newName: string;
  conflict: string | null;
}

export interface CacheStats {
  bytes: number;
  entries: number;
  limitBytes: number;
  dir: string;
}

export interface DuplicateGroup {
  size: number;
  paths: string[];
}

export interface SimilarGroup {
  paths: string[];
  maxDistance: number;
}

export interface BrokenFile {
  path: string;
  error: string;
}
