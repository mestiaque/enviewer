//! Filesystem scanning: list one folder's media and pair Live Photos.

use crate::error::Result;
use crate::formats::{self, MediaKind};
use crate::livephoto::{self, Pairing};
use crate::metadata;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveInfo {
    pub video: String,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub format: &'static str,
    pub kind: MediaKind,
    pub size: u64,
    pub modified: i64,
    pub created: Option<i64>,
    pub raw: bool,
    pub may_animate: bool,
    pub webview_native: bool,
    /// Present on a still that has a paired motion component.
    pub live: Option<LiveInfo>,
    /// True for a movie that is the motion half of a Live Photo (hidden in grids).
    pub companion: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub total: usize,
    pub live_photos: usize,
    pub skipped: usize,
}

fn ms(t: std::io::Result<std::time::SystemTime>) -> Option<i64> {
    t.ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

pub fn is_hidden(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).map_or(false, |n| n.starts_with('.'))
}

pub fn item_for(path: &Path) -> Option<MediaItem> {
    let fmt = formats::from_path(path)?;
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    Some(MediaItem {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name()?.to_string_lossy().into_owned(),
        ext: path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default(),
        format: fmt.id,
        kind: fmt.kind,
        size: meta.len(),
        modified: ms(meta.modified()).unwrap_or(0),
        created: ms(meta.created()),
        raw: fmt.raw,
        may_animate: fmt.may_animate,
        webview_native: fmt.webview_native,
        live: None,
        companion: false,
    })
}

/// Group key for Live Photo pairing: parent dir + lowercase stem.
fn stem_key(p: &str) -> String {
    let path = Path::new(p);
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    format!("{}\u{0}{}", path.parent().map(|d| d.to_string_lossy()).unwrap_or_default(), stem)
}

/// Pair stills and movies in-place. Returns the number of Live Photos.
pub fn pair_live_photos(items: &mut [MediaItem]) -> usize {
    let mut stills: HashMap<String, usize> = HashMap::new();
    let mut movies: HashMap<String, usize> = HashMap::new();
    for (i, it) in items.iter().enumerate() {
        if livephoto::STILL_EXTENSIONS.contains(&it.ext.as_str()) {
            // Prefer HEIC over JPEG when both exist for the same stem.
            let k = stem_key(&it.path);
            if !stills.contains_key(&k) || it.ext.starts_with("hei") {
                stills.insert(k, i);
            }
        } else if livephoto::MOTION_EXTENSIONS.contains(&it.ext.as_str()) {
            movies.insert(stem_key(&it.path), i);
        }
    }
    let candidates: Vec<(usize, usize)> = stills.iter().filter_map(|(k, &s)| movies.get(k).map(|&m| (s, m))).collect();
    let decisions: Vec<(usize, usize, Pairing)> = candidates
        .par_iter()
        .map(|&(s, m)| {
            let still_id = metadata::read_exif(Path::new(&items[s].path)).and_then(|e| livephoto::content_id_from_exif(&e));
            let mov = livephoto::read_mov_info(Path::new(&items[m].path)).unwrap_or_default();
            (s, m, livephoto::decide(still_id.as_deref(), &mov, items[m].size))
        })
        .collect();
    let mut n = 0;
    for (s, m, d) in decisions {
        if d == Pairing::None {
            continue;
        }
        n += 1;
        items[s].live = Some(LiveInfo { video: items[m].path.clone(), verified: d == Pairing::Verified });
        items[m].companion = true;
    }
    n
}

/// List the media files directly inside `dir` (non-recursive), pair Live
/// Photos, and deliver them in batches.
pub fn scan_folder(
    dir: &Path,
    include_hidden: bool,
    batch_size: usize,
    cancel: &AtomicBool,
    mut on_batch: impl FnMut(Vec<MediaItem>),
) -> Result<ScanSummary> {
    let mut summary = ScanSummary::default();
    let mut paths: Vec<PathBuf> = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        if cancel.load(Ordering::Relaxed) {
            return Err(crate::error::CoreError::Cancelled);
        }
        let Ok(entry) = entry else {
            summary.skipped += 1;
            continue;
        };
        let p = entry.path();
        if !include_hidden && is_hidden(&p) {
            continue;
        }
        if formats::from_path(&p).is_some() {
            paths.push(p);
        }
    }
    let mut items: Vec<MediaItem> = paths.par_iter().filter_map(|p| item_for(p)).collect();
    summary.skipped += paths.len() - items.len();
    if cancel.load(Ordering::Relaxed) {
        return Err(crate::error::CoreError::Cancelled);
    }
    summary.live_photos = pair_live_photos(&mut items);
    // ENViewer shows images only: a movie is kept solely as the motion part of a Live Photo
    // (flagged `companion`, hidden by the UI); standalone videos are left out.
    items.retain(|i| i.kind == MediaKind::Image || i.companion);
    items.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    summary.total = items.len();
    for chunk in items.chunks(batch_size.max(1)) {
        if cancel.load(Ordering::Relaxed) {
            return Err(crate::error::CoreError::Cancelled);
        }
        on_batch(chunk.to_vec());
    }
    Ok(summary)
}

