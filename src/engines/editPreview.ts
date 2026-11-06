/**
 * Live preview of non-destructive edits using CSS/SVG filters. The formulas
 * mirror `lumen_core::edit::apply` so the export matches the preview.
 */
import type { EditParams } from "../lib/types";

export const DEFAULT_EDIT: EditParams = {
  rotate: 0,
  flipH: false,
  flipV: false,
  crop: null,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
  sharpness: 0,
};

export const isIdentity = (p: EditParams) =>
  p.rotate % 4 === 0 &&
  !p.flipH &&
  !p.flipV &&
  !p.crop &&
  p.brightness === 0 &&
  p.contrast === 0 &&
  p.saturation === 0 &&
  p.exposure === 0 &&
  p.temperature === 0 &&
  p.sharpness === 0;

/** Same gains as `edit::temperature_gains`. */
export const temperatureGains = (t: number) => {
  const c = Math.max(-1, Math.min(1, t));
  return { r: 1 + 0.25 * c, b: 1 - 0.25 * c };
};

/** CSS `filter` value. SVG filter ids refer to <EditFilterDefs/>. */
export function cssFilter(p: EditParams): string {
  const parts: string[] = [];
  if (p.temperature !== 0) parts.push("url(#lumen-temperature)");
  const mul = Math.pow(2, p.exposure) * (1 + p.brightness);
  if (mul !== 1) parts.push(`brightness(${mul.toFixed(4)})`);
  if (p.contrast !== 0) parts.push(`contrast(${(1 + p.contrast).toFixed(4)})`);
  if (p.saturation !== 0) parts.push(`saturate(${(1 + p.saturation).toFixed(4)})`);
  if (p.sharpness > 0) parts.push("url(#lumen-sharpen)");
  return parts.join(" ") || "none";
}

/** 3×3 sharpening kernel approximating the export's unsharp mask. */
export function sharpenKernel(amount: number): string {
  const a = Math.max(0, Math.min(1, amount)) * 0.6;
  return [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0].map((v) => v.toFixed(4)).join(" ");
}
