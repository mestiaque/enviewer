# ENViewer

A fast, offline, premium image viewer and photo browser for **Ubuntu Linux** and
**Windows 10/11**, built with Tauri 2, Rust and React.

ENViewer was previously called Lumen. The `enviewer` package replaces the old `lumen` one and keeps your
favourites, collections and settings. Its sister app is **ENPlayer**, the video and music player.

* **Viewer first**: smooth, cursor-anchored wheel zoom; drag to pan;
  double-click for fit/100 %; pixel-exact 100 % on HiDPI screens;
  previous/next by arrows, side buttons, mouse back/forward buttons or touchpad
  swipe; rotate/flip; full screen; auto-hiding controls; neighbour preloading.
* **iPhone photos**: HEIC/HEIF through libheif with the correct orientation,
  and **Live Photos** paired by Apple content identifier, played on hover or with Space.
* **Many formats**: JPEG, PNG/APNG, GIF, WebP (animated), AVIF, JPEG XL, TIFF,
  BMP, ICO, SVG, PSD (composite), HDR/EXR (tone-mapped), TGA, PNM, QOI and camera
  RAW (DNG/ProRAW, CR2, CR3, NEF, ARW, RAF, ORF, RW2, PEF, SRW…). See
  [docs/FORMATS.md](docs/FORMATS.md) for what was actually tested.
* **Large folders**: streaming scan, background metadata probing, virtualised
  grid, persistent BLAKE3-keyed thumbnail cache with a size limit, and a LIFO
  thumbnail queue so what you see loads first.
* **Organise**: favourites, collections, recents, smart albums, sort by EXIF
  date or dimensions, filters and token search (`ext:heic w>4000 date:2024`).
* **Premium tools**: EXIF/ICC/GPS info panel, side-by-side compare with
  synchronised zoom, slideshow with transitions, non-destructive editing with
  export, batch rename/convert/resize, duplicate and similar-image finder, and a
  broken-file check.
* **Safe**: originals are never modified, nothing is overwritten, deletion
  goes to the system Trash, and nothing is uploaded.

## Quick start (development)

```bash
pnpm install
pnpm tauri dev
```

System prerequisites and release builds: [docs/BUILDING.md](docs/BUILDING.md).
On Linux without root you can build entirely in Docker:

```bash
docker build -t lumen-build scripts/docker
scripts/docker/run.sh scripts/build-linux.sh
```

## Documentation

| Document | Contents |
|----------|----------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, services, data flow, zoom maths, Live Photo rules, database |
| [docs/FORMATS.md](docs/FORMATS.md) | Format support matrix with test results |
| [docs/BUILDING.md](docs/BUILDING.md) | Installation, development, Ubuntu and Windows builds |
| [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) | Dependencies and licences (codec notes) |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | User guide and shortcuts |
| [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) | Release checklist |

## Project layout

```
crates/lumen-core/   Rust core: formats, decoding, metadata, Live Photos, thumbnails, DB, edits, file ops
  examples/format_check.rs   format compatibility checker
src-tauri/           Tauri shell: commands, lumen:// protocol, app state, bundling config
src/                 React frontend
  engines/           pure, unit-tested logic (zoom/pan, sort/filter/search, layout, navigation, edit preview)
  store/             zustand stores
  components/        layout, viewer, tools, settings, ui primitives
scripts/             build scripts and the Docker build environment
docs/                documentation
```

## Tests

```bash
pnpm test                      # Vitest: zoom/pan maths, search/filter/sort, layout, navigation, edit preview
cargo test --workspace         # Rust: formats, decoding, Live Photo pairing, scan, DB, cache, edits, file ops, batch, organise, protocol ranges
cargo run --release -p lumen-core --example format_check -- <folder>   # real-file format check
```

## License

MIT for ENViewer's own code. Third-party licences are listed in
[docs/DEPENDENCIES.md](docs/DEPENDENCIES.md). libheif is LGPL and dynamically
linked; rawler is LGPL-2.1.

## Updates

Installed copies update themselves: ENViewer checks GitHub for a newer release once a day (Settings → General
→ *Check for updates automatically*, or *Check now*). **Update now** downloads the installer, verifies its
SHA-256 and installs it over the existing one, keeping your data. On Ubuntu the system asks for your
password; on Windows the installer runs silently and ENViewer restarts. No uninstall is needed.

To publish an update: raise the version in package.json, Cargo.toml and src-tauri/tauri.conf.json, commit, then

```bash
git tag v<new-version> && git push origin main --tags
```

GitHub Actions builds the `.deb`, AppImage and the Windows installer and attaches them to a new Release, which is where the apps look.

## Developer

ENViewer is developed by **M. Estiaque Ahmed Khan** · <info@mestiaque.com> · [mestiaque.com](https://mestiaque.com). Bug reports and ideas are welcome.
