//! Non-destructive editing engine.
//!
//! Edits are a list of parameters stored in the database; the original file is
//! never touched. `apply` renders them for export. The colour operations use
//! the same formulas as the CSS/SVG filters the viewer uses for live preview
//! (brightness/contrast/saturate per the Filter Effects spec), so the export
//! matches what the user saw. Sharpening uses a true unsharp mask on export;
//! the preview approximates it with a 3x3 convolution.

use image::{DynamicImage, Rgba32FImage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct Crop {
    /// Normalised (0..1) rectangle in the original (unrotated) image.
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EditParams {
    /// Clockwise quarter turns, 0..=3.
    pub rotate: u8,
    pub flip_h: bool,
    pub flip_v: bool,
    pub crop: Option<Crop>,
    /// -1..1 → CSS brightness(1 + v)
    pub brightness: f32,
    /// -1..1 → CSS contrast(1 + v)
    pub contrast: f32,
    /// -1..1 → CSS saturate(1 + v)
    pub saturation: f32,
    /// EV stops, -3..3 → multiplier 2^v
    pub exposure: f32,
    /// -1 (cool) .. 1 (warm)
    pub temperature: f32,
    /// 0..1 unsharp-mask amount
    pub sharpness: f32,
}

impl EditParams {
    pub fn is_identity(&self) -> bool {
        *self == EditParams::default()
    }
}

/// Order: crop (in original orientation) → rotate → flip → temperature → exposure·brightness → contrast → saturation → sharpen.
pub fn apply(img: DynamicImage, p: &EditParams) -> DynamicImage {
    let mut img = img;
    if let Some(c) = p.crop {
        let (w, h) = (img.width() as f32, img.height() as f32);
        let x = ((c.x.clamp(0.0, 1.0) * w).round() as u32).min(img.width() - 1);
        let y = ((c.y.clamp(0.0, 1.0) * h).round() as u32).min(img.height() - 1);
        let cw = ((c.w.clamp(0.0, 1.0) * w).round() as u32).clamp(1, img.width() - x);
        let ch = ((c.h.clamp(0.0, 1.0) * h).round() as u32).clamp(1, img.height() - y);
        img = img.crop_imm(x, y, cw, ch);
    }
    img = match p.rotate % 4 {
        1 => img.rotate90(),
        2 => img.rotate180(),
        3 => img.rotate270(),
        _ => img,
    };
    if p.flip_h {
        img = img.fliph();
    }
    if p.flip_v {
        img = img.flipv();
    }
    let colour = p.brightness != 0.0 || p.contrast != 0.0 || p.saturation != 0.0 || p.exposure != 0.0 || p.temperature != 0.0;
    if colour {
        let had_alpha = img.color().has_alpha();
        let mut f: Rgba32FImage = img.to_rgba32f();
        let mul = 2f32.powf(p.exposure) * (1.0 + p.brightness);
        let k = 1.0 + p.contrast;
        let s = 1.0 + p.saturation;
        let (tr, tb) = temperature_gains(p.temperature);
        // CSS saturate() matrix.
        let m = [
            [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
            [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
            [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
        ];
        for px in f.pixels_mut() {
            let [r, g, b, _] = &mut px.0;
            let mut c = [(*r * tr).min(1.0), *g, (*b * tb).min(1.0)];
            for v in &mut c {
                *v = ((*v * mul).min(1.0) - 0.5) * k + 0.5;
                *v = v.clamp(0.0, 1.0);
            }
            let out = [
                m[0][0] * c[0] + m[0][1] * c[1] + m[0][2] * c[2],
                m[1][0] * c[0] + m[1][1] * c[1] + m[1][2] * c[2],
                m[2][0] * c[0] + m[2][1] * c[1] + m[2][2] * c[2],
            ];
            *r = out[0].clamp(0.0, 1.0);
            *g = out[1].clamp(0.0, 1.0);
            *b = out[2].clamp(0.0, 1.0);
        }
        let f = DynamicImage::ImageRgba32F(f);
        img = if had_alpha { DynamicImage::ImageRgba8(f.to_rgba8()) } else { DynamicImage::ImageRgb8(f.to_rgb8()) };
    }
    if p.sharpness > 0.0 {
        img = unsharp(&img, p.sharpness);
    }
    img
}

/// Warm boosts red and cuts blue; cool does the opposite. Same gains as the
/// SVG feColorMatrix used for preview.
pub fn temperature_gains(t: f32) -> (f32, f32) {
    let t = t.clamp(-1.0, 1.0);
    (1.0 + 0.25 * t, 1.0 - 0.25 * t)
}

fn unsharp(img: &DynamicImage, amount: f32) -> DynamicImage {
    let blurred = img.blur(1.2);
    let amount = amount.clamp(0.0, 1.0) * 1.5;
    let mut a = img.to_rgba8();
    let b = blurred.to_rgba8();
    for (pa, pb) in a.pixels_mut().zip(b.pixels()) {
        for c in 0..3 {
            let v = pa.0[c] as f32 + amount * (pa.0[c] as f32 - pb.0[c] as f32);
            pa.0[c] = v.round().clamp(0.0, 255.0) as u8;
        }
    }
    if img.color().has_alpha() { DynamicImage::ImageRgba8(a) } else { DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(a).to_rgb8()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    #[test]
    fn identity_is_noop() {
        let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(3, 2, Rgb([10, 128, 250])));
        let out = apply(img.clone(), &EditParams::default());
        assert_eq!(out.to_rgb8(), img.to_rgb8());
    }

    #[test]
    fn rotate_flip_crop_geometry() {
        let mut src = RgbImage::new(4, 2);
        src.put_pixel(0, 0, Rgb([255, 0, 0]));
        let img = DynamicImage::ImageRgb8(src);
        let out = apply(img.clone(), &EditParams { rotate: 1, ..Default::default() });
        assert_eq!((out.width(), out.height()), (2, 4));
        // Top-left red pixel ends up top-right after a clockwise turn.
        assert_eq!(out.to_rgb8().get_pixel(1, 0).0, [255, 0, 0]);

        let out = apply(img.clone(), &EditParams { flip_h: true, ..Default::default() });
        assert_eq!(out.to_rgb8().get_pixel(3, 0).0, [255, 0, 0]);

        let out = apply(img, &EditParams { crop: Some(Crop { x: 0.5, y: 0.0, w: 0.5, h: 1.0 }), ..Default::default() });
        assert_eq!((out.width(), out.height()), (2, 2));
    }

    #[test]
    fn colour_ops_follow_css_semantics() {
        let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(1, 1, Rgb([100, 100, 100])));
        let bright = apply(img.clone(), &EditParams { brightness: 0.5, ..Default::default() });
        assert_eq!(bright.to_rgb8().get_pixel(0, 0).0, [150, 150, 150]);
        let ev = apply(img.clone(), &EditParams { exposure: 1.0, ..Default::default() });
        assert_eq!(ev.to_rgb8().get_pixel(0, 0).0, [200, 200, 200]);
        // Grey stays grey under saturation changes.
        let sat = apply(img.clone(), &EditParams { saturation: 1.0, ..Default::default() });
        let p = sat.to_rgb8().get_pixel(0, 0).0;
        assert!(p.iter().all(|&c| (c as i32 - 100).abs() <= 1));
        let warm = apply(img, &EditParams { temperature: 1.0, ..Default::default() });
        let p = warm.to_rgb8().get_pixel(0, 0).0;
        assert!(p[0] > 100 && p[2] < 100);
    }
}
