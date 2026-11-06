//! Metadata service. Read-only: nothing here ever writes to an image file.
//!
//! * `probe` – cheap per-file facts used for sorting/filtering large folders
//!   (dimensions, capture date, animation, Live Photo content id).
//! * `image_info` – the full information panel for one image.

use crate::error::Result;
use crate::formats::{self, DecoderKind};
use crate::livephoto;
use exif::{Exif, In, Tag, Value};
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// Display dimensions (after EXIF orientation).
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Capture time from EXIF, as naive local time in ms since the epoch.
    pub captured: Option<i64>,
    pub animated: bool,
    pub content_id: Option<String>,
}

pub fn read_exif(path: &Path) -> Option<Exif> {
    let f = File::open(path).ok()?;
    exif::Reader::new().read_from_container(&mut BufReader::new(f)).ok()
}

pub fn probe(path: &Path) -> Probe {
    let Some(fmt) = formats::from_path(path) else { return Probe::default() };
    let mut p = Probe::default();
    if fmt.decoder == DecoderKind::Video {
        return p;
    }
    let exif = if fmt.raw { None } else { read_exif(path) };
    let orientation = exif.as_ref().and_then(|e| uint(e, Tag::Orientation)).unwrap_or(1);

    if let Ok(sz) = imagesize::size(path) {
        let (mut w, mut h) = (sz.width as u32, sz.height as u32);
        // imagesize already applies HEIF `irot`, and libheif ignores EXIF
        // orientation, so only swap for formats where EXIF is authoritative.
        if fmt.decoder == DecoderKind::Image && (5..=8).contains(&orientation) {
            std::mem::swap(&mut w, &mut h);
        }
        p.width = Some(w);
        p.height = Some(h);
    }
    if let Some(e) = &exif {
        p.captured = ascii(e, Tag::DateTimeOriginal)
            .or_else(|| ascii(e, Tag::DateTimeDigitized))
            .and_then(|s| parse_exif_datetime(&s));
        p.content_id = livephoto::content_id_from_exif(e);
    }
    if fmt.raw {
        if let Ok(d) = crate::decode::raw::details(path) {
            p.captured = d.exif.as_ref().and_then(|x| x.date_time_original.as_deref()).and_then(parse_exif_datetime);
            // The TIFF header of a RAW often describes a small thumbnail; use
            // the sensor size, rotated by the EXIF orientation.
            if let (Some(w), Some(h)) = (d.sensor_width, d.sensor_height) {
                let rot = d.exif.as_ref().and_then(|x| x.orientation).map_or(false, |o| (5..=8).contains(&o));
                let (w, h) = if rot { (h as u32, w as u32) } else { (w as u32, h as u32) };
                p.width = Some(w);
                p.height = Some(h);
            }
        }
    }
    if fmt.may_animate {
        p.animated = detect_animation(path, fmt.id).unwrap_or(false);
    }
    p
}

/// Cheap container-level animation checks (no pixel decoding).
pub fn detect_animation(path: &Path, format_id: &str) -> std::io::Result<bool> {
    let mut f = BufReader::new(File::open(path)?);
    match format_id {
        "gif" => gif_frame_count(&mut f, 2).map(|n| n > 1),
        "png" => {
            // acTL must appear before the first IDAT in an APNG.
            let mut sig = [0u8; 8];
            f.read_exact(&mut sig)?;
            loop {
                let mut hdr = [0u8; 8];
                if f.read_exact(&mut hdr).is_err() {
                    return Ok(false);
                }
                let len = u32::from_be_bytes(hdr[0..4].try_into().unwrap()) as i64;
                match &hdr[4..8] {
                    b"acTL" => return Ok(true),
                    b"IDAT" | b"IEND" => return Ok(false),
                    _ => {
                        f.seek(SeekFrom::Current(len + 4))?;
                    }
                }
            }
        }
        "webp" => {
            let mut h = [0u8; 21];
            if f.read_exact(&mut h).is_err() {
                return Ok(false);
            }
            Ok(&h[12..16] == b"VP8X" && h[20] & 0x02 != 0)
        }
        "avif" => {
            let mut h = [0u8; 64];
            let n = f.read(&mut h)?;
            Ok(h[..n].windows(4).any(|w| w == b"avis"))
        }
        _ => Ok(false),
    }
}

