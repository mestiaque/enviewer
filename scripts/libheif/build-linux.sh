#!/usr/bin/env bash
# Builds a current libheif for the Linux packages and installs it into vendor/libheif.
#
# Why: Ubuntu 22.04 ships libheif 1.12 (2021). It cannot open HEIC photos from iOS 18 and later
# (HDR photos with a gain map: brands "tmap"/"MiHE") and stops with "Metadata not correctly
# assigned to image". ENViewer therefore bundles its own libheif in /usr/lib/enviewer and finds it
# through the binary's RUNPATH; the system libheif is left alone.
#
# Codecs: HEVC through libde265 and AV1 through dav1d (both from Ubuntu), built in, no plugins.
# libheif is LGPL-3.0 and stays a separate shared library.
#
# Usage: scripts/libheif/build-linux.sh   (needs cmake, a C++20 compiler, libde265-dev, libdav1d-dev)
set -euo pipefail
VERSION=1.23.6
SHA256=4484346dc5995319dbc11e3a1c35d0a2ec46511ce370900869337fd2c7033125
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PREFIX="$ROOT/vendor/libheif"
WORK="${TMPDIR:-/tmp}/libheif-build-$VERSION"

if [ -f "$PREFIX/lib/libheif.so.1" ] && grep -q "\"$VERSION\"" "$PREFIX/VERSION" 2>/dev/null; then
  echo "libheif $VERSION already built in $PREFIX"; exit 0
fi

mkdir -p "$WORK"
TARBALL="$WORK/libheif-$VERSION.tar.gz"
[ -f "$TARBALL" ] || curl -fsSL -o "$TARBALL" "https://github.com/strukturag/libheif/releases/download/v$VERSION/libheif-$VERSION.tar.gz"
echo "$SHA256  $TARBALL" | sha256sum -c -
rm -rf "$WORK/src" "$WORK/build" && mkdir -p "$WORK/src" && tar xzf "$TARBALL" -C "$WORK/src" --strip-components=1

cmake -S "$WORK/src" -B "$WORK/build" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_INSTALL_LIBDIR=lib \
  -DBUILD_SHARED_LIBS=ON -DBUILD_TESTING=OFF -DWITH_EXAMPLES=OFF -DWITH_GDK_PIXBUF=OFF \
  -DENABLE_PLUGIN_LOADING=OFF \
  -DWITH_LIBDE265=ON -DWITH_DAV1D=ON \
  -DWITH_X265=OFF -DWITH_AOM_DECODER=OFF -DWITH_AOM_ENCODER=OFF -DWITH_RAV1E=OFF -DWITH_SvtEnc=OFF \
  -DWITH_KVAZAAR=OFF -DWITH_UVG266=OFF -DWITH_VVDEC=OFF -DWITH_VVENC=OFF -DWITH_FFMPEG_DECODER=OFF \
  -DWITH_JPEG_DECODER=OFF -DWITH_JPEG_ENCODER=OFF -DWITH_OpenJPEG_DECODER=OFF -DWITH_OpenJPEG_ENCODER=OFF \
  -DWITH_OPENJPH_ENCODER=OFF -DWITH_OPENJPH_DECODER=OFF -DWITH_LIBSHARPYUV=OFF -DWITH_HEADER_COMPRESSION=OFF \
  -DWITH_UNCOMPRESSED_CODEC=OFF -DENABLE_EXPERIMENTAL_FEATURES=OFF
cmake --build "$WORK/build" -j"$(nproc)"
rm -rf "$PREFIX"
cmake --install "$WORK/build"
echo "\"$VERSION\"" > "$PREFIX/VERSION"
# The packages ship the library under its SONAME.
cp -L "$PREFIX/lib/libheif.so.1" "$PREFIX/libheif.so.1"
echo "libheif $VERSION installed in $PREFIX"
ldd "$PREFIX/libheif.so.1" | grep -E "de265|dav1d" || true
