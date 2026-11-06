/** Sorting, filtering and search over scanned items (pure functions). */
import type { MediaItem, Probe } from "../lib/types";

export type SortKey = "name" | "created" | "modified" | "captured" | "size" | "dimensions" | "type";
export type SortDir = "asc" | "desc";

export interface Filter {
  formats: string[];
  favorites: boolean;
  orientation: "any" | "portrait" | "landscape" | "square";
  minMegapixels: number;
  raw: boolean;
  animated: boolean;
  live: boolean;
  videos: "include" | "exclude" | "only";
  dateFrom: string | null; // YYYY-MM-DD
  dateTo: string | null;
}

export const EMPTY_FILTER: Filter = {
  formats: [],
  favorites: false,
  orientation: "any",
  minMegapixels: 0,
  raw: false,
  animated: false,
  live: false,
  videos: "include",
  dateFrom: null,
  dateTo: null,
};

export function activeFilterCount(f: Filter): number {
  let n = 0;
  if (f.formats.length) n++;
  if (f.favorites) n++;
  if (f.orientation !== "any") n++;
  if (f.minMegapixels > 0) n++;
  if (f.raw) n++;
  if (f.animated) n++;
  if (f.live) n++;
  if (f.videos !== "include") n++;
  if (f.dateFrom || f.dateTo) n++;
  return n;
}

export interface SearchQuery {
  text: string[];
  ext: string[];
  folder: string[];
  date: string[];
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
}

/**
 * Plain words match file name and folder. Tokens:
 * `ext:jpg`, `type:heic`, `folder:trip`, `date:2024`, `date:2024-05`,
 * `w>3000`, `w<1000`, `h>=2000`, `width>…`, `height<…`.
 */
export function parseSearch(q: string): SearchQuery {
  const out: SearchQuery = { text: [], ext: [], folder: [], date: [], minW: 0, maxW: Infinity, minH: 0, maxH: Infinity };
  for (const raw of q.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const m = raw.match(/^(w|h|width|height)(>=|<=|>|<|=)(\d+)$/);
    if (m) {
      const dim = m[1][0] as "w" | "h";
      const n = Number(m[3]);
      const op = m[2];
      const key = dim === "w" ? ["minW", "maxW"] : ["minH", "maxH"];
      if (op.startsWith(">")) (out as unknown as Record<string, number>)[key[0]] = op === ">" ? n + 1 : n;
      else if (op.startsWith("<")) (out as unknown as Record<string, number>)[key[1]] = op === "<" ? n - 1 : n;
      else {
        (out as unknown as Record<string, number>)[key[0]] = n;
        (out as unknown as Record<string, number>)[key[1]] = n;
      }
      continue;
    }
    const [k, ...rest] = raw.split(":");
    const v = rest.join(":");
    if (v && (k === "ext" || k === "type")) out.ext.push(v.replace(/^\./, ""));
    else if (v && k === "folder") out.folder.push(v);
    else if (v && k === "date") out.date.push(v);
    else out.text.push(raw);
  }
  return out;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dateOf = (it: MediaItem, p?: Probe) => p?.captured ?? it.modified;

export function displaySize(p?: Probe): { w: number; h: number } | null {
  return p?.width && p?.height ? { w: p.width, h: p.height } : null;
}

export function matches(it: MediaItem, p: Probe | undefined, q: SearchQuery, f: Filter, favorites: Set<string>): boolean {
  if (it.companion) return false;
  // Filter
  if (f.videos === "exclude" && it.kind === "video") return false;
  if (f.videos === "only" && it.kind !== "video") return false;
  if (f.formats.length && !f.formats.includes(it.format)) return false;
  if (f.favorites && !favorites.has(it.path)) return false;
  if (f.raw && !it.raw) return false;
  if (f.live && !it.live) return false;
  if (f.animated && !(p?.animated ?? false)) return false;
  const size = displaySize(p);
  if (f.orientation !== "any") {
    if (!size) return false;
    const o = size.w > size.h ? "landscape" : size.w < size.h ? "portrait" : "square";
    if (o !== f.orientation) return false;
  }
  if (f.minMegapixels > 0 && (!size || (size.w * size.h) / 1e6 < f.minMegapixels)) return false;
  if (f.dateFrom || f.dateTo) {
    const d = isoDay(dateOf(it, p));
    if (f.dateFrom && d < f.dateFrom) return false;
    if (f.dateTo && d > f.dateTo) return false;
  }
  // Search
  const name = it.name.toLowerCase();
  const path = it.path.toLowerCase();
  for (const t of q.text) if (!name.includes(t) && !path.includes(t)) return false;
  if (q.ext.length && !q.ext.includes(it.ext) && !q.ext.includes(it.format)) return false;
  for (const fo of q.folder) {
    const dir = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
    if (!dir.includes(fo)) return false;
  }
  if (q.date.length) {
    const d = isoDay(dateOf(it, p));
    if (!q.date.some((pref) => d.startsWith(pref))) return false;
  }
  if (q.minW > 0 || q.maxW < Infinity || q.minH > 0 || q.maxH < Infinity) {
    if (!size) return false;
    if (size.w < q.minW || size.w > q.maxW || size.h < q.minH || size.h > q.maxH) return false;
  }
  return true;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareItems(a: MediaItem, b: MediaItem, key: SortKey, probes: Map<string, Probe>): number {
  const pa = probes.get(a.path);
  const pb = probes.get(b.path);
  switch (key) {
    case "name":
      return collator.compare(a.name, b.name);
    case "created":
      return (a.created ?? a.modified) - (b.created ?? b.modified);
    case "modified":
      return a.modified - b.modified;
    case "captured":
      return dateOf(a, pa) - dateOf(b, pb);
    case "size":
      return a.size - b.size;
    case "dimensions": {
      const da = displaySize(pa);
      const db = displaySize(pb);
      return (da ? da.w * da.h : -1) - (db ? db.w * db.h : -1);
    }
    case "type":
      return a.format.localeCompare(b.format) || a.ext.localeCompare(b.ext);
  }
}

export function sortItems(items: MediaItem[], key: SortKey, dir: SortDir, probes: Map<string, Probe>): MediaItem[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => sign * compareItems(a, b, key, probes) || collator.compare(a.name, b.name));
}

export function computeVisible(
  items: MediaItem[],
  probes: Map<string, Probe>,
  search: string,
  filter: Filter,
  favorites: Set<string>,
  sortKey: SortKey,
  sortDir: SortDir,
): MediaItem[] {
  const q = parseSearch(search);
  return sortItems(
    items.filter((it) => matches(it, probes.get(it.path), q, filter, favorites)),
    sortKey,
    sortDir,
    probes,
  );
}
