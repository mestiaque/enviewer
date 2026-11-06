//! Encoders used to hand decoded pixels to the webview or to write exports.

use crate::error::{CoreError, Result};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{DynamicImage, ExtendedColorType, ImageEncoder};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

/// Lossless, fast PNG for viewer display. Keeps 16-bit depth and the ICC
/// profile so the webview can colour-manage.
pub fn display_png(img: &DynamicImage, icc: Option<&[u8]>) -> Result<Vec<u8>> {
    let img = match img {
        DynamicImage::ImageRgb8(_) | DynamicImage::ImageRgba8(_) | DynamicImage::ImageRgb16(_) | DynamicImage::ImageRgba16(_) | DynamicImage::ImageLuma8(_) | DynamicImage::ImageLumaA8(_) => std::borrow::Cow::Borrowed(img),
        other if other.color().has_alpha() => std::borrow::Cow::Owned(DynamicImage::ImageRgba8(other.to_rgba8())),
        other => std::borrow::Cow::Owned(DynamicImage::ImageRgb8(other.to_rgb8())),
    };
    let mut out = Vec::with_capacity((img.width() * img.height()) as usize);
    let mut enc = PngEncoder::new_with_quality(&mut out, CompressionType::Fast, FilterType::Adaptive);
    if let Some(icc) = icc {
        let _ = enc.set_icc_profile(icc.to_vec());
    }
    let ct: ExtendedColorType = img.color().into();
    // PNG stores 16-bit samples big-endian; `image` handles the byte swap.
    enc.write_image(img.as_bytes(), img.width(), img.height(), ct)?;
    Ok(out)
}

pub fn jpeg(img: &DynamicImage, quality: u8) -> Result<Vec<u8>> {
    let rgb = img.to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100)).encode_image(&rgb)?;
    Ok(out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Jpeg,
    Png,
    Webp,
    Tiff,
    Bmp,
}

impl ExportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Jpeg => "jpg",
            ExportFormat::Png => "png",
            ExportFormat::Webp => "webp",
            ExportFormat::Tiff => "tif",
            ExportFormat::Bmp => "bmp",
        }
    }
}

/// Encode for export. WebP is lossless (the bundled encoder has no lossy mode).
pub fn encode(img: &DynamicImage, fmt: ExportFormat, quality: u8) -> Result<Vec<u8>> {
    let mut out = Cursor::new(Vec::new());
    match fmt {
        ExportFormat::Jpeg => return jpeg(img, quality),
        ExportFormat::Png => {
            let enc = PngEncoder::new_with_quality(&mut out, CompressionType::Best, FilterType::Adaptive);
            img.write_with_encoder(enc)?;
        }
        ExportFormat::Webp => {
            let rgba = DynamicImage::ImageRgba8(img.to_rgba8());
            rgba.write_to(&mut out, image::ImageFormat::WebP)?;
        }
        ExportFormat::Tiff => {
            let i = if img.color().has_alpha() { DynamicImage::ImageRgba8(img.to_rgba8()) } else { DynamicImage::ImageRgb8(img.to_rgb8()) };
            i.write_to(&mut out, image::ImageFormat::Tiff)?;
        }
        ExportFormat::Bmp => {
            let i = if img.color().has_alpha() { DynamicImage::ImageRgba8(img.to_rgba8()) } else { DynamicImage::ImageRgb8(img.to_rgb8()) };
            i.write_to(&mut out, image::ImageFormat::Bmp)?;
        }
    }
    let v = out.into_inner();
    if v.is_empty() {
        return Err(CoreError::Other("encoder produced no data".into()));
    }
    Ok(v)
}
