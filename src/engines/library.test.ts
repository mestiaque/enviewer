import { describe, expect, it } from "vitest";
import type { MediaItem, Probe } from "../lib/types";
import { EMPTY_FILTER, computeVisible, parseSearch } from "./library";

const item = (name: string, over: Partial<MediaItem> = {}): MediaItem => ({
  path: `/photos/trip/${name}`,
  name,
  ext: name.split(".").pop()!.toLowerCase(),
  format: "jpeg",
  kind: "image",
  size: 1000,
  modified: Date.UTC(2024, 0, 1),
  created: null,
  raw: false,
  mayAnimate: false,
  webviewNative: true,
  live: null,
  companion: false,
  ...over,
});

const probe = (w: number, h: number, captured: number | null = null, animated = false): Probe => ({ width: w, height: h, captured, animated, contentId: null });

describe("library engine", () => {
  const items = [
    item("IMG_10.jpg", { size: 5 }),
    item("IMG_2.jpg", { size: 50 }),
    item("IMG_2.MOV", { kind: "video", format: "mov", companion: true }),
    item("pano.heic", { format: "heic", ext: "heic", live: { video: "/x.mov", verified: true } }),
    item("clip.mp4", { kind: "video", format: "mp4" }),
    item("dog.cr3", { raw: true, format: "canon", ext: "cr3" }),
    item("anim.gif", { format: "gif", ext: "gif", mayAnimate: true }),
  ];
  const probes = new Map<string, Probe>([
    ["/photos/trip/IMG_10.jpg", probe(4000, 3000, Date.UTC(2023, 4, 2))],
    ["/photos/trip/IMG_2.jpg", probe(3000, 4000, Date.UTC(2024, 6, 1))],
    ["/photos/trip/pano.heic", probe(8000, 2000)],
    ["/photos/trip/anim.gif", probe(100, 100, null, true)],
  ]);
  const visible = (search = "", filter = EMPTY_FILTER, key: Parameters<typeof computeVisible>[5] = "name", dir: "asc" | "desc" = "asc", favs = new Set<string>()) =>
    computeVisible(items, probes, search, filter, favs, key, dir).map((i) => i.name);

  it("hides Live Photo companions and sorts naturally", () => {
    expect(visible()).toEqual(["anim.gif", "clip.mp4", "dog.cr3", "IMG_2.jpg", "IMG_10.jpg", "pano.heic"]);
  });

  it("sorts by size, dimensions and capture date", () => {
    expect(visible("", EMPTY_FILTER, "size", "asc")[0]).toBe("IMG_10.jpg");
    expect(visible("", EMPTY_FILTER, "dimensions", "desc")[0]).toBe("pano.heic");
    expect(visible("img", EMPTY_FILTER, "captured", "desc")).toEqual(["IMG_2.jpg", "IMG_10.jpg"]);
  });

  it("filters", () => {
    expect(visible("", { ...EMPTY_FILTER, raw: true })).toEqual(["dog.cr3"]);
    expect(visible("", { ...EMPTY_FILTER, live: true })).toEqual(["pano.heic"]);
    expect(visible("", { ...EMPTY_FILTER, animated: true })).toEqual(["anim.gif"]);
    expect(visible("", { ...EMPTY_FILTER, orientation: "portrait" })).toEqual(["IMG_2.jpg"]);
    expect(visible("", { ...EMPTY_FILTER, videos: "only" })).toEqual(["clip.mp4"]);
    expect(visible("", { ...EMPTY_FILTER, minMegapixels: 12 })).toEqual(["IMG_2.jpg", "IMG_10.jpg", "pano.heic"]);
    expect(visible("", { ...EMPTY_FILTER, favorites: true }, "name", "asc", new Set(["/photos/trip/dog.cr3"]))).toEqual(["dog.cr3"]);
    expect(visible("", { ...EMPTY_FILTER, dateFrom: "2024-01-01", dateTo: "2024-12-31", videos: "exclude" })).toEqual(["anim.gif", "dog.cr3", "IMG_2.jpg", "pano.heic"]);
  });

  it("parses and applies search tokens", () => {
    const q = parseSearch("ext:.HEIC w>=5000 h<3000 folder:trip date:2024-05 beach");
    expect(q).toMatchObject({ ext: ["heic"], minW: 5000, maxH: 2999, folder: ["trip"], date: ["2024-05"], text: ["beach"] });
    expect(visible("ext:heic")).toEqual(["pano.heic"]);
    expect(visible("w>3500")).toEqual(["IMG_10.jpg", "pano.heic"]);
    expect(visible("date:2023")).toEqual(["IMG_10.jpg"]);
    expect(visible("folder:nope")).toEqual([]);
    expect(visible("img_1")).toEqual(["IMG_10.jpg"]);
  });
});
