//! Format capability registry.
//!
//! Every file type Lumen recognises is listed here exactly once, together with
//! the decoder that handles it and whether the webview can display the original
//! bytes directly. Availability is computed at runtime: a format whose decoder
//! was not compiled in is reported as unavailable instead of silently failing.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DecoderKind {
    /// The `image` crate (pure Rust).
    Image,
    /// System libheif (HEIC / HEIF / AVIF).
    Heif,
    /// `rawler` – camera RAW (embedded preview or full develop).
    Raw,
    /// `jxl-oxide` – JPEG XL.
    Jxl,
    /// `psd` – flattened composite of Photoshop documents.
    Psd,
    /// `resvg` – SVG rasteriser (used for thumbnails / svgz).
    Svg,
    /// Played by the webview's media stack; no still decoder.
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Image,
    Video,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub extensions: &'static [&'static str],
    pub kind: MediaKind,
    pub decoder: DecoderKind,
    /// The webview can render the original file (asset protocol). The backend
    /// decoder is used as a fallback if the webview refuses it.
    pub webview_native: bool,
    pub may_animate: bool,
    pub raw: bool,
    pub notes: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatCapability {
    #[serde(flatten)]
    pub info: FormatInfo,
    pub available: bool,
}

macro_rules! fmt {
    ($id:expr, $name:expr, [$($e:expr),*], $kind:ident, $dec:ident, native=$n:expr, anim=$a:expr, raw=$r:expr, $notes:expr) => {
        FormatInfo { id: $id, name: $name, extensions: &[$($e),*], kind: MediaKind::$kind, decoder: DecoderKind::$dec,
                     webview_native: $n, may_animate: $a, raw: $r, notes: $notes }
    };
}

static REGISTRY: &[FormatInfo] = &[
    fmt!("jpeg", "JPEG", ["jpg", "jpeg", "jpe", "jfif"], Image, Image, native = true, anim = false, raw = false, ""),
    fmt!("png", "PNG / APNG", ["png", "apng"], Image, Image, native = true, anim = true, raw = false, "APNG animates in the viewer"),
    fmt!("gif", "GIF", ["gif"], Image, Image, native = true, anim = true, raw = false, ""),
    fmt!("webp", "WebP", ["webp"], Image, Image, native = true, anim = true, raw = false, "Animated WebP plays in the viewer"),
    fmt!("bmp", "BMP", ["bmp", "dib"], Image, Image, native = true, anim = false, raw = false, ""),
    fmt!("ico", "ICO", ["ico"], Image, Image, native = true, anim = false, raw = false, ""),
    fmt!("tiff", "TIFF", ["tif", "tiff"], Image, Image, native = false, anim = false, raw = false, "First page only"),
    fmt!("svg", "SVG", ["svg"], Image, Svg, native = true, anim = false, raw = false, ""),
    fmt!("svgz", "SVG (compressed)", ["svgz"], Image, Svg, native = false, anim = false, raw = false, ""),
    fmt!("avif", "AVIF", ["avif"], Image, Heif, native = true, anim = true, raw = false, "Decoded by the webview; libheif fallback"),
    fmt!("heic", "HEIC / HEIF", ["heic", "heif", "hif", "heics"], Image, Heif, native = false, anim = false, raw = false, "Requires libheif"),
    fmt!("jxl", "JPEG XL", ["jxl"], Image, Jxl, native = false, anim = false, raw = false, "First frame only"),
    fmt!("psd", "Photoshop (preview)", ["psd"], Image, Psd, native = false, anim = false, raw = false, "Flattened composite; PSB not supported"),
    fmt!("hdr", "Radiance HDR", ["hdr"], Image, Image, native = false, anim = false, raw = false, "Tone-mapped to SDR"),
    fmt!("exr", "OpenEXR", ["exr"], Image, Image, native = false, anim = false, raw = false, "Tone-mapped to SDR"),
    fmt!("tga", "TGA", ["tga"], Image, Image, native = false, anim = false, raw = false, ""),
    fmt!("pnm", "Netpbm", ["pbm", "pgm", "ppm", "pnm", "pam"], Image, Image, native = false, anim = false, raw = false, ""),
    fmt!("qoi", "QOI", ["qoi"], Image, Image, native = false, anim = false, raw = false, ""),
    fmt!("dng", "DNG / Apple ProRAW", ["dng"], Image, Raw, native = false, anim = false, raw = true, ""),
    fmt!("canon", "Canon RAW", ["cr2", "cr3", "crw"], Image, Raw, native = false, anim = false, raw = true, ""),
    fmt!("nikon", "Nikon RAW", ["nef", "nrw"], Image, Raw, native = false, anim = false, raw = true, ""),
    fmt!("sony", "Sony RAW", ["arw", "srf", "sr2"], Image, Raw, native = false, anim = false, raw = true, ""),
    fmt!("fuji", "Fujifilm RAW", ["raf"], Image, Raw, native = false, anim = false, raw = true, ""),
    fmt!("olympus", "Olympus / OM RAW", ["orf"], Image, Raw, native = false, anim = false, raw = true, ""),
    fmt!("panasonic", "Panasonic RAW", ["rw2"], Image, Raw, native = false, anim = false, raw = true, ""),
    fmt!("pentax", "Pentax RAW", ["pef"], Image, Raw, native = false, anim = false, raw = true, ""),
    fmt!("samsung", "Samsung RAW", ["srw"], Image, Raw, native = false, anim = false, raw = true, ""),
    fmt!("othraw", "Other RAW", ["3fr", "iiq", "mrw", "kdc", "dcr", "erf", "mef", "mos", "ari"], Image, Raw, native = false, anim = false, raw = true, "Coverage depends on camera model"),
    fmt!("mov", "QuickTime video", ["mov", "qt"], Video, Video, native = true, anim = true, raw = false, "Codec support depends on the OS media stack"),
    fmt!("mp4", "MPEG-4 video", ["mp4", "m4v"], Video, Video, native = true, anim = true, raw = false, "Codec support depends on the OS media stack"),
    fmt!("webm", "WebM video", ["webm"], Video, Video, native = true, anim = true, raw = false, "Codec support depends on the OS media stack"),
];

