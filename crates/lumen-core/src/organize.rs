//! Smart organisation: exact duplicates, visually similar images and broken
//! files. Everything runs locally; nothing is uploaded anywhere.

use crate::decode::{self, DecodeOptions, Purpose};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub size: u64,
    pub paths: Vec<String>,
}

fn hash_file(p: &Path, limit: Option<u64>) -> Option<[u8; 32]> {
    let f = std::fs::File::open(p).ok()?;
    let mut h = blake3::Hasher::new();
    let mut r: Box<dyn Read> = match limit {
        Some(l) => Box::new(f.take(l)),
        None => Box::new(f),
    };
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = r.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Some(*h.finalize().as_bytes())
}

/// Byte-identical files: group by size, then by a 64 KiB prefix hash, then by
/// a full BLAKE3 hash.
pub fn find_duplicates(paths: &[PathBuf], cancel: &AtomicBool, progress: impl Fn(usize, usize) + Sync) -> Vec<DuplicateGroup> {
    let mut by_size: HashMap<u64, Vec<&PathBuf>> = HashMap::new();
    for p in paths {
        if let Ok(m) = std::fs::metadata(p) {
            if m.len() > 0 {
                by_size.entry(m.len()).or_default().push(p);
            }
        }
    }
    let candidates: Vec<(u64, Vec<&PathBuf>)> = by_size.into_iter().filter(|(_, v)| v.len() > 1).collect();
    let total = candidates.iter().map(|(_, v)| v.len()).sum();
    let done = AtomicUsize::new(0);
    let mut groups: Vec<DuplicateGroup> = candidates
        .par_iter()
        .flat_map_iter(|(size, files)| {
            let mut out = Vec::new();
            if cancel.load(Ordering::Relaxed) {
                return out.into_iter();
            }
            let mut by_prefix: HashMap<[u8; 32], Vec<&PathBuf>> = HashMap::new();
            for f in files {
                if let Some(h) = hash_file(f, Some(64 * 1024)) {
                    by_prefix.entry(h).or_default().push(f);
                }
                progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);
            }
            for (_, fs) in by_prefix.into_iter().filter(|(_, v)| v.len() > 1) {
                let mut by_full: HashMap<[u8; 32], Vec<String>> = HashMap::new();
                for f in fs {
                    if let Some(h) = if *size <= 64 * 1024 { hash_file(f, Some(64 * 1024)) } else { hash_file(f, None) } {
                        by_full.entry(h).or_default().push(f.to_string_lossy().into_owned());
                    }
                }
                out.extend(by_full.into_values().filter(|v| v.len() > 1).map(|mut paths| {
                    paths.sort();
                    DuplicateGroup { size: *size, paths }
                }));
            }
            out.into_iter()
        })
        .collect();
    groups.sort_by(|a, b| (b.size * b.paths.len() as u64).cmp(&(a.size * a.paths.len() as u64)));
    groups
}

