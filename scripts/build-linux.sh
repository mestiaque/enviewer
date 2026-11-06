#!/usr/bin/env bash
# Build Lumen's Linux bundles (.deb + AppImage). Run on Ubuntu 22.04+ with the
# dependencies from docs/BUILDING.md installed, or inside scripts/docker/Dockerfile.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
pnpm test
cargo test --release --workspace
pnpm tauri build --bundles deb,appimage "$@"
ls -lh target/release/bundle/deb/*.deb target/release/bundle/appimage/*.AppImage
