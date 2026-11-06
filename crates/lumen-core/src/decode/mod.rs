//! Image decoding service: path → display-ready `DynamicImage`.
//!
//! All decoders apply orientation, so callers never need to rotate. Every call is
//! wrapped in `catch_unwind` so a malformed file cannot take the app down.

#[cfg(feature = "heif")]
pub mod heif;
pub mod raw;

use crate::error::{CoreError, Result};
use crate::formats::{self, DecoderKind};
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageReader, Limits, RgbImage, RgbaImage};
use std::io::BufReader;
use std::path::Path;

pub use raw::RawMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    /// Full resolution for the viewer / export.
    Full,
    /// A thumbnail whose longer side will be at most this many pixels; decoders
    /// may use embedded previews or reduced decoding.
    Thumbnail(u32),
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DecodeOptions {
    pub raw_mode: RawMode,
}

pub struct Decoded {
    pub image: DynamicImage,
    /// Embedded ICC profile, passed through to the webview so it can colour-manage.
    pub icc: Option<Vec<u8>>,
}

/// 2 GiB allocation ceiling – enough for ~500 MP RGBA, but stops absurd headers.
const MAX_ALLOC: u64 = 2 * 1024 * 1024 * 1024;

pub fn orientation_from_exif(v: u8) -> Option<Orientation> {
    Orientation::from_exif(v)
}

pub fn decode(path: &Path, opts: &DecodeOptions, purpose: Purpose) -> Result<Decoded> {
    let fmt = formats::from_path(path).ok_or_else(|| {
        CoreError::Unsupported(path.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default())
    })?;
    if !formats::decoder_available(fmt.decoder) {
        return Err(CoreError::Unsupported(format!("{} (decoder not built in)", fmt.name)));
    }
    let path = path.to_owned();
    let opts = *opts;
    let res = std::panic::catch_unwind(move || -> Result<Decoded> {
        match fmt.decoder {
            DecoderKind::Image => decode_with_image(&path),
            #[cfg(feature = "heif")]
            DecoderKind::Heif => {
                let min = match purpose {
                    Purpose::Thumbnail(px) => Some(px),
                    Purpose::Full => None,
                };
                let (image, icc) = heif::decode(&path, min)?;
                Ok(Decoded { image, icc })
            }
            #[cfg(not(feature = "heif"))]
            DecoderKind::Heif => Err(CoreError::Unsupported("HEIF (built without libheif)".into())),
            DecoderKind::Raw => Ok(Decoded { image: raw::decode(&path, opts.raw_mode, purpose)?, icc: None }),
            DecoderKind::Jxl => decode_jxl(&path),
            DecoderKind::Psd => decode_psd(&path),
            DecoderKind::Svg => decode_svg(&path, purpose),
            DecoderKind::Video => Err(CoreError::Unsupported("video has no still image".into())),
        }
    });
    let decoded = match res {
        Ok(r) => r?,
        Err(_) => return Err(CoreError::Decode("decoder crashed on a malformed file".into())),
    };
    Ok(Decoded { image: to_display_depth(decoded.image), icc: decoded.icc })
}

fn decode_with_image(path: &Path) -> Result<Decoded> {
    let mut reader = ImageReader::open(path)?.with_guessed_format()?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_ALLOC);
    reader.limits(limits);
    let mut dec = reader.into_decoder()?;
    let icc = dec.icc_profile().ok().flatten();
    let orientation = dec.orientation().unwrap_or(Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(dec)?;
    image.apply_orientation(orientation);
    Ok(Decoded { image, icc })
}

fn decode_jxl(path: &Path) -> Result<Decoded> {
    let file = BufReader::new(std::fs::File::open(path)?);
    let mut dec = jxl_oxide::integration::JxlDecoder::new(file)?;
    let icc = dec.icc_profile().ok().flatten();
    let image = DynamicImage::from_decoder(dec)?;
    Ok(Decoded { image, icc })
}

fn decode_psd(path: &Path) -> Result<Decoded> {
    let bytes = std::fs::read(path)?;
    let psd = psd::Psd::from_bytes(&bytes).map_err(|e| CoreError::Decode(format!("PSD: {e}")))?;
    let img = RgbaImage::from_raw(psd.width(), psd.height(), psd.rgba())
        .ok_or_else(|| CoreError::Decode("PSD: inconsistent dimensions".into()))?;
    Ok(Decoded { image: DynamicImage::ImageRgba8(img), icc: None })
}

