#!/usr/bin/env bash
# Run a command inside the lumen-build container with the project mounted at /src.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$HOME/.cargo/registry"
exec docker run --rm -i --init \
  --user "$(id -u):$(id -g)" -e HOME=/tmp/home -e CARGO_INCREMENTAL=0 \
  -v "$ROOT":/src -v "$HOME/.cargo/registry":/opt/cargo/registry \
  -w /src lumen-build bash -lc "mkdir -p /tmp/home && $*"
