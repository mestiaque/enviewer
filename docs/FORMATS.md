# Format support matrix

Every format is listed once in `crates/lumen-core/src/formats.rs`. That
registry drives the scanner, the decoder choice, the file associations and the
**Settings → File formats** table, which shows whether each decoder is available
in the running build and lets you disable formats.

**Tested** below means the file was decoded by
`cargo run --release -p lumen-core --example format_check` on Ubuntu 22.04
(libheif 1.12, rawler 0.8). Formats marked ✅ in the "Viewer" column were also
opened in the running app (ENViewer 0.1.0, WebKitGTK 2.50, headless Xvfb).
Tested samples were generated files plus real-world samples from raw.pixls.us
(CC0) and public HEIC/AVIF/JXL test images.

| Format | Extensions | Decoder (viewer / thumbnail) | Tested sample | Result | Viewer |
|--------|------------|------------------------------|---------------|--------|--------|
| JPEG | jpg jpeg jpe jfif | WebView (original bytes) / `image` | generated 640×427; EXIF orientation 6 | ✅ orientation applied (→ 427×640) | ✅ |
| PNG / APNG | png apng | WebView / `image` | generated RGBA with transparency | ✅ (PNG thumbnail keeps alpha) | ✅ |
| GIF (animated) | gif | WebView / `image` (first frame) | generated 3-frame GIF | ✅ animation detected | ✅ |
| WebP (incl. animated) | webp | WebView / `image` | generated RGBA | ✅ | ✅ |
| BMP | bmp dib | WebView / `image` | generated | ✅ | ✅ |
| ICO | ico | WebView / `image` | generated 128 px | ✅ | ✅ |
| TIFF | tif tiff | `image` → lossless PNG | generated | ✅ (first page) | ✅ |
| SVG / SVGZ | svg / svgz | WebView / `resvg` | generated | ✅ rasterised at thumbnail size | ✅ |
| AVIF | avif | WebView, libheif fallback / libheif | kimono.avif (722×1024) | ✅ | ✅ |
| **HEIC / HEIF** | heic heif hif heics | libheif → PNG with ICC / embedded HEIF thumbnail | iPhone-style HEIC 3992×2992 and 3464×2130, HEIF 1440×960 | ✅ sRGB ICC profile detected | ✅ |
| JPEG XL | jxl | `jxl-oxide` | libjxl conformance `lz77_flower` | ✅ | ✅ |
| PSD | psd | `psd` (flattened composite) | — | ⚠️ not tested with a real PSD; PSB unsupported | — |
| Radiance HDR | hdr | `image`, Reinhard tone-mapped | generated | ✅ | — |
| OpenEXR | exr | `image`, Reinhard tone-mapped | generated | ✅ | — |
| TGA / Netpbm / QOI | tga · pbm pgm ppm pnm pam · qoi | `image` | generated | ✅ | — |
| **DNG / Apple ProRAW** | dng | `rawler`: embedded preview, or full develop | iPhone 12 Pro ProRAW | ✅ 3024×4032 portrait, EXIF + GPS | ✅ |
| **Canon RAW** | cr2 cr3 crw | `rawler` | Canon EOS R CR3 (C-RAW) | ✅ 6720×4480 preview, lens/exposure metadata | ✅ |
| **Nikon RAW** | nef nrw | `rawler` | Nikon D750 12-bit compressed NEF | ✅ 6016×4016 | ✅ |
| **Sony RAW** | arw srf sr2 | `rawler`; the 1616 px embedded preview is too small, so the RAW is developed | Sony A7 III ARW | ✅ 6000×4000 developed in 1.7 s | ✅ |
| Fujifilm / Olympus / Panasonic / Pentax / Samsung RAW | raf · orf · rw2 · pef · srw | `rawler` | — | ⚠️ supported by rawler but not tested here | — |
| Other RAW | 3fr iiq mrw kdc dcr erf mef mos ari | `rawler` | — | ⚠️ coverage depends on the camera model | — |
| QuickTime / MP4 / WebM video | mov qt mp4 m4v webm | WebView media stack (GStreamer / Media Foundation); on Linux streamed via ENViewer's loopback HTTP server | VP8 WebM test clip | ✅ plays, seeks (Range); other codecs depend on installed OS codecs (HEVC needs `gstreamer1.0-libav` on Linux, or the HEVC extension on Windows) | ✅ |

### Live Photos

| Case | Tested with | Result |
|------|-------------|--------|
| HEIC + short `.MOV` with the same name, no identifiers | real HEIC + synthetic 2 s QuickTime file | ✅ paired ("matched by file name"), LIVE badge, `.MOV` hidden |
| HEIC + 45 s `.MOV` with the same name | synthetic | ✅ **not** paired; shown as a separate video |
| Apple ContentIdentifier match / mismatch | synthetic MakerNote + QuickTime `mdta` keys (unit tests) | ✅ verified / rejected |
| Real iPhone Live Photo pair (HEIC + HEVC MOV) | — | ⚠️ **not yet tested with a genuine iPhone pair**. Parsing is unit-tested against Apple's documented structures, and playback depends on HEVC support in the OS media stack. |

### Not supported

* Multi-page TIFF (only the first page is shown), PSB, animated JPEG XL (first frame only).
* Apple portrait depth maps are *detected* (the info panel shows how many there are) but not visualised.
* HDR gain maps (iPhone, Ultra HDR) are ignored, and the SDR base image is shown. HDR/EXR are tone-mapped to SDR.
* If a file's decoder is unavailable or fails, the viewer shows the error with
  "Open with default app" and "Show in folder", and the grid shows an
  "unreadable" tile. The app never crashes on a bad file (decoders run inside
  `catch_unwind`).

### Colour

The webview colour-manages images that it decodes from original bytes,
using their embedded ICC profiles. For backend-decoded formats, the ICC profile is
copied into the lossless PNG sent to the webview, and 16-bit depth is kept.
Thumbnails are 8-bit sRGB-assumed JPEG/PNG.
