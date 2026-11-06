# ENViewer – Technical architecture

ENViewer is a Tauri 2 desktop application: a Rust backend that owns every file,
decoder and database operation, and a React + TypeScript frontend that renders
the interface inside the system webview (WebKitGTK on Linux, WebView2 on
Windows). The webview never touches the filesystem directly.

```
┌──────────────────────────── Frontend (React, TS) ─────────────────────────────┐
│ components/                stores (zustand)          engines (pure, tested)   │
│  layout/ Sidebar Toolbar    library  (view, items,    zoomPan   – cursor-     │
│          Grid Tile Home      probes, selection)        anchored zoom maths    │
│  viewer/ Viewer ImageStage  viewer   (list, index)    library   – sort/filter/│
│          InfoPanel Edit…    settings (persisted)                 search       │
│  tools/  Slideshow Compare  ui       (dialogs, toasts) layout   – grid/justif.│
│          Batch Organize                               navigation, editPreview │
│                   │ invoke() / Channel                  ▲ <img src="lumen://…">│
└───────────────────┼─────────────────────────────────────┼─────────────────────┘
                    ▼                                     │
┌──────────── src-tauri (app shell) ──────────────────────┼─────────────────────┐
│ commands/ library data files tools   protocol.rs  ──────┘ thumb LIFO workers, │
│ state.rs (AppState: Db, ThumbCache, decoded-image LRU,     /full decode,      │
│           decode options, task cancellation flags)         /file + Range      │
└───────────────────┬───────────────────────────────────────────────────────────┘
                    ▼
┌──────────── crates/lumen-core (no GUI dependencies, unit-tested) ─────────────┐
│ formats   registry of every extension → decoder, webview-native?, raw?, anim? │
│ decode    image crate · libheif FFI (HEIC/AVIF) · rawler (RAW) · jxl-oxide ·   │
│           psd · resvg — all wrapped in catch_unwind, orientation applied       │
│ metadata  probe (dims, capture date, animation, Live id) · full EXIF/ICC info │
│ livephoto Apple MakerNote + QuickTime `mdta` parsing, pairing rules           │
│ scan      folder listing, Live Photo pairing, natural sort                     │
│ thumbs    BLAKE3-keyed disk cache, LRU eviction, size limit                   │
│ db        SQLite (bundled), migrations via PRAGMA user_version                │
│ edit      non-destructive pipeline (crop→rotate→flip→colour→sharpen)          │
│ fileops   copy/move/rename (never overwrite), system Trash                    │
│ batch     rename plans (two-phase), convert/resize/export (parallel)          │
│ organize  duplicates (size→prefix→full hash), dHash similarity, broken files  │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Service boundaries

| Service (spec)            | Implementation |
|---------------------------|----------------|
| Filesystem service        | `lumen-core::scan`, `fileops`; commands in `src-tauri/src/commands/library.rs`, `files.rs` |
| Image decoding service    | `lumen-core::decode` (+ `decode::heif`, `decode::raw`) |
| Format registry           | `lumen-core::formats` (single source of truth, also drives the Settings → File formats table) |
| Thumbnail service         | `lumen-core::thumbs::generate` + the LIFO worker pool in `protocol.rs` |
| Cache service             | `lumen-core::thumbs::ThumbCache` (disk) and `state::ByteLru` (decoded images in memory) |
| Metadata service          | `lumen-core::metadata` |
| Viewer engine             | `components/viewer/Viewer.tsx`, `ImageStage.tsx` |
| Zoom & pan engine         | `engines/zoomPan.ts` (pure) + `viewer/useZoomPan.ts` (animation) |
| Navigation engine         | `engines/navigation.ts` (step, preload order, shuffle) |
| Live Photo detection      | `lumen-core::livephoto` + `scan::pair_live_photos` |
| Favorites & collections   | `lumen-core::db` + `store/library.ts` |
| Editing engine            | `lumen-core::edit` (export) + `engines/editPreview.ts` (identical formulas as CSS/SVG filters) |
| Export service            | `lumen-core::batch::{export_one, convert}`, `encode` |
| Settings service          | `db.settings` table + `store/settings.ts` (backend applies cache/RAW settings) |

## How an image reaches the screen

1. **Scan.** `scan_folder` lists the folder on a background thread, pairs Live
   Photos (reading only the HEIC EXIF block and the MOV `moov` box) and streams
   `MediaItem` batches of 1000 over a Tauri `Channel`. The grid renders the
   first batch immediately.
2. **Probe.** The same thread then streams *probes* (display dimensions,
   capture date, animation flag) in chunks of 128, using up to 8 threads.
   Results are cached in `image_metadata` keyed by (path, size, mtime), so
   re-opening a folder of 10 000 photos only costs a DB lookup per file.
3. **Thumbnails.** Tiles request `lumen://localhost/thumb/<px>/<gen>?p=…`.
   The protocol handler pushes a job onto a LIFO queue so the tiles currently on
   screen are served first when scrolling fast; jobs from a previous folder
   (older generation) are answered `410` without decoding. Decoders use
   fast paths: embedded HEIF thumbnails, RAW embedded previews, and
   SVG rasterised directly at thumbnail size.
