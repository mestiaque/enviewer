//! Apple Live Photo detection.
//!
//! A Live Photo is a still (HEIC, or JPEG when exported "most compatible") plus
//! a short QuickTime movie. Apple links them with a shared UUID:
//!   * still: Apple MakerNote tag 0x0011 (ContentIdentifier)
//!   * movie: `com.apple.quicktime.content.identifier` in the `moov/meta` keys
//!
//! Pairing rules (applied to a still and a movie that share a file stem in the
//! same folder):
//!   1. Both identifiers present → paired only if they are equal (verified).
//!   2. Movie identifier present but still has none (edited/exported stills) →
//!      paired if the movie is short.
//!   3. No identifiers → paired only if the movie is short (≤ 6 s) and small,
//!      and reported as *unverified*.
//!   4. Movie longer than 6 s without a matching id → never a Live Photo.

use exif::{Exif, In, Tag, Value};
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub const MAX_LIVE_DURATION_SECS: f64 = 6.0;
/// iPhone Live Photo movies are typically 1–6 MB; anything far larger is a regular video.
pub const MAX_UNVERIFIED_SIZE: u64 = 40 * 1024 * 1024;

pub const STILL_EXTENSIONS: &[&str] = &["heic", "heif", "jpg", "jpeg"];
pub const MOTION_EXTENSIONS: &[&str] = &["mov", "mp4"];

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovInfo {
    pub duration_secs: Option<f64>,
    pub content_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Pairing {
    /// Content identifiers match.
    Verified,
    /// Same stem and plausible movie; no identifiers to confirm.
    Probable,
    /// Not a Live Photo pair.
    None,
}

pub fn decide(still_id: Option<&str>, mov: &MovInfo, mov_size: u64) -> Pairing {
    let short = mov.duration_secs.map_or(false, |d| d <= MAX_LIVE_DURATION_SECS);
    match (still_id, mov.content_id.as_deref()) {
        (Some(a), Some(b)) => {
            if a.eq_ignore_ascii_case(b) {
                Pairing::Verified
            } else {
                Pairing::None
            }
        }
        (None, Some(_)) if short => Pairing::Probable,
        (_, None) if short && mov_size <= MAX_UNVERIFIED_SIZE => Pairing::Probable,
        _ => Pairing::None,
    }
}

/// Parse an Apple MakerNote ("Apple iOS\0" header + big-endian IFD) and return
/// tag 0x0011 (ContentIdentifier).
pub fn parse_apple_makernote(mn: &[u8]) -> Option<String> {
    if !mn.starts_with(b"Apple iOS\0") || mn.len() < 16 {
        return None;
    }
    let le = &mn[12..14] == b"II";
    let u16_at = |o: usize| mn.get(o..o + 2).map(|b| if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) });
    let u32_at = |o: usize| mn.get(o..o + 4).map(|b| {
        let a = [b[0], b[1], b[2], b[3]];
        if le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) }
    });
    let count = u16_at(14)? as usize;
    for i in 0..count.min(256) {
        let e = 16 + i * 12;
        let tag = u16_at(e)?;
        if tag != 0x0011 {
            continue;
        }
        let typ = u16_at(e + 2)?;
        let n = u32_at(e + 4)? as usize;
        if typ != 2 || n == 0 || n > 256 {
            return None;
        }
        // Offsets in the Apple MakerNote are relative to the MakerNote start.
        let data = if n <= 4 { mn.get(e + 8..e + 8 + n)? } else { mn.get(u32_at(e + 8)? as usize..u32_at(e + 8)? as usize + n)? };
        let s = String::from_utf8_lossy(data).trim_end_matches('\0').trim().to_string();
        return (!s.is_empty()).then_some(s);
    }
    None
}

pub fn content_id_from_exif(e: &Exif) -> Option<String> {
    match &e.get_field(Tag::MakerNote, In::PRIMARY)?.value {
        Value::Undefined(b, _) => parse_apple_makernote(b),
        _ => None,
    }
}

const MAX_MOOV: u64 = 32 * 1024 * 1024;

