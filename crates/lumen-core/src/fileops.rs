//! File management. Every operation refuses to overwrite and reports
//! per-file results; deletion goes to the system Trash.

use crate::error::{CoreError, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    pub source: String,
    pub target: Option<String>,
    pub error: Option<String>,
}

impl OpResult {
    fn ok(src: &Path, dst: Option<&Path>) -> Self {
        Self { source: src.to_string_lossy().into_owned(), target: dst.map(|d| d.to_string_lossy().into_owned()), error: None }
    }
    fn err(src: &Path, e: impl std::fmt::Display) -> Self {
        Self { source: src.to_string_lossy().into_owned(), target: None, error: Some(friendly(e.to_string())) }
    }
}

fn friendly(msg: String) -> String {
    let lower = msg.to_lowercase();
    if lower.contains("permission denied") || lower.contains("access is denied") {
        "Permission denied".into()
    } else if lower.contains("being used by another process") || lower.contains("resource busy") {
        "The file is locked by another program".into()
    } else {
        msg
    }
}

/// `dir/name.ext`, or `dir/name (2).ext`, `(3)`… if taken.
pub fn unique_destination(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(file_name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|c| !c.exists())
        .unwrap()
}

pub fn validate_file_name(name: &str) -> Result<()> {
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.len() > 255
        || name.chars().any(|c| matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control());
    if bad {
        return Err(CoreError::Other(format!("\"{name}\" is not a valid file name")));
    }
    Ok(())
}

pub fn rename(path: &Path, new_name: &str) -> Result<PathBuf> {
    validate_file_name(new_name)?;
    let dst = path.parent().unwrap_or(Path::new(".")).join(new_name);
    if dst == path {
        return Ok(dst);
    }
    // Allow case-only renames on case-insensitive filesystems.
    let case_only = dst.to_string_lossy().to_lowercase() == path.to_string_lossy().to_lowercase();
    if dst.exists() && !case_only {
        return Err(CoreError::Exists(new_name.into()));
    }
    std::fs::rename(path, &dst).map_err(|e| CoreError::Other(friendly(e.to_string())))?;
    Ok(dst)
}

fn copy_one(src: &Path, dest_dir: &Path) -> std::io::Result<PathBuf> {
    let name = src.file_name().ok_or_else(|| std::io::Error::other("no file name"))?;
    let dst = unique_destination(dest_dir, &name.to_string_lossy());
    // create_new guards against a race creating the same name in between.
    let mut out = std::fs::OpenOptions::new().write(true).create_new(true).open(&dst)?;
    let mut inp = std::fs::File::open(src)?;
    if let Err(e) = std::io::copy(&mut inp, &mut out) {
        drop(out);
        let _ = std::fs::remove_file(&dst);
        return Err(e);
    }
    if let Ok(m) = std::fs::metadata(src).and_then(|m| m.modified()) {
        let _ = out.set_modified(m);
    }
    Ok(dst)
}

pub fn copy_files(paths: &[PathBuf], dest_dir: &Path, cancel: &AtomicBool, mut progress: impl FnMut(usize, usize)) -> Vec<OpResult> {
    let mut out = Vec::new();
    for (i, p) in paths.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            out.push(OpResult::err(p, "Cancelled"));
            continue;
        }
        out.push(match copy_one(p, dest_dir) {
            Ok(d) => OpResult::ok(p, Some(&d)),
            Err(e) => OpResult::err(p, e),
        });
        progress(i + 1, paths.len());
    }
    out
}

pub fn move_files(paths: &[PathBuf], dest_dir: &Path, cancel: &AtomicBool, mut progress: impl FnMut(usize, usize)) -> Vec<OpResult> {
    let mut out = Vec::new();
    for (i, p) in paths.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            out.push(OpResult::err(p, "Cancelled"));
            continue;
        }
        let res = (|| -> std::io::Result<PathBuf> {
            if p.parent() == Some(dest_dir) {
                return Ok(p.clone());
            }
            let name = p.file_name().ok_or_else(|| std::io::Error::other("no file name"))?;
            let dst = unique_destination(dest_dir, &name.to_string_lossy());
            match std::fs::rename(p, &dst) {
                Ok(()) => Ok(dst),
                // Cross-device: copy, then remove the original only after success.
                Err(_) => {
                    let d = copy_one(p, dest_dir)?;
                    std::fs::remove_file(p)?;
                    Ok(d)
                }
            }
        })();
        out.push(match res {
            Ok(d) => OpResult::ok(p, Some(&d)),
            Err(e) => OpResult::err(p, e),
        });
        progress(i + 1, paths.len());
    }
    out
}

pub fn trash_files(paths: &[PathBuf]) -> Vec<OpResult> {
    paths
        .iter()
        .map(|p| match trash::delete(p) {
            Ok(()) => OpResult::ok(p, None),
            Err(e) => OpResult::err(p, e),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_overwrites() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.jpg"), "1").unwrap();
        std::fs::write(d.path().join("a (2).jpg"), "2").unwrap();
        assert_eq!(unique_destination(d.path(), "a.jpg"), d.path().join("a (3).jpg"));
        assert_eq!(unique_destination(d.path(), "b.jpg"), d.path().join("b.jpg"));

        std::fs::write(d.path().join("b.jpg"), "b").unwrap();
        assert!(matches!(rename(&d.path().join("b.jpg"), "a.jpg"), Err(CoreError::Exists(_))));
        assert_eq!(std::fs::read_to_string(d.path().join("a.jpg")).unwrap(), "1");
        assert!(rename(&d.path().join("b.jpg"), "x/y.jpg").is_err());
        assert_eq!(rename(&d.path().join("b.jpg"), "c.jpg").unwrap(), d.path().join("c.jpg"));
    }

    #[test]
    fn copy_and_move() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let f = src.path().join("p.png");
        std::fs::write(&f, "data").unwrap();
        std::fs::write(dst.path().join("p.png"), "existing").unwrap();
        let cancel = AtomicBool::new(false);
        let r = copy_files(&[f.clone()], dst.path(), &cancel, |_, _| {});
        assert_eq!(r[0].target.as_deref(), Some(dst.path().join("p (2).png").to_string_lossy().as_ref()));
        assert_eq!(std::fs::read_to_string(dst.path().join("p.png")).unwrap(), "existing");
        let r = move_files(&[f.clone()], dst.path(), &cancel, |_, _| {});
        assert!(r[0].error.is_none());
        assert!(!f.exists());
        assert!(dst.path().join("p (3).png").exists());
    }
}