/// Counts GIF image descriptors, stopping at `limit`.
fn gif_frame_count<R: Read + Seek>(f: &mut R, limit: usize) -> std::io::Result<usize> {
    let mut hdr = [0u8; 13];
    f.read_exact(&mut hdr)?;
    if &hdr[0..3] != b"GIF" {
        return Ok(0);
    }
    if hdr[10] & 0x80 != 0 {
        let gct = 3 * (1u64 << ((hdr[10] & 0x07) + 1));
        f.seek(SeekFrom::Current(gct as i64))?;
    }
    let mut frames = 0;
    let mut b = [0u8; 1];
    let skip_sub_blocks = |f: &mut R| -> std::io::Result<()> {
        let mut n = [0u8; 1];
        loop {
            f.read_exact(&mut n)?;
            if n[0] == 0 {
                return Ok(());
            }
            f.seek(SeekFrom::Current(n[0] as i64))?;
        }
    };
    loop {
        if f.read_exact(&mut b).is_err() {
            return Ok(frames);
        }
        match b[0] {
            0x2C => {
                frames += 1;
                if frames >= limit {
                    return Ok(frames);
                }
                let mut d = [0u8; 9];
                f.read_exact(&mut d)?;
                if d[8] & 0x80 != 0 {
                    let lct = 3 * (1u64 << ((d[8] & 0x07) + 1));
                    f.seek(SeekFrom::Current(lct as i64))?;
                }
                f.read_exact(&mut b)?; // LZW minimum code size
                skip_sub_blocks(f)?;
            }
            0x21 => {
                f.read_exact(&mut b)?; // extension label
                skip_sub_blocks(f)?;
            }
            _ => return Ok(frames), // 0x3B trailer or garbage
        }
    }
}