/// Read the duration and Apple content identifier from a QuickTime/MP4 file
/// without reading the media data.
pub fn read_mov_info(path: &Path) -> std::io::Result<MovInfo> {
    let mut f = File::open(path)?;
    let len = f.metadata()?.len();
    let mut pos = 0u64;
    while pos + 8 <= len {
        f.seek(SeekFrom::Start(pos))?;
        let mut h = [0u8; 8];
        f.read_exact(&mut h)?;
        let mut size = u32::from_be_bytes(h[0..4].try_into().unwrap()) as u64;
        let mut hdr = 8u64;
        if size == 1 {
            let mut l = [0u8; 8];
            f.read_exact(&mut l)?;
            size = u64::from_be_bytes(l);
            hdr = 16;
        } else if size == 0 {
            size = len - pos;
        }
        if size < hdr {
            break;
        }
        if &h[4..8] == b"moov" {
            let body = size - hdr;
            if body > MAX_MOOV {
                break;
            }
            let mut buf = vec![0u8; body as usize];
            f.read_exact(&mut buf)?;
            return Ok(parse_moov(&buf));
        }
        pos += size;
    }
    Ok(MovInfo::default())
}

fn boxes(buf: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    let mut pos = 0usize;
    std::iter::from_fn(move || {
        if pos + 8 > buf.len() {
            return None;
        }
        let size = u32::from_be_bytes(buf[pos..pos + 4].try_into().unwrap()) as usize;
        let typ = &buf[pos + 4..pos + 8];
        let (start, end) = match size {
            0 => (pos + 8, buf.len()),
            1 => {
                let big = u64::from_be_bytes(buf.get(pos + 8..pos + 16)?.try_into().ok()?) as usize;
                (pos + 16, pos.checked_add(big)?)
            }
            s if s >= 8 => (pos + 8, pos + s),
            _ => return None,
        };
        if end > buf.len() || start > end {
            return None;
        }
        pos = end;
        Some((typ, &buf[start..end]))
    })
}

fn parse_moov(moov: &[u8]) -> MovInfo {
    let mut info = MovInfo::default();
    for (typ, body) in boxes(moov) {
        match typ {
            b"mvhd" if !body.is_empty() => {
                let v = body[0];
                let (ts, dur) = if v == 1 && body.len() >= 32 {
                    (u32::from_be_bytes(body[20..24].try_into().unwrap()) as f64, u64::from_be_bytes(body[24..32].try_into().unwrap()) as f64)
                } else if body.len() >= 20 {
                    (u32::from_be_bytes(body[12..16].try_into().unwrap()) as f64, u32::from_be_bytes(body[16..20].try_into().unwrap()) as f64)
                } else {
                    (0.0, 0.0)
                };
                if ts > 0.0 {
                    info.duration_secs = Some(dur / ts);
                }
            }
            b"meta" => {
                if let Some(id) = parse_mdta_meta(body) {
                    info.content_id = Some(id);
                }
            }
            b"udta" => {
                for (t, b) in boxes(body) {
                    // Some writers put the mdta `meta` under `udta`, with a 4-byte full-box header.
                    if t == b"meta" && info.content_id.is_none() {
                        info.content_id = parse_mdta_meta(b).or_else(|| b.get(4..).and_then(parse_mdta_meta));
                    }
                }
            }
            _ => {}
        }
    }
    info
}