fn decode_svg(path: &Path, purpose: Purpose) -> Result<Decoded> {
    use resvg::{tiny_skia, usvg};
    let data = std::fs::read(path)?;
    let mut opt = usvg::Options::default();
    opt.resources_dir = path.parent().map(|p| p.to_owned());
    opt.fontdb_mut().load_system_fonts();
    let tree = usvg::Tree::from_data(&data, &opt).map_err(|e| CoreError::Decode(format!("SVG: {e}")))?;
    let size = tree.size();
    let (w, h) = (size.width().max(1.0), size.height().max(1.0));
    // Vectors have no native resolution: rasterise to the requested thumbnail
    // size, or at least 2048 px on the long side for full view.
    let target = match purpose {
        Purpose::Thumbnail(px) => px as f32,
        Purpose::Full => w.max(h).max(2048.0),
    };
    let scale = (target / w.max(h)).min(16384.0 / w.max(h));
    let (pw, ph) = ((w * scale).ceil() as u32, (h * scale).ceil() as u32);
    let mut pixmap = tiny_skia::Pixmap::new(pw.max(1), ph.max(1))
        .ok_or_else(|| CoreError::Decode("SVG: invalid size".into()))?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    let mut buf = Vec::with_capacity((pw * ph * 4) as usize);
    for p in pixmap.pixels() {
        let c = p.demultiply();
        buf.extend_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
    }
    let img = RgbaImage::from_raw(pixmap.width(), pixmap.height(), buf).unwrap();
    Ok(Decoded { image: DynamicImage::ImageRgba8(img), icc: None })
}

/// Floating-point (HDR/EXR) images are tone-mapped with an extended Reinhard
/// curve to 8-bit sRGB; 8/16-bit images are kept as they are.
fn to_display_depth(img: DynamicImage) -> DynamicImage {
    match img {
        DynamicImage::ImageRgb32F(f) => {
            let (w, h) = f.dimensions();
            let white = f.pixels().flat_map(|p| p.0).fold(1.0f32, f32::max).min(64.0);
            let buf = f.into_raw().into_iter().map(|v| tonemap(v, white)).collect();
            DynamicImage::ImageRgb8(RgbImage::from_raw(w, h, buf).unwrap())
        }
        DynamicImage::ImageRgba32F(f) => {
            let (w, h) = f.dimensions();
            let white = f.pixels().flat_map(|p| [p.0[0], p.0[1], p.0[2]]).fold(1.0f32, f32::max).min(64.0);
            let buf = f
                .into_raw()
                .chunks_exact(4)
                .flat_map(|c| [tonemap(c[0], white), tonemap(c[1], white), tonemap(c[2], white), (c[3].clamp(0.0, 1.0) * 255.0).round() as u8])
                .collect();
            DynamicImage::ImageRgba8(RgbaImage::from_raw(w, h, buf).unwrap())
        }
        other => other,
    }
}

fn tonemap(v: f32, white: f32) -> u8 {
    let v = v.max(0.0);
    let mapped = v * (1.0 + v / (white * white)) / (1.0 + v);
    let srgb = if mapped <= 0.003_130_8 { mapped * 12.92 } else { 1.055 * mapped.powf(1.0 / 2.4) - 0.055 };
    (srgb.clamp(0.0, 1.0) * 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, Rgb};

    #[test]
    fn decodes_png_and_reports_unsupported() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.png");
        RgbImage::from_pixel(7, 3, Rgb([10, 20, 30])).save_with_format(&p, ImageFormat::Png).unwrap();
        let d = decode(&p, &DecodeOptions::default(), Purpose::Full).unwrap();
        assert_eq!((d.image.width(), d.image.height()), (7, 3));

        let txt = dir.path().join("a.txt");
        std::fs::write(&txt, "hi").unwrap();
        assert!(matches!(decode(&txt, &DecodeOptions::default(), Purpose::Full), Err(CoreError::Unsupported(_))));
    }

    #[test]
    fn corrupt_file_is_an_error_not_a_crash() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("bad.jpg");
        std::fs::write(&p, [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 1, 2, 3]).unwrap();
        assert!(decode(&p, &DecodeOptions::default(), Purpose::Full).is_err());
    }

    #[test]
    fn svg_renders_at_requested_size() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("c.svg");
        std::fs::write(&p, r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="red"/></svg>"#).unwrap();
        let d = decode(&p, &DecodeOptions::default(), Purpose::Thumbnail(200)).unwrap();
        assert_eq!((d.image.width(), d.image.height()), (200, 100));
        assert_eq!(d.image.to_rgba8().get_pixel(10, 10).0, [255, 0, 0, 255]);
    }

    #[test]
    fn tonemap_is_monotonic_and_bounded() {
        let mut last = 0;
        for i in 0..100 {
            let v = tonemap(i as f32 * 0.1, 8.0);
            assert!(v >= last);
            last = v;
        }
        assert_eq!(tonemap(-1.0, 8.0), 0);
    }
}
