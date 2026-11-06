# Dependencies and licensing

ENViewer itself is MIT-licensed. The table lists every direct dependency that ships
in the application and its licence. Transitive Rust dependencies can be listed
with `cargo tree`, and licences checked with `cargo deny check licenses`.

## Native / system libraries

| Library | Used for | Licence | How it is shipped |
|---------|----------|---------|-------------------|
| libheif (+ libde265, libaom/dav1d as built by the distro/vcpkg) | HEIC, HEIF, AVIF fallback decoding | LGPL-3.0 (libheif), LGPL-3.0 (libde265), BSD (aom/dav1d) | **Dynamically linked**: a system package on Linux, DLLs next to the exe on Windows. Users can replace them, which satisfies the LGPL. |
| WebKitGTK 4.1 (Linux) / WebView2 (Windows) | UI rendering, native decoding of JPEG/PNG/GIF/WebP/AVIF/SVG, video playback | LGPL-2.1 / BSD (WebKit); Microsoft licence (WebView2 runtime) | System component |
| GStreamer + plugins (Linux) | Video and Live Photo playback inside WebKitGTK | LGPL-2.1 | System packages; `gstreamer1.0-libav` provides H.264/HEVC |
| SQLite (via `rusqlite` "bundled") | Application database | Public domain | Statically compiled |

**Codec patents.** HEVC (used by iPhone HEIC stills and Live Photo movies) is
patent-encumbered in some jurisdictions. ENViewer ships no HEVC decoder of its own.
It relies on the libheif/libde265 build provided by the operating system or
vcpkg, and on the OS media stack for video. Distributors should review this for
their region.

## Rust crates (direct)

| Crate | Purpose | Licence |
|-------|---------|---------|
| tauri 2, tauri-build, tauri-plugin-{dialog, opener, clipboard-manager, single-instance, log} | Desktop shell | MIT / Apache-2.0 |
| image 0.25 | JPEG, PNG/APNG, GIF, WebP, BMP, ICO, TIFF, TGA, PNM, QOI, HDR, OpenEXR decode; encoders | MIT / Apache-2.0 |
| rawler 0.8 | Camera RAW decoding / embedded previews | **LGPL-2.1** (statically linked Rust crate; ENViewer's source is MIT and public, so users can relink) |
| jxl-oxide 0.12 | JPEG XL | MIT / Apache-2.0 |
| psd 0.3 | Photoshop composite preview | MIT / Apache-2.0 |
| resvg 0.49 | SVG rasterisation (thumbnails, svgz) | Apache-2.0 / MIT |
| kamadak-exif 0.6 | EXIF parsing (JPEG, TIFF, HEIF, PNG, WebP) | BSD-2-Clause |
| imagesize | Header-only dimension probing | MIT |
| rusqlite (bundled) | SQLite | MIT |
| blake3 | Cache keys, duplicate detection | CC0 / Apache-2.0 |
| trash | Move to system Trash / Recycle Bin | MIT |
| rayon, parking_lot, crossbeam-channel, serde, serde_json, thiserror, log, percent-encoding | Infrastructure | MIT / Apache-2.0 |

## Frontend packages

| Package | Purpose | Licence |
|---------|---------|---------|
| react, react-dom 18 | UI | MIT |
| zustand | State management | MIT |
| @tanstack/react-virtual | Virtualised grid | MIT |
| @radix-ui/* (dialog, dropdown-menu, context-menu, slider, switch, tooltip) | Accessible primitives (shadcn/ui-style components are built on these) | MIT |
| lucide-react | Icons | ISC |
| tailwindcss, clsx, tailwind-merge | Styling | MIT |
| @tauri-apps/api, @tauri-apps/plugin-dialog | IPC | MIT / Apache-2.0 |
| vite, typescript, vitest (dev only) | Build and test | MIT / Apache-2.0 |

No dependency performs network access at runtime. ENViewer is fully offline.