/// 64-bit difference hash of a 9×8 greyscale reduction.
pub fn dhash(img: &image::DynamicImage) -> u64 {
    let g = img.resize_exact(9, 8, image::imageops::FilterType::Triangle).to_luma8();
    let mut h = 0u64;
    for y in 0..8 {
        for x in 0..8 {
            h <<= 1;
            if g.get_pixel(x, y).0[0] > g.get_pixel(x + 1, y).0[0] {
                h |= 1;
            }
        }
    }
    h
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarGroup {
    pub paths: Vec<String>,
    /// Largest Hamming distance inside the group (0 = visually identical).
    pub max_distance: u32,
}

/// Groups images whose perceptual hashes differ by at most `threshold` bits
/// (single-linkage clustering).
pub fn find_similar(paths: &[PathBuf], threshold: u32, opts: &DecodeOptions, cancel: &AtomicBool, progress: impl Fn(usize, usize) + Sync) -> Vec<SimilarGroup> {
    let done = AtomicUsize::new(0);
    let hashes: Vec<(String, u64)> = paths
        .par_iter()
        .filter_map(|p| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let r = decode::decode(p, opts, Purpose::Thumbnail(128)).ok().map(|d| (p.to_string_lossy().into_owned(), dhash(&d.image)));
            progress(done.fetch_add(1, Ordering::Relaxed) + 1, paths.len());
            r
        })
        .collect();
    let n = hashes.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(p: &mut [usize], i: usize) -> usize {
        let mut r = i;
        while p[r] != r {
            p[r] = p[p[r]];
            r = p[r];
        }
        r
    }
    for i in 0..n {
        for j in i + 1..n {
            if (hashes[i].1 ^ hashes[j].1).count_ones() <= threshold {
                let (a, b) = (find(&mut parent, i), find(&mut parent, j));
                if a != b {
                    parent[a] = b;
                }
            }
        }
    }
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let r = find(&mut parent, i);
        groups.entry(r).or_default().push(i);
    }
    let mut out: Vec<SimilarGroup> = groups
        .into_values()
        .filter(|g| g.len() > 1)
        .map(|g| {
            let mut max = 0;
            for &a in &g {
                for &b in &g {
                    max = max.max((hashes[a].1 ^ hashes[b].1).count_ones());
                }
            }
            SimilarGroup { paths: g.iter().map(|&i| hashes[i].0.clone()).collect(), max_distance: max }
        })
        .collect();
    out.sort_by_key(|g| (g.max_distance, std::cmp::Reverse(g.paths.len())));
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenFile {
    pub path: String,
    pub error: String,
}

/// Fully decode every image and report those that fail.
pub fn find_broken(paths: &[PathBuf], opts: &DecodeOptions, cancel: &AtomicBool, progress: impl Fn(usize, usize) + Sync) -> Vec<BrokenFile> {
    let done = AtomicUsize::new(0);
    paths
        .par_iter()
        .filter_map(|p| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let r = decode::decode(p, opts, Purpose::Thumbnail(256)).err();
            progress(done.fetch_add(1, Ordering::Relaxed) + 1, paths.len());
            r.map(|e| BrokenFile { path: p.to_string_lossy().into_owned(), error: e.to_string() })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicates_and_similar() {
        let d = tempfile::tempdir().unwrap();
        let grad = image::RgbImage::from_fn(64, 64, |x, y| image::Rgb([(x * 4) as u8, (y * 4) as u8, 0]));
        grad.save(d.path().join("a.png")).unwrap();
        std::fs::copy(d.path().join("a.png"), d.path().join("b.png")).unwrap();
        // Same picture, different encoding → similar but not a byte duplicate.
        grad.save(d.path().join("c.bmp")).unwrap();
        image::RgbImage::from_fn(64, 64, |x, _| image::Rgb([255 - (x * 4) as u8, 0, 0])).save(d.path().join("other.png")).unwrap();
        std::fs::write(d.path().join("broken.png"), b"\x89PNG\r\n\x1a\nnope").unwrap();

        let paths: Vec<PathBuf> = ["a.png", "b.png", "c.bmp", "other.png"].iter().map(|n| d.path().join(n)).collect();
        let cancel = AtomicBool::new(false);
        let dups = find_duplicates(&paths, &cancel, |_, _| {});
        assert_eq!(dups.len(), 1);
        assert_eq!(dups[0].paths.len(), 2);

        let sim = find_similar(&paths, 6, &DecodeOptions::default(), &cancel, |_, _| {});
        assert_eq!(sim.len(), 1);
        assert_eq!(sim[0].paths.len(), 3);

        let mut all = paths.clone();
        all.push(d.path().join("broken.png"));
        let broken = find_broken(&all, &DecodeOptions::default(), &cancel, |_, _| {});
        assert_eq!(broken.len(), 1);
        assert!(broken[0].path.ends_with("broken.png"));
    }
}
