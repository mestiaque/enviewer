/** Previous/next navigation and preload planning. */

export function step(index: number, delta: number, length: number, wrap: boolean): number {
  if (length === 0) return -1;
  const next = index + delta;
  if (wrap) return ((next % length) + length) % length;
  return Math.min(length - 1, Math.max(0, next));
}

/** Indices to preload around `index`, nearest first, direction-biased. */
export function preloadOrder(index: number, length: number, count: number, lastDirection: 1 | -1, wrap: boolean): number[] {
  const out: number[] = [];
  for (let d = 1; d <= count; d++) {
    for (const dir of [lastDirection, -lastDirection as 1 | -1]) {
      const raw = index + dir * d;
      const i = wrap ? ((raw % length) + length) % length : raw;
      if (i >= 0 && i < length && i !== index && !out.includes(i)) out.push(i);
    }
  }
  return out;
}

/** Fisher–Yates order for random slideshows that still visits every image once. */
export function shuffledOrder(length: number, first: number, rand: () => number = Math.random): number[] {
  const rest = Array.from({ length }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first >= 0 && first < length ? [first, ...rest] : rest;
}

export type Effect = "fade" | "slide" | "slideUp" | "zoom" | "blur" | "none";
export const SLIDESHOW_EFFECTS: Effect[] = ["fade", "slide", "slideUp", "zoom", "blur"];

/** A random slideshow transition, never the same as the previous one. */
export function randomEffect(previous?: Effect, rand: () => number = Math.random): Effect {
  const pool = SLIDESHOW_EFFECTS.filter((e) => e !== previous);
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}
