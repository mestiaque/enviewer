/** Grid layout engines: uniform square grid and justified ("masonry-style") rows. */

export interface GridMetrics {
  columns: number;
  tile: number;
  rowHeight: number;
}

export function uniformGrid(width: number, target: number, gap: number, captionHeight: number): GridMetrics {
  const columns = Math.max(1, Math.floor((width + gap) / (target + gap)));
  const tile = Math.max(40, (width - gap * (columns - 1)) / columns);
  return { columns, tile, rowHeight: tile + captionHeight + gap };
}

export interface JustifiedRow {
  start: number;
  /** Item widths in this row (CSS px). */
  widths: number[];
  height: number;
  top: number;
}

/**
 * Pack items into rows of roughly `targetHeight`, scaling each row so it fills
 * `width` exactly (the last row keeps the target height).
 */
export function justifiedRows(aspects: number[], width: number, targetHeight: number, gap: number, captionHeight = 0): JustifiedRow[] {
  const rows: JustifiedRow[] = [];
  let top = 0;
  let start = 0;
  let sum = 0;
  const maxRowHeight = targetHeight * 1.6;
  for (let i = 0; i < aspects.length; i++) {
    const a = clampAspect(aspects[i]);
    sum += a;
    const count = i - start + 1;
    const h = (width - gap * (count - 1)) / sum;
    if (h <= targetHeight) {
      const height = Math.min(h, maxRowHeight);
      const widths = aspects.slice(start, i + 1).map((x) => clampAspect(x) * height);
      rows.push({ start, widths, height, top });
      top += height + captionHeight + gap;
      start = i + 1;
      sum = 0;
    }
  }
  if (start < aspects.length) {
    const widths = aspects.slice(start).map((x) => clampAspect(x) * targetHeight);
    rows.push({ start, widths, height: targetHeight, top });
  }
  return rows;
}

/** Extreme panoramas or slivers would make single-item rows; keep them sane. */
const clampAspect = (a: number) => (Number.isFinite(a) && a > 0 ? Math.min(4, Math.max(0.33, a)) : 1);