4. **Viewer.** Formats the webview decodes natively (JPEG, PNG/APNG, GIF, WebP,
   AVIF, BMP, ICO, SVG) are streamed as original bytes through
   `lumen://…/file`. This keeps full quality, embedded ICC colour
   management and animation. Everything else goes through `lumen://…/full`:
   decoded in Rust and sent as a *lossless* PNG (fast deflate) that keeps
   16-bit depth and the ICC profile. If the webview rejects a "native" file,
   the viewer falls back to `/full` automatically; if that fails too, the
   backend's error text is shown with "Open with default app" and "Show in
   folder" actions.
5. **Video.** WebKitGTK's GStreamer source only accepts http(s)/blob URLs, so on
   Linux videos and Live Photo motion files are streamed by `media_server.rs`, a
   loopback-only HTTP server with a random per-run token that serves only
   video extensions, with Range support. WebView2 (Windows) plays them from
   `lumen://…/file` directly.
6. **Preload.** The next/previous `preloadCount` images (biased in the
   direction of travel) are requested and `decode()`d ahead of time;
   backend-decoded ones also land in the decoded-image LRU (512 MB default).

No full-resolution image is ever held for the whole folder: only the visible
image, the preloaded neighbours and the bounded LRU.

## Zoom & pan

`engines/zoomPan.ts` defines the view as `{scale, x, y}`. The image centre is
offset `(x, y)` CSS pixels from the viewport centre, and `scale` is CSS pixels
per image pixel. Zooming by `k` around anchor `a` (cursor relative to the
viewport centre) is `t' = a − (a − t)·k`, which keeps the image point under the
cursor fixed. Rotation is about the image centre, so the formula holds for every
rotation. `clampPan` centres an axis that fits the viewport and stops panning
past the edges.

Smooth zoom (`useZoomPan`) animates scale in log space over 140 ms and, *on every
frame*, recomputes the pan from the starting view and anchor. The anchored pixel
therefore never drifts mid-animation. Wheel events that arrive during an
animation multiply the pending *target* scale, so fast scrolling stays
responsive. Pinch gestures (ctrl+wheel with small deltas) apply immediately and
continuously. 100 % means one image pixel per *device* pixel (`scale = 1/dpr`),
and above 300 % the image is drawn with nearest-neighbour sampling.

## Live Photos

See `crates/lumen-core/src/livephoto.rs`. A still (HEIC/HEIF/JPEG) and a movie
(MOV/MP4) with the same stem in the same folder are *candidates*. The decision:

* Both carry Apple content identifiers (MakerNote tag 0x0011 /
  `com.apple.quicktime.content.identifier`) → paired **only if they match**
  (verified).
* Otherwise → paired only if the movie is ≤ 6 s and ≤ 40 MB (shown as "matched
  by file name").
* Any other movie is a normal video, so long same-named clips are never hidden.

Paired movies are hidden from the grid (`companion = true`), move, copy, rename
and trash together with their still, and play on hover (muted) or with Space /
click (with sound) in the viewer, on top of the still with the same transform.

## Database (SQLite, `app_data_dir/lumen.sqlite3`)

| table                   | purpose |
|-------------------------|---------|
| `folders`               | folders pinned to the sidebar |
| `image_metadata`        | probe cache: path, size, mtime, width, height, captured_at, animated, content_id |
| `favorites`             | favourite file paths |
| `collections`, `collection_items` | user collections (cascade delete) |
| `recent_files`          | recently viewed files and opened folders (bounded to 500 each) |
| `settings`              | key → JSON value |
| `thumbnail_cache_index` | cache key, source path, bytes, created, last access (LRU eviction) |
| `edit_history`          | non-destructive edit parameters per file |

Migrations are an ordered list in `db.rs`; each runs in a transaction and bumps
`PRAGMA user_version`. Renames and moves done in ENViewer update favourites,
collections, edits and recents (`Db::rename_path`).

## Safety guarantees

* Viewing, rotating, flipping and editing never write to the source file. Edits
  are parameters in `edit_history`, and export always writes a *new* file (the
  export command refuses to target the original path).
* Copy, move, rename, batch rename and export never overwrite: names are made unique
  (`name (2).jpg`), files are opened with `create_new`, and batch rename runs in
  two phases through temporary names so swaps work and conflicts abort before
  anything changes.
* Deletion always moves to the system Trash (`trash` crate) after confirmation.
* Decoders run inside `catch_unwind`, and allocation is capped at 2 GiB per image.
  Corrupt files produce errors, never crashes.
* The `lumen://` protocol serves only absolute paths whose extension is in the
  format registry. The frontend has no generic filesystem permission (no fs
  plugin), and the CSP allows only `self` and `lumen:`.

## Frontend structure

* `store/library.ts`: current view (`home | folder | favorites | recent |
  collection`), back/forward history, streamed items and probes, sort, filter,
  search and selection. A generation counter discards events from superseded scans.
* `store/viewer.ts`: viewer open state, a *snapshot* of the visible list (so
  ordering is stable while viewing), current index and panel.
* `engines/*`: pure functions with Vitest tests (`pnpm test`).
* `lib/actions.ts`: every user-facing operation (trash, rename, copy/move,
  favourite, collections, compare, slideshow) lives in one place, shared by
  menus, toolbars and shortcuts.
