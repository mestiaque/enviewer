# Building ENViewer

End users do **not** need Node.js, Rust or any development tools: the `.deb`,
AppImage and Windows installer/portable builds are self-contained (on Windows
the libheif DLLs are bundled next to `enviewer.exe`).

## Toolchain (both platforms)

| Tool    | Version used | Notes |
|---------|--------------|-------|
| Rust    | stable (1.80+) | `rustup` |
| Node.js | 20 LTS       | |
| pnpm    | 9.x          | `corepack enable && corepack prepare pnpm@9.15.0 --activate` |

```bash
pnpm install
pnpm tauri dev          # run with hot reload
pnpm test               # frontend unit tests (Vitest)
cargo test --workspace  # Rust unit tests
pnpm tauri build        # release bundles for the current OS
```

## Ubuntu (22.04 or newer)

```bash
sudo apt install -y build-essential curl pkg-config file patchelf cmake \
  libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libssl-dev libxdo-dev \
  libheif-dev \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav   # video / Live Photo playback

scripts/build-linux.sh
# → target/release/bundle/deb/ENViewer_0.2.3_amd64.deb
# → target/release/bundle/appimage/ENViewer_0.2.3_amd64.AppImage
```

The `.deb` declares its runtime dependencies (`libwebkit2gtk-4.1-0`,
`libheif1`, GStreamer plugins), so `sudo apt install ./ENViewer_*.deb` pulls them in.
The AppImage bundles its libraries, including the GStreamer media framework.

### Building without installing anything on the host (Docker)

```bash
docker build -t lumen-build scripts/docker
scripts/docker/run.sh scripts/build-linux.sh
```

The container is Ubuntu 22.04 with every dependency, plus Xvfb for headless UI
testing. The host's cargo registry is mounted so crates download only once.

## Windows 10 / 11

1. Install Visual Studio 2022 Build Tools ("Desktop development with C++"),
   Rust (MSVC toolchain), Node 20 and pnpm. WebView2 ships with Windows 10 21H2+
   and Windows 11; the installer bootstraps it on older systems.
2. Install libheif (HEIC/HEIF/AVIF) with vcpkg:
   ```powershell
   git clone https://github.com/microsoft/vcpkg C:\vcpkg; C:\vcpkg\bootstrap-vcpkg.bat
   C:\vcpkg\vcpkg install libheif:x64-windows
   $env:LIBHEIF_DIR = "C:\vcpkg\installed\x64-windows"
   ```
3. Copy the runtime DLLs where the bundler picks them up, then build:
   ```powershell
   New-Item -ItemType Directory -Force src-tauri\dlls
   Copy-Item "$env:LIBHEIF_DIR\bin\*.dll" src-tauri\dlls\
   pnpm install
   pnpm tauri build --bundles nsis --config src-tauri/tauri.windows.conf.json
   ```
   * Installer: `target\release\bundle\nsis\ENViewer_0.2.3_x64-setup.exe`
     (per-user install, Start-menu shortcut, optional desktop shortcut, file
     associations, "Open with" entries).
   * Portable: copy `target\release\enviewer.exe` together with the DLLs from
     `src-tauri\dlls` into one folder.

To build without HEIC support (no libheif needed), use
`pnpm tauri build -- --no-default-features`. HEIC then shows as unavailable in
Settings → File formats, and opening one shows a clear error. AVIF still works
because the webview decodes it.

## Continuous integration

`.github/workflows/build.yml` runs type-checking, both test suites and the
bundlers on `ubuntu-22.04` (deb + AppImage) and `windows-latest` (NSIS +
portable zip), and uploads the artifacts.
