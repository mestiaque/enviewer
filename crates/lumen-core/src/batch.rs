//! Batch rename and batch convert/resize/export.

use crate::decode::{self, DecodeOptions, Purpose};
use crate::edit::{self, EditParams};
use crate::encode::{self, ExportFormat};
use crate::error::{CoreError, Result};
use crate::fileops::{self, OpResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePlan {
    pub source: String,
    pub new_name: String,
    pub conflict: Option<String>,
}

/// Expand a rename pattern. Tokens:
/// `{name}` original stem, `{ext}` extension, `{n}` / `{n:4}` counter (zero-padded),
/// `{date}` modified date YYYY-MM-DD, `{captured}` capture date (falls back to modified).
pub fn expand_pattern(pattern: &str, stem: &str, ext: &str, index: usize, start: usize, date: &str, captured: Option<&str>) -> String {
    let mut out = String::new();
    let mut rest = pattern;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let Some(close) = rest[open..].find('}') else {
            out.push_str(&rest[open..]);
            rest = "";
            break;
        };
        let token = &rest[open + 1..open + close];
        let (name, arg) = token.split_once(':').unwrap_or((token, ""));
        match name {
            "name" => out.push_str(stem),
            "ext" => out.push_str(ext),
            "n" => {
                let width: usize = arg.parse().unwrap_or(0);
                out.push_str(&format!("{:0width$}", index + start, width = width));
            }
            "date" => out.push_str(date),
            "captured" => out.push_str(captured.unwrap_or(date)),
            _ => out.push_str(&rest[open..open + close + 1]),
        }
        rest = &rest[open + close + 1..];
    }
    out.push_str(rest);
    out
}

fn ymd(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    // civil_from_days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameInput {
    pub path: String,
    pub modified: i64,
    pub captured: Option<i64>,
}

pub fn plan_rename(inputs: &[RenameInput], pattern: &str, start: usize, keep_ext: bool) -> Vec<RenamePlan> {
    let sources: HashSet<&str> = inputs.iter().map(|i| i.path.as_str()).collect();
    let mut taken: HashSet<String> = HashSet::new();
    inputs
        .iter()
        .enumerate()
        .map(|(i, inp)| {
            let p = Path::new(&inp.path);
            let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let ext = p.extension().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let captured = inp.captured.map(ymd);
            let mut name = expand_pattern(pattern, &stem, &ext, i, start, &ymd(inp.modified), captured.as_deref());
            if keep_ext && !ext.is_empty() && !pattern.contains("{ext}") {
                name = format!("{name}.{ext}");
            }
            let target = p.parent().unwrap_or(Path::new("")).join(&name);
            let conflict = if let Err(e) = fileops::validate_file_name(&name) {
                Some(e.to_string())
            } else if !taken.insert(target.to_string_lossy().to_lowercase()) {
                Some("Duplicate name in this batch".into())
            } else if target.exists() && !sources.contains(target.to_string_lossy().as_ref()) {
                Some("A file with this name already exists".into())
            } else {
                None
            };
            RenamePlan { source: inp.path.clone(), new_name: name, conflict }
        })
        .collect()
}

/// Execute a rename plan in two phases (to temporary names first) so swaps
/// like a→b, b→a work. Refuses to run if any entry has a conflict.
pub fn execute_rename(plan: &[RenamePlan]) -> Result<Vec<OpResult>> {
    if let Some(c) = plan.iter().find(|p| p.conflict.is_some()) {
        return Err(CoreError::Other(format!("{}: {}", c.new_name, c.conflict.as_ref().unwrap())));
    }
    let mut staged: Vec<(PathBuf, PathBuf, PathBuf)> = Vec::new();
    let mut results = Vec::new();
    for (i, p) in plan.iter().enumerate() {
        let src = PathBuf::from(&p.source);
        let dir = src.parent().unwrap_or(Path::new("")).to_path_buf();
        let tmp = dir.join(format!(".lumen-rename-{}-{i}", std::process::id()));
        match std::fs::rename(&src, &tmp) {
            Ok(()) => staged.push((src, tmp, dir.join(&p.new_name))),
            Err(e) => results.push(OpResult { source: p.source.clone(), target: None, error: Some(e.to_string()) }),
        }
    }
    for (src, tmp, dst) in staged {
        let r = if dst.exists() {
            // Someone created the file meanwhile – restore the original name.
            let _ = std::fs::rename(&tmp, &src);
            Err("A file with this name appeared during the rename".to_string())
        } else {
            std::fs::rename(&tmp, &dst).map_err(|e| {
                let _ = std::fs::rename(&tmp, &src);
                e.to_string()
            })
        };
        results.push(match r {
            Ok(()) => OpResult { source: src.to_string_lossy().into_owned(), target: Some(dst.to_string_lossy().into_owned()), error: None },
            Err(e) => OpResult { source: src.to_string_lossy().into_owned(), target: None, error: Some(e) },
        });
    }
    Ok(results)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertOptions {
    pub format: ExportFormat,
    pub quality: u8,
    /// Fit within this box (keeps aspect ratio, never upscales).
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub dest_dir: String,
    /// Optional suffix added to the file stem, e.g. "_web".
    pub suffix: String,
    #[serde(default)]
    pub raw_mode: decode::RawMode,
}

pub fn render_for_export(src: &Path, edits: Option<&EditParams>, opts_raw: decode::RawMode, max_w: Option<u32>, max_h: Option<u32>) -> Result<image::DynamicImage> {
    let mut img = decode::decode(src, &DecodeOptions { raw_mode: opts_raw }, Purpose::Full)?.image;
    if let Some(e) = edits {
        img = edit::apply(img, e);
    }
    let (mw, mh) = (max_w.unwrap_or(u32::MAX), max_h.unwrap_or(u32::MAX));
    if img.width() > mw || img.height() > mh {
        img = img.resize(mw.min(img.width()), mh.min(img.height()), image::imageops::FilterType::Lanczos3);
    }
    Ok(img)
}

pub fn export_one(src: &Path, edits: Option<&EditParams>, dest: &Path, fmt: ExportFormat, quality: u8, raw_mode: decode::RawMode, max_w: Option<u32>, max_h: Option<u32>) -> Result<PathBuf> {
    let img = render_for_export(src, edits, raw_mode, max_w, max_h)?;
    let bytes = encode::encode(&img, fmt, quality)?;
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(dest).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            CoreError::Exists(dest.file_name().unwrap_or_default().to_string_lossy().into_owned())
        } else {
            e.into()
        }
    })?;
    std::io::Write::write_all(&mut f, &bytes)?;
    Ok(dest.to_path_buf())
}

