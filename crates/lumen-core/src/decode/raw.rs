//! Camera RAW decoding through `rawler`.
//!
//! Two strategies:
//! * `Embedded` (default) – use the camera-rendered JPEG preview stored in the
//!   RAW. Fast, and matches what the camera showed.
//! * `Develop` – demosaic the sensor data with rawler's default pipeline.

use super::{orientation_from_exif, Purpose};
use crate::error::{CoreError, Result};
use image::DynamicImage;
use rawler::decoders::RawDecodeParams;
use rawler::rawsource::RawSource;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum RawMode {
    #[default]
    Embedded,
    Develop,
}

fn err<E: std::fmt::Display>(e: E) -> CoreError {
    CoreError::Decode(format!("RAW: {e}"))
}

fn long_side(img: &DynamicImage) -> u32 {
    img.width().max(img.height())
}

pub fn decode(path: &Path, mode: RawMode, purpose: Purpose) -> Result<DynamicImage> {
    let src = RawSource::new(path)?;
    let decoder = rawler::get_decoder(&src).map_err(err)?;
    let params = RawDecodeParams::default();
    let orientation = decoder
        .raw_metadata(&src, &params)
        .ok()
        .and_then(|m| m.exif.orientation)
        .and_then(|o| orientation_from_exif(o as u8));

    // Embedded images from smallest to largest; decoded lazily, stopping at the
    // first one that is big enough.
    let embedded = |min: u32| -> Option<DynamicImage> {
        let mut best: Option<DynamicImage> = None;
        for which in 0..3 {
            let c = match which {
                0 => decoder.thumbnail_image(&src, &params),
                1 => decoder.preview_image(&src, &params),
                _ => decoder.full_image(&src, &params),
            };
            let Some(c) = c.ok().flatten() else { continue };
            if long_side(&c) >= min {
                return Some(c);
            }
            if best.as_ref().map_or(true, |b| long_side(&c) > long_side(b)) {
                best = Some(c);
            }
        }
        best
    };

    let mut img = match (purpose, mode) {
        (Purpose::Thumbnail(px), _) => match embedded(px) {
            Some(i) => i,
            None => develop(path)?,
        },
        (Purpose::Full, RawMode::Embedded) => {
            // Use the camera preview only if it is close to sensor resolution;
            // small previews (e.g. Sony's 1616 px) would throw away detail.
            let sensor = decoder.raw_image(&src, &params, true).ok().map(|r| r.width.max(r.height) as u32).unwrap_or(0);
            match embedded(u32::MAX) {
                Some(i) if long_side(&i) >= 1000 && long_side(&i) * 2 >= sensor => i,
                _ => develop(path)?,
            }
        }
        (Purpose::Full, RawMode::Develop) => develop(path)?,
    };
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Ok(img)
}

fn develop(path: &Path) -> Result<DynamicImage> {
    let raw = rawler::decode_file(path).map_err(err)?;
    let dev = rawler::imgop::develop::RawDevelop::default();
    let inter = dev.develop_intermediate(&raw).map_err(err)?;
    let img = inter
        .to_dynamic_image()
        .ok_or_else(|| CoreError::Decode("RAW: develop produced no image".into()))?;
    // rawler develops to 16-bit; 8-bit is plenty for display and halves memory.
    Ok(DynamicImage::ImageRgb8(img.to_rgb8()))
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RawDetails {
    pub make: String,
    pub model: String,
    pub lens: Option<String>,
    pub sensor_width: Option<usize>,
    pub sensor_height: Option<usize>,
    pub cfa: Option<String>,
    pub bits_per_sample: Option<u32>,
    pub exif: Option<RawExif>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RawExif {
    pub exposure_time: Option<(u32, u32)>,
    pub fnumber: Option<f64>,
    pub iso: Option<u32>,
    pub focal_length: Option<f64>,
    pub exposure_bias: Option<f64>,
    pub date_time_original: Option<String>,
    pub orientation: Option<u16>,
    pub lens_model: Option<String>,
    pub gps: Option<(f64, f64, Option<f64>)>,
}

pub fn details(path: &Path) -> Result<RawDetails> {
    let src = RawSource::new(path)?;
    let decoder = rawler::get_decoder(&src).map_err(err)?;
    let params = RawDecodeParams::default();
    let md = decoder.raw_metadata(&src, &params).map_err(err)?;
    let raw = decoder.raw_image(&src, &params, true).ok();
    let ex = &md.exif;
    let r = |r: &rawler::formats::tiff::Rational| if r.d == 0 { 0.0 } else { r.n as f64 / r.d as f64 };
    let gps = ex.gps.as_ref().and_then(|g| {
        let dms = |v: &[rawler::formats::tiff::Rational; 3]| r(&v[0]) + r(&v[1]) / 60.0 + r(&v[2]) / 3600.0;
        let mut lat = dms(g.gps_latitude.as_ref()?);
        let mut lon = dms(g.gps_longitude.as_ref()?);
        if g.gps_latitude_ref.as_deref() == Some("S") {
            lat = -lat;
        }
        if g.gps_longitude_ref.as_deref() == Some("W") {
            lon = -lon;
        }
        Some((lat, lon, g.gps_altitude.as_ref().map(r)))
    });
    Ok(RawDetails {
        make: md.make.clone(),
        model: md.model.clone(),
        lens: md.lens.as_ref().map(|l| l.lens_name.clone()).or_else(|| ex.lens_model.clone()),
        sensor_width: raw.as_ref().map(|r| r.width),
        sensor_height: raw.as_ref().map(|r| r.height),
        cfa: raw.as_ref().map(|r| {
            // e.g. "Cfa(CFAConfig { cfa: CFA { RGGB }, …" → "CFA RGGB"
            let dbg = format!("{:?}", r.photometric);
            match dbg.find("CFA { ").and_then(|i| dbg[i + 6..].split(' ').next().map(str::to_string)) {
                Some(p) => format!("Bayer CFA ({p})"),
                None => dbg.split(['(', ' ']).next().unwrap_or("").to_string(),
            }
        }),
        bits_per_sample: raw.as_ref().map(|r| r.bps as u32),
        exif: Some(RawExif {
            exposure_time: ex.exposure_time.as_ref().map(|e| (e.n, e.d)),
            fnumber: ex.fnumber.as_ref().map(r),
            iso: ex.iso_speed_ratings.map(u32::from).or(ex.iso_speed),
            focal_length: ex.focal_length.as_ref().map(r),
            exposure_bias: ex.exposure_bias.as_ref().map(|s| if s.d == 0 { 0.0 } else { s.n as f64 / s.d as f64 }),
            date_time_original: ex.date_time_original.clone(),
            orientation: ex.orientation,
            lens_model: ex.lens_model.clone(),
            gps,
        }),
    })
}
