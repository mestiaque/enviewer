# Release checklist

## Before tagging

- [ ] `pnpm typecheck && pnpm test` pass
- [ ] `cargo test --workspace --release` passes on Linux **and** Windows (CI green)
- [ ] `cargo clippy --workspace -- -D warnings` is clean
- [ ] Version bumped in `package.json`, `Cargo.toml` (workspace) and `src-tauri/tauri.conf.json`
- [ ] `docs/FORMATS.md` re-verified with `cargo run --release --example format_check -- <sample dir>` against the sample set (HEIC, AVIF, JXL, DNG/ProRAW, CR2/CR3, NEF, ARW, RAF, ORF, RW2, PEF, PSD, TIFF, animated GIF/WebP/APNG, Live Photo pair)
- [ ] Dependency licences reviewed (`cargo deny check licenses`) and `docs/DEPENDENCIES.md` updated

## Manual test pass (each platform)

- [ ] Fresh install: app starts on Home, no console errors
- [ ] Open a folder with 10 000+ images: first tiles appear in < 1 s, scrolling stays smooth, memory stays bounded
- [ ] Mouse-wheel zoom keeps the pixel under the cursor fixed (start, middle and end of the animation); fast scrolling is responsive; zoom limits respected
- [ ] Double-click toggles fit/100 %; drag-pan is clamped at edges; 100 % is pixel-exact on a HiDPI display
- [ ] ←/→, side buttons, mouse back/forward buttons and touchpad swipe navigate; the wheel never navigates
- [ ] iPhone HEIC opens with the correct orientation; the Live Photo plays on hover, and with sound on Space/click
- [ ] An unrelated long `.MOV` with the same name as a photo is **not** treated as a Live Photo
- [ ] RAW (embedded and develop modes), JXL, PSD, TIFF, SVG and animated GIF/WebP/APNG display; pausing an animation works
- [ ] A corrupt file shows an error with "Open with default app" instead of crashing
- [ ] Rotate/flip/edit never change the file's mtime; export creates a new file and refuses to overwrite the original
- [ ] Copy/move/rename to an existing name produces `name (2).ext`; Trash goes to the system Trash
- [ ] Batch rename preview shows conflicts and refuses to run until they are fixed
- [ ] Favourites, collections, recents and settings persist across restarts
- [ ] File associations: double-clicking a `.heic`/`.jpg` opens ENViewer; a second open switches the running window

## Packaging

- [ ] Linux: `scripts/build-linux.sh` → install the `.deb` on a clean Ubuntu 22.04 and 24.04 VM; run the AppImage on a clean system
- [ ] Linux: desktop entry, icon and "Open With" appear in Files (Nautilus)
- [ ] Windows: NSIS installer on clean Windows 10 22H2 and Windows 11; Start-menu shortcut, uninstaller, file associations
- [ ] Windows: portable zip runs from a USB stick with no install
- [ ] Code-sign the Windows binaries (if a certificate is available)
- [ ] Attach the artifacts and the checksums (`sha256sum`) to the release