pub fn convert(paths: &[PathBuf], opts: &ConvertOptions, edits: impl Fn(&Path) -> Option<EditParams> + Sync, cancel: &AtomicBool, progress: impl Fn(usize, usize) + Sync) -> Vec<OpResult> {
    use rayon::prelude::*;
    let dest = PathBuf::from(&opts.dest_dir);
    let done = std::sync::atomic::AtomicUsize::new(0);
    let name_lock = parking_lot::Mutex::new(());
    paths
        .par_iter()
        .map(|src| {
            if cancel.load(Ordering::Relaxed) {
                return OpResult { source: src.to_string_lossy().into_owned(), target: None, error: Some("Cancelled".into()) };
            }
            let res = (|| -> Result<PathBuf> {
                let img = render_for_export(src, edits(src).as_ref(), opts.raw_mode, opts.max_width, opts.max_height)?;
                let bytes = encode::encode(&img, opts.format, opts.quality)?;
                let stem = src.file_stem().unwrap_or_default().to_string_lossy();
                let _g = name_lock.lock();
                let target = fileops::unique_destination(&dest, &format!("{stem}{}.{}", opts.suffix, opts.format.extension()));
                let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&target)?;
                drop(_g);
                std::io::Write::write_all(&mut f, &bytes)?;
                Ok(target)
            })();
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            progress(n, paths.len());
            match res {
                Ok(t) => OpResult { source: src.to_string_lossy().into_owned(), target: Some(t.to_string_lossy().into_owned()), error: None },
                Err(e) => OpResult { source: src.to_string_lossy().into_owned(), target: None, error: Some(e.to_string()) },
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patterns() {
        assert_eq!(expand_pattern("{name}_{n:3}", "IMG", "jpg", 4, 1, "2024-01-02", None), "IMG_005");
        assert_eq!(expand_pattern("{captured} {n}.{ext}", "x", "png", 0, 1, "2024-01-02", Some("2020-05-06")), "2020-05-06 1.png");
        assert_eq!(expand_pattern("{unknown}{", "x", "png", 0, 1, "d", None), "{unknown}{");
        assert_eq!(ymd(0), "1970-01-01");
        assert_eq!(ymd(1_709_209_815_000), "2024-02-29");
    }

    #[test]
    fn rename_detects_conflicts_and_swaps() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a.jpg");
        let b = d.path().join("b.jpg");
        std::fs::write(&a, "A").unwrap();
        std::fs::write(&b, "B").unwrap();
        std::fs::write(d.path().join("keep.jpg"), "K").unwrap();
        let inp = |p: &Path| RenameInput { path: p.to_string_lossy().into(), modified: 0, captured: None };

        let plan = plan_rename(&[inp(&a), inp(&b)], "same", 1, true);
        assert!(plan[1].conflict.is_some());
        let plan = plan_rename(&[inp(&a)], "keep", 1, true);
        assert!(plan[0].conflict.is_some());
        assert!(execute_rename(&plan).is_err());

        // Swap names: a→b, b→a.
        let plan = vec![
            RenamePlan { source: a.to_string_lossy().into(), new_name: "b.jpg".into(), conflict: None },
            RenamePlan { source: b.to_string_lossy().into(), new_name: "a.jpg".into(), conflict: None },
        ];
        execute_rename(&plan).unwrap();
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "B");
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "A");
    }

    #[test]
    fn convert_resizes_without_overwriting() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("big.png");
        image::RgbImage::new(400, 200).save(&src).unwrap();
        let out = d.path().join("out");
        std::fs::create_dir(&out).unwrap();
        let opts = ConvertOptions { format: ExportFormat::Jpeg, quality: 90, max_width: Some(100), max_height: None, dest_dir: out.to_string_lossy().into(), suffix: String::new(), raw_mode: Default::default() };
        let cancel = AtomicBool::new(false);
        let r1 = convert(&[src.clone()], &opts, |_| None, &cancel, |_, _| {});
        let r2 = convert(&[src.clone()], &opts, |_| None, &cancel, |_, _| {});
        assert!(r1[0].error.is_none() && r2[0].error.is_none());
        assert_ne!(r1[0].target, r2[0].target);
        let img = image::open(r1[0].target.as_ref().unwrap()).unwrap();
        assert_eq!((img.width(), img.height()), (100, 50));
    }
}