/// "YYYY:MM:DD HH:MM:SS" → milliseconds since 1970 (naive, no timezone).
pub fn parse_exif_datetime(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.len() < 19 {
        return None;
    }
    let n = |a: usize, b: usize| s.get(a..b)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0, 4)?, n(5, 7)?, n(8, 10)?, n(11, 13)?, n(14, 16)?, n(17, 19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || y < 1800 {
        return None;
    }
    Some((days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se) * 1000)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn ascii(e: &Exif, tag: Tag) -> Option<String> {
    match &e.get_field(tag, In::PRIMARY)?.value {
        Value::Ascii(v) => v.first().map(|b| String::from_utf8_lossy(b).trim_end_matches('\0').trim().to_string()).filter(|s| !s.is_empty()),
        _ => None,
    }
}

pub fn uint(e: &Exif, tag: Tag) -> Option<u32> {
    e.get_field(tag, In::PRIMARY)?.value.get_uint(0)
}

fn rational(e: &Exif, tag: Tag) -> Option<f64> {
    match &e.get_field(tag, In::PRIMARY)?.value {
        Value::Rational(v) => v.first().filter(|r| r.denom != 0).map(|r| r.to_f64()),
        Value::SRational(v) => v.first().filter(|r| r.denom != 0).map(|r| r.to_f64()),
        _ => None,
    }
}

fn display(e: &Exif, tag: Tag) -> Option<String> {
    let f = e.get_field(tag, In::PRIMARY)?;
    Some(f.display_value().with_unit(e).to_string())
}

fn gps(e: &Exif) -> Option<Gps> {
    let coord = |tag: Tag, rtag: Tag| -> Option<f64> {
        let Value::Rational(v) = &e.get_field(tag, In::PRIMARY)?.value else { return None };
        if v.len() < 3 || v.iter().any(|r| r.denom == 0) {
            return None;
        }
        let deg = v[0].to_f64() + v[1].to_f64() / 60.0 + v[2].to_f64() / 3600.0;
        let r = ascii(e, rtag).unwrap_or_default();
        Some(if r == "S" || r == "W" { -deg } else { deg })
    };
    let lat = coord(Tag::GPSLatitude, Tag::GPSLatitudeRef)?;
    let lon = coord(Tag::GPSLongitude, Tag::GPSLongitudeRef)?;
    let mut alt = rational(e, Tag::GPSAltitude);
    if uint(e, Tag::GPSAltitudeRef) == Some(1) {
        alt = alt.map(|a| -a);
    }
    Some(Gps { latitude: lat, longitude: lon, altitude: alt })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gps {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CameraInfo {
    pub make: Option<String>,
    pub model: Option<String>,
    pub lens: Option<String>,
    pub focal_length: Option<f64>,
    pub focal_length_35mm: Option<u32>,
    pub aperture: Option<f64>,
    pub exposure_time: Option<String>,
    pub iso: Option<u32>,
    pub exposure_compensation: Option<f64>,
    pub captured: Option<String>,
    pub offset_time: Option<String>,
    pub orientation: Option<u32>,
    pub flash: Option<String>,
    pub white_balance: Option<String>,
    pub exposure_program: Option<String>,
    pub metering_mode: Option<String>,
    pub software: Option<String>,
    pub gps: Option<Gps>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagEntry {
    pub group: String,
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub format: String,
    pub file_size: u64,
    pub modified: Option<i64>,
    pub created: Option<i64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub aspect_ratio: Option<String>,
    pub color_space: Option<String>,
    pub bit_depth: Option<u32>,
    pub has_alpha: Option<bool>,
    pub icc_profile: Option<IccInfo>,
    pub animated: bool,
    pub camera: CameraInfo,
    pub embedded_thumbnail: Option<(u32, u32)>,
    pub raw: Option<crate::decode::raw::RawDetails>,
    #[cfg(feature = "heif")]
    pub heif: Option<crate::decode::heif::HeifDetails>,
    pub hdr: Option<String>,
    pub live_photo_id: Option<String>,
    pub tags: Vec<TagEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IccInfo {
    pub size: usize,
    pub description: Option<String>,
}

/// Extract the human-readable description from an ICC profile ('desc' tag,
/// either ICC v2 `desc` or v4 `mluc` encoding).
pub fn icc_description(icc: &[u8]) -> Option<String> {
    if icc.len() < 132 {
        return None;
    }
    let be32 = |o: usize| icc.get(o..o + 4).map(|b| u32::from_be_bytes(b.try_into().unwrap()) as usize);
    let count = be32(128)?;
    for i in 0..count.min(64) {
        let base = 132 + i * 12;
        if icc.get(base..base + 4)? != b"desc" {
            continue;
        }
        let (off, len) = (be32(base + 4)?, be32(base + 8)?);
        let tag = icc.get(off..off + len)?;
        return match tag.get(0..4)? {
            b"desc" => {
                let n = u32::from_be_bytes(tag.get(8..12)?.try_into().ok()?) as usize;
                let s = tag.get(12..12 + n.saturating_sub(1))?;
                Some(String::from_utf8_lossy(s).trim().to_string())
            }
            b"mluc" => {
                let rec_len = u32::from_be_bytes(tag.get(12..16)?.try_into().ok()?) as usize;
                let _ = rec_len;
                let slen = u32::from_be_bytes(tag.get(20..24)?.try_into().ok()?) as usize;
                let soff = u32::from_be_bytes(tag.get(24..28)?.try_into().ok()?) as usize;
                let utf16: Vec<u16> = tag.get(soff..soff + slen)?.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                Some(String::from_utf16_lossy(&utf16).trim_end_matches('\0').trim().to_string())
            }
            _ => None,
        };
    }
    None
}

fn gcd(a: u32, b: u32) -> u32 {
    if b == 0 { a } else { gcd(b, a % b) }
}

pub fn aspect_ratio(w: u32, h: u32) -> String {
    if w == 0 || h == 0 {
        return String::new();
    }
    let g = gcd(w, h);
    let (a, b) = (w / g, h / g);
    if a <= 50 && b <= 50 {
        format!("{a}:{b}")
    } else {
        format!("{:.2}:1", w as f64 / h as f64)
    }
}

fn to_ms(t: std::io::Result<std::time::SystemTime>) -> Option<i64> {
    t.ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

/// Full information for the info panel. Decodes only headers, plus (for formats
/// without cheap headers) one decode via the decoding service.
pub fn image_info(path: &Path) -> Result<ImageInfo> {
    let meta = std::fs::metadata(path)?;
    let fmt = formats::from_path(path);
    let mut info = ImageInfo {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        extension: path.extension().map(|e| e.to_string_lossy().to_uppercase()).unwrap_or_default(),
        format: fmt.map(|f| f.name.to_string()).unwrap_or_else(|| "Unknown".into()),
        file_size: meta.len(),
        modified: to_ms(meta.modified()),
        created: to_ms(meta.created()),
        ..Default::default()
    };
    let Some(fmt) = fmt else { return Ok(info) };
    if fmt.decoder == DecoderKind::Video {
        return Ok(info);
    }

    let p = probe(path);
    info.width = p.width;
    info.height = p.height;
    info.animated = p.animated;
    info.live_photo_id = p.content_id.clone();

    if let Some(e) = read_exif(path) {
        let c = &mut info.camera;
        c.make = ascii(&e, Tag::Make);
        c.model = ascii(&e, Tag::Model);
        c.lens = ascii(&e, Tag::LensModel).or_else(|| ascii(&e, Tag::LensMake));
        c.focal_length = rational(&e, Tag::FocalLength);
        c.focal_length_35mm = uint(&e, Tag::FocalLengthIn35mmFilm);
        c.aperture = rational(&e, Tag::FNumber);
        c.exposure_time = e.get_field(Tag::ExposureTime, In::PRIMARY).and_then(|f| match &f.value {
            Value::Rational(v) if !v.is_empty() && v[0].denom != 0 => {
                let r = v[0];
                Some(if r.to_f64() >= 1.0 || r.num == 0 { format!("{}s", r.to_f64()) } else { format!("1/{}s", (r.denom as f64 / r.num as f64).round()) })
            }
            _ => None,
        });
        c.iso = uint(&e, Tag::PhotographicSensitivity);
        c.exposure_compensation = rational(&e, Tag::ExposureBiasValue);
        c.captured = ascii(&e, Tag::DateTimeOriginal).or_else(|| ascii(&e, Tag::DateTime));
        c.offset_time = ascii(&e, Tag::OffsetTimeOriginal);
        c.orientation = uint(&e, Tag::Orientation);
        c.flash = display(&e, Tag::Flash);
        c.white_balance = display(&e, Tag::WhiteBalance);
        c.exposure_program = display(&e, Tag::ExposureProgram);
        c.metering_mode = display(&e, Tag::MeteringMode);
        c.software = ascii(&e, Tag::Software);
        c.gps = gps(&e);
        info.color_space = display(&e, Tag::ColorSpace);
        if let (Some(w), Some(_)) = (uint(&e, Tag::JPEGInterchangeFormat), uint(&e, Tag::JPEGInterchangeFormatLength)) {
            let _ = w;
            let tw = e.get_field(Tag::ImageWidth, In::THUMBNAIL).and_then(|f| f.value.get_uint(0)).unwrap_or(0);
            let th = e.get_field(Tag::ImageLength, In::THUMBNAIL).and_then(|f| f.value.get_uint(0)).unwrap_or(0);
            info.embedded_thumbnail = Some((tw, th));
        }
        info.tags = e
            .fields()
            .filter(|f| f.tag != Tag::MakerNote && !matches!(f.value, Value::Undefined(ref b, _) if b.len() > 64))
            .map(|f| TagEntry {
                group: format!("{:?}", f.ifd_num).replace("In(", "IFD").replace(')', ""),
                name: f.tag.to_string(),
                value: f.display_value().with_unit(&e).to_string().chars().take(200).collect(),
            })
            .collect();
    }

    if fmt.raw {
        if let Ok(d) = crate::decode::raw::details(path) {
            let c = &mut info.camera;
            if c.make.is_none() {
                c.make = Some(d.make.clone());
                c.model = Some(d.model.clone());
            }
            if let Some(x) = &d.exif {
                c.lens = c.lens.take().or(d.lens.clone());
                c.aperture = c.aperture.or(x.fnumber);
                c.iso = c.iso.or(x.iso);
                c.focal_length = c.focal_length.or(x.focal_length);
                c.exposure_compensation = c.exposure_compensation.or(x.exposure_bias);
                c.captured = c.captured.take().or(x.date_time_original.clone());
                c.orientation = c.orientation.or(x.orientation.map(u32::from));
                if c.exposure_time.is_none() {
                    c.exposure_time = x.exposure_time.map(|(n, d)| if n >= d || n == 0 { format!("{}s", n as f64 / d.max(1) as f64) } else { format!("1/{}s", (d as f64 / n as f64).round()) });
                }
                if c.gps.is_none() {
                    c.gps = x.gps.map(|(la, lo, al)| Gps { latitude: la, longitude: lo, altitude: al });
                }
            }
            if info.width.is_none() {
                info.width = d.sensor_width.map(|v| v as u32);
                info.height = d.sensor_height.map(|v| v as u32);
            }
            info.bit_depth = d.bits_per_sample;
            info.raw = Some(d);
        }
    }

    #[cfg(feature = "heif")]
    if fmt.decoder == DecoderKind::Heif {
        if let Ok(h) = crate::decode::heif::details(path) {
            info.bit_depth = Some(h.bit_depth);
            info.has_alpha = Some(h.has_alpha);
            if h.bit_depth > 8 {
                info.hdr = Some(format!("{}-bit HEIF", h.bit_depth));
            }
            info.heif = Some(h);
        }
    }

    // Colour type, bit depth and ICC from the decoder header (cheap for the
    // `image` crate formats).
    if fmt.decoder == DecoderKind::Image {
        if let Ok(r) = image::ImageReader::open(path).and_then(|r| r.with_guessed_format()) {
            if let Ok(mut d) = r.into_decoder() {
                use image::ImageDecoder;
                let ct = d.color_type();
                info.bit_depth = Some(ct.bits_per_pixel() as u32 / ct.channel_count() as u32);
                info.has_alpha = Some(ct.has_alpha());
                if let Ok(Some(icc)) = d.icc_profile() {
                    info.icc_profile = Some(IccInfo { size: icc.len(), description: icc_description(&icc) });
                }
                if matches!(fmt.id, "hdr" | "exr") {
                    info.hdr = Some("High dynamic range (tone-mapped for display)".into());
                }
            }
        }
    }
    #[cfg(feature = "heif")]
    if fmt.decoder == DecoderKind::Heif && info.icc_profile.is_none() {
        if let Ok((_, Some(icc))) = crate::decode::heif::decode(path, Some(1)).map(|(_, i)| ((), i)) {
            info.icc_profile = Some(IccInfo { size: icc.len(), description: icc_description(&icc) });
        }
    }
    if info.color_space.is_none() {
        info.color_space = info.icc_profile.as_ref().and_then(|i| i.description.clone());
    }
    if let (Some(w), Some(h)) = (info.width, info.height) {
        info.aspect_ratio = Some(aspect_ratio(w, h));
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exif_dates() {
        assert_eq!(parse_exif_datetime("1970:01:01 00:00:00"), Some(0));
        assert_eq!(parse_exif_datetime("2024:02:29 12:30:15"), Some(1_709_209_815_000));
        assert_eq!(parse_exif_datetime("0000:00:00 00:00:00"), None);
        assert_eq!(parse_exif_datetime("garbage"), None);
    }

    #[test]
    fn ratios() {
        assert_eq!(aspect_ratio(4032, 3024), "4:3");
        assert_eq!(aspect_ratio(1920, 1080), "16:9");
        assert_eq!(aspect_ratio(1001, 1000), "1.00:1");
    }

    #[test]
    fn gif_animation_detection() {
        use image::codecs::gif::GifEncoder;
        use image::{Delay, Frame, RgbaImage};
        let dir = tempfile::tempdir().unwrap();
        let mk = |name: &str, n: usize| {
            let p = dir.path().join(name);
            let mut enc = GifEncoder::new(File::create(&p).unwrap());
            for i in 0..n {
                let img = RgbaImage::from_pixel(4, 4, image::Rgba([i as u8 * 50, 0, 0, 255]));
                enc.encode_frame(Frame::from_parts(img, 0, 0, Delay::from_numer_denom_ms(100, 1))).unwrap();
            }
            drop(enc);
            p
        };
        assert!(!detect_animation(&mk("one.gif", 1), "gif").unwrap());
        assert!(detect_animation(&mk("three.gif", 3), "gif").unwrap());
    }

    #[test]
    fn probe_png_dimensions() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.png");
        image::RgbImage::new(30, 20).save(&p).unwrap();
        let pr = probe(&p);
        assert_eq!((pr.width, pr.height), (Some(30), Some(20)));
        assert!(!pr.animated);
    }
}