fn parse_mdta_meta(meta: &[u8]) -> Option<String> {
    let mut keys: Vec<Vec<u8>> = Vec::new();
    let mut ilst: Option<&[u8]> = None;
    for (t, b) in boxes(meta) {
        match t {
            b"keys" if b.len() >= 8 => {
                let n = u32::from_be_bytes(b[4..8].try_into().unwrap()) as usize;
                let mut p = 8;
                for _ in 0..n.min(512) {
                    let sz = u32::from_be_bytes(b.get(p..p + 4)?.try_into().ok()?) as usize;
                    if sz < 8 || p + sz > b.len() {
                        break;
                    }
                    keys.push(b[p + 8..p + sz].to_vec());
                    p += sz;
                }
            }
            b"ilst" => ilst = Some(b),
            _ => {}
        }
    }
    let idx = keys.iter().position(|k| k == b"com.apple.quicktime.content.identifier")? as u32 + 1;
    for (t, item) in boxes(ilst?) {
        if u32::from_be_bytes(t.try_into().ok()?) != idx {
            continue;
        }
        for (dt, data) in boxes(item) {
            if dt == b"data" && data.len() > 8 {
                let s = String::from_utf8_lossy(&data[8..]).trim_end_matches('\0').trim().to_string();
                if !s.is_empty() {
                    return Some(s);
                }
            }
        }
    }
    None
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn bx(typ: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend_from_slice(typ);
        v.extend_from_slice(body);
        v
    }

    /// Builds a minimal QuickTime file with a duration and optional content id.
    pub fn synth_mov(duration_secs: u32, id: Option<&str>) -> Vec<u8> {
        let mut mvhd = vec![0u8; 100];
        mvhd[12..16].copy_from_slice(&600u32.to_be_bytes());
        mvhd[16..20].copy_from_slice(&(duration_secs * 600).to_be_bytes());
        let mut moov_body = bx(b"mvhd", &mvhd);
        if let Some(id) = id {
            let key = b"com.apple.quicktime.content.identifier";
            let mut keys = vec![0, 0, 0, 0, 0, 0, 0, 1];
            keys.extend(((key.len() + 8) as u32).to_be_bytes());
            keys.extend(b"mdta");
            keys.extend(key);
            let mut data = vec![0, 0, 0, 1, 0, 0, 0, 0];
            data.extend(id.as_bytes());
            let item = bx(&1u32.to_be_bytes(), &bx(b"data", &data));
            let mut hdlr = vec![0u8; 8];
            hdlr.extend(b"mdta");
            hdlr.extend([0u8; 13]);
            let mut meta = bx(b"hdlr", &hdlr);
            meta.extend(bx(b"keys", &keys));
            meta.extend(bx(b"ilst", &item));
            moov_body.extend(bx(b"meta", &meta));
        }
        let mut file = bx(b"ftyp", b"qt  \0\0\0\0qt  ");
        file.extend(bx(b"mdat", &[0u8; 64]));
        file.extend(bx(b"moov", &moov_body));
        file
    }

    pub fn synth_makernote(id: &str) -> Vec<u8> {
        let mut mn = b"Apple iOS\0\0\x01MM".to_vec();
        mn.extend(1u16.to_be_bytes());
        let off = 16 + 12 + 4;
        mn.extend(0x0011u16.to_be_bytes());
        mn.extend(2u16.to_be_bytes());
        mn.extend(((id.len() + 1) as u32).to_be_bytes());
        mn.extend((off as u32).to_be_bytes());
        mn.extend([0u8; 4]);
        mn.extend(id.as_bytes());
        mn.push(0);
        mn
    }

    #[test]
    fn makernote_content_id() {
        let id = "8A1C2B3D-1111-2222-3333-444455556666";
        assert_eq!(parse_apple_makernote(&synth_makernote(id)).as_deref(), Some(id));
        assert_eq!(parse_apple_makernote(b"Nikon\0junk"), None);
    }

    #[test]
    fn mov_parsing() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("IMG_0001.MOV");
        std::fs::write(&p, synth_mov(3, Some("ABC-123"))).unwrap();
        let info = read_mov_info(&p).unwrap();
        assert_eq!(info.duration_secs, Some(3.0));
        assert_eq!(info.content_id.as_deref(), Some("ABC-123"));

        std::fs::write(&p, synth_mov(30, None)).unwrap();
        let info = read_mov_info(&p).unwrap();
        assert_eq!(info.duration_secs, Some(30.0));
        assert_eq!(info.content_id, None);

        std::fs::write(&p, b"not a movie at all").unwrap();
        assert_eq!(read_mov_info(&p).unwrap(), MovInfo::default());
    }

    #[test]
    fn pairing_rules() {
        let m = |d: f64, id: Option<&str>| MovInfo { duration_secs: Some(d), content_id: id.map(String::from) };
        assert_eq!(decide(Some("A"), &m(2.0, Some("a")), 3_000_000), Pairing::Verified);
        assert_eq!(decide(Some("A"), &m(2.0, Some("B")), 3_000_000), Pairing::None);
        assert_eq!(decide(None, &m(2.5, None), 3_000_000), Pairing::Probable);
        assert_eq!(decide(None, &m(45.0, None), 3_000_000), Pairing::None);
        assert_eq!(decide(None, &m(3.0, None), 500_000_000), Pairing::None);
        assert_eq!(decide(Some("A"), &MovInfo::default(), 3_000_000), Pairing::None);
        assert_eq!(decide(None, &m(2.0, Some("X")), 3_000_000), Pairing::Probable);
    }
}