pub fn registry() -> &'static [FormatInfo] {
    REGISTRY
}

pub fn decoder_available(d: DecoderKind) -> bool {
    match d {
        DecoderKind::Heif => cfg!(feature = "heif"),
        _ => true,
    }
}

pub fn capabilities() -> Vec<FormatCapability> {
    REGISTRY
        .iter()
        .map(|f| FormatCapability {
            info: f.clone(),
            // AVIF is still usable without libheif because the webview decodes it.
            available: decoder_available(f.decoder) || f.webview_native,
        })
        .collect()
}

pub fn by_extension(ext: &str) -> Option<&'static FormatInfo> {
    let ext = ext.to_ascii_lowercase();
    REGISTRY.iter().find(|f| f.extensions.contains(&ext.as_str()))
}

pub fn from_path(path: &Path) -> Option<&'static FormatInfo> {
    path.extension().and_then(|e| e.to_str()).and_then(by_extension)
}

pub fn by_id(id: &str) -> Option<&'static FormatInfo> {
    REGISTRY.iter().find(|f| f.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for f in REGISTRY {
            for e in f.extensions {
                assert!(seen.insert(*e), "duplicate extension {e}");
                assert_eq!(*e, e.to_ascii_lowercase());
            }
        }
    }

    #[test]
    fn lookup_is_case_insensitive() {
        assert_eq!(by_extension("HEIC").unwrap().id, "heic");
        assert_eq!(from_path(Path::new("/a/IMG_0001.JPG")).unwrap().id, "jpeg");
        assert_eq!(from_path(Path::new("/a/clip.MOV")).unwrap().kind, MediaKind::Video);
        assert!(from_path(Path::new("/a/notes.txt")).is_none());
        assert!(from_path(Path::new("/a/noext")).is_none());
    }
}