/// Build items for an arbitrary list of files (favourites, collections,
/// recents). Missing files are skipped. Live Photo motion files next to the
/// stills are discovered and paired, but only the requested files are returned.
pub fn items_for_paths(paths: &[String]) -> Vec<MediaItem> {
    let requested: Vec<MediaItem> = paths.par_iter().filter_map(|p| item_for(Path::new(p))).collect();
    let mut all = requested.clone();
    for it in &requested {
        if !livephoto::STILL_EXTENSIONS.contains(&it.ext.as_str()) {
            continue;
        }
        let p = Path::new(&it.path);
        for ext in ["MOV", "mov", "MP4", "mp4"] {
            let m = p.with_extension(ext);
            if m.exists() && !all.iter().any(|a| a.path == m.to_string_lossy()) {
                if let Some(mi) = item_for(&m) {
                    all.push(mi);
                }
                break;
            }
        }
    }
    pair_live_photos(&mut all);
    let wanted: std::collections::HashSet<&str> = paths.iter().map(|s| s.as_str()).collect();
    let mut out: Vec<MediaItem> =
        all.into_iter().filter(|i| i.kind == MediaKind::Image && wanted.contains(i.path.as_str())).collect();
    // Preserve the caller's order.
    let order: HashMap<&str, usize> = paths.iter().enumerate().map(|(i, p)| (p.as_str(), i)).collect();
    out.sort_by_key(|i| order.get(i.path.as_str()).copied().unwrap_or(usize::MAX));
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubFolder {
    pub path: String,
    pub name: String,
}

pub fn list_subfolders(dir: &Path, include_hidden: bool) -> Result<Vec<SubFolder>> {
    let mut out: Vec<SubFolder> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| include_hidden || !is_hidden(p))
        .map(|p| SubFolder { name: p.file_name().unwrap_or_default().to_string_lossy().into_owned(), path: p.to_string_lossy().into_owned() })
        .collect();
    out.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    Ok(out)
}

/// Case-insensitive natural ordering ("IMG_2" < "IMG_10").
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (mut ai, mut bi) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut na = String::new();
                while let Some(c) = ai.peek().copied().filter(|c| c.is_ascii_digit()) {
                    na.push(c);
                    ai.next();
                }
                let mut nb = String::new();
                while let Some(c) = bi.peek().copied().filter(|c| c.is_ascii_digit()) {
                    nb.push(c);
                    bi.next();
                }
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let o = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if o != Ordering::Equal {
                    return o;
                }
            }
            (Some(x), Some(y)) => {
                let o = x.to_lowercase().cmp(y.to_lowercase());
                if o != Ordering::Equal {
                    return o;
                }
                ai.next();
                bi.next();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::livephoto::tests::synth_mov;

    #[test]
    fn natural_ordering() {
        let mut v = vec!["IMG_10.jpg", "img_2.jpg", "IMG_1.jpg", "a.png"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, ["a.png", "IMG_1.jpg", "img_2.jpg", "IMG_10.jpg"]);
    }

    #[test]
    fn scan_pairs_live_photos_and_ignores_unrelated() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        image::RgbImage::new(4, 4).save(d.join("IMG_0001.jpg")).unwrap();
        std::fs::write(d.join("IMG_0001.MOV"), synth_mov(2, None)).unwrap();
        image::RgbImage::new(4, 4).save(d.join("IMG_0002.jpg")).unwrap();
        std::fs::write(d.join("IMG_0002.MOV"), synth_mov(90, None)).unwrap(); // regular video
        std::fs::write(d.join("holiday.mov"), synth_mov(2, None)).unwrap(); // no still
        std::fs::write(d.join("notes.txt"), "x").unwrap();
        image::RgbImage::new(4, 4).save(d.join(".hidden.png")).unwrap();

        let cancel = AtomicBool::new(false);
        let mut all = Vec::new();
        let s = scan_folder(d, false, 2, &cancel, |b| all.extend(b)).unwrap();
        // 2 stills + the Live Photo's motion file; standalone videos are not listed.
        assert_eq!(s.total, 3);
        assert_eq!(s.live_photos, 1);
        let get = |n: &str| all.iter().find(|i| i.name == n);
        assert!(get("IMG_0001.jpg").unwrap().live.as_ref().is_some_and(|l| !l.verified && l.video.ends_with("IMG_0001.MOV")));
        assert!(get("IMG_0001.MOV").unwrap().companion);
        assert!(get("IMG_0002.jpg").unwrap().live.is_none());
        assert!(get("IMG_0002.MOV").is_none(), "a regular video next to a photo is not shown");
        assert!(get("holiday.mov").is_none(), "standalone videos are not shown");
    }

    #[test]
    fn scan_can_be_cancelled() {
        let dir = tempfile::tempdir().unwrap();
        image::RgbImage::new(4, 4).save(dir.path().join("a.png")).unwrap();
        let cancel = AtomicBool::new(true);
        assert!(scan_folder(dir.path(), false, 10, &cancel, |_| {}).is_err());
    }
}
