//! Persistent thumbnail cache.
//!
//! Key = BLAKE3(path, file size, mtime, thumbnail size). Any change to the file
//! changes the key, which is how invalidation works; stale entries simply age
//! out under the LRU size limit.

use crate::db::Db;
use crate::decode::{self, DecodeOptions, Purpose};
use crate::encode;
use crate::error::Result;
use parking_lot::Mutex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Allowed thumbnail edge sizes. Requests are rounded up to one of these so
/// grid size changes reuse cached files.
pub const BUCKETS: &[u32] = &[128, 256, 384, 512, 768];

pub fn bucket_for(px: u32) -> u32 {
    *BUCKETS.iter().find(|&&b| b >= px).unwrap_or(BUCKETS.last().unwrap())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub bytes: u64,
    pub entries: u64,
    pub limit_bytes: u64,
    pub dir: String,
}

pub struct Thumb {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

pub struct ThumbCache {
    dir: PathBuf,
    db: Arc<Db>,
    limit: AtomicU64,
    pending_touch: Mutex<Vec<String>>,
    written_since_cleanup: AtomicU64,
}

impl ThumbCache {
    pub fn new(dir: PathBuf, db: Arc<Db>, limit_bytes: u64) -> Result<Self> {
        std::fs::create_dir_all(&dir)?;
        Ok(Self { dir, db, limit: AtomicU64::new(limit_bytes), pending_touch: Mutex::new(Vec::new()), written_since_cleanup: AtomicU64::new(0) })
    }

    pub fn set_limit(&self, bytes: u64) {
        self.limit.store(bytes, Ordering::Relaxed);
    }

    pub fn key(path: &Path, size: u64, mtime: i64, px: u32) -> String {
        let mut h = blake3::Hasher::new();
        h.update(path.to_string_lossy().as_bytes());
        h.update(&size.to_le_bytes());
        h.update(&mtime.to_le_bytes());
        h.update(&px.to_le_bytes());
        h.finalize().to_hex()[..32].to_string()
    }

    fn file_for(&self, key: &str, ext: &str) -> PathBuf {
        self.dir.join(&key[..2]).join(format!("{key}.{ext}"))
    }

    /// Return a cached thumbnail or generate (and cache) one.
    pub fn get(&self, path: &Path, px: u32, opts: &DecodeOptions) -> Result<Thumb> {
        let px = bucket_for(px);
        let meta = std::fs::metadata(path)?;
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
        let key = Self::key(path, meta.len(), mtime, px);
        for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png")] {
            let f = self.file_for(&key, ext);
            if let Ok(bytes) = std::fs::read(&f) {
                self.touch(key);
                return Ok(Thumb { bytes, mime });
            }
        }
        let thumb = generate(path, px, opts)?;
        let ext = if thumb.mime == "image/png" { "png" } else { "jpg" };
        let f = self.file_for(&key, ext);
        if let Some(d) = f.parent() {
            std::fs::create_dir_all(d)?;
        }
        // Write-then-rename so a crash never leaves a truncated cache file.
        let tmp = f.with_extension(format!("{ext}.tmp{}", std::process::id()));
        std::fs::write(&tmp, &thumb.bytes)?;
        std::fs::rename(&tmp, &f)?;
        self.db.thumb_insert(&key, &path.to_string_lossy(), thumb.bytes.len() as u64)?;
        if self.written_since_cleanup.fetch_add(1, Ordering::Relaxed) >= 200 {
            self.written_since_cleanup.store(0, Ordering::Relaxed);
            let _ = self.cleanup();
        }
        Ok(thumb)
    }

    fn touch(&self, key: String) {
        let mut p = self.pending_touch.lock();
        p.push(key);
        if p.len() >= 256 {
            let keys = std::mem::take(&mut *p);
            drop(p);
            let _ = self.db.thumb_touch(&keys);
        }
    }

    /// Evict least-recently-used thumbnails until the cache fits its limit.
    pub fn cleanup(&self) -> Result<u64> {
        let keys = std::mem::take(&mut *self.pending_touch.lock());
        self.db.thumb_touch(&keys)?;
        let limit = self.limit.load(Ordering::Relaxed);
        let (mut total, _) = self.db.thumb_total_bytes()?;
        let mut freed = 0;
        while total > limit {
            let batch = self.db.thumb_lru(500)?;
            if batch.is_empty() {
                break;
            }
            let mut removed = Vec::new();
            for (key, bytes) in batch {
                if total <= limit {
                    break;
                }
                for ext in ["jpg", "png"] {
                    let _ = std::fs::remove_file(self.file_for(&key, ext));
                }
                total = total.saturating_sub(bytes);
                freed += bytes;
                removed.push(key);
            }
            self.db.thumb_remove(&removed)?;
        }
        Ok(freed)
    }

    pub fn clear(&self) -> Result<()> {
        self.pending_touch.lock().clear();
        if self.dir.exists() {
            std::fs::remove_dir_all(&self.dir)?;
        }
        std::fs::create_dir_all(&self.dir)?;
        self.db.thumb_clear()
    }

    pub fn stats(&self) -> Result<CacheStats> {
        let (bytes, entries) = self.db.thumb_total_bytes()?;
        Ok(CacheStats { bytes, entries, limit_bytes: self.limit.load(Ordering::Relaxed), dir: self.dir.to_string_lossy().into_owned() })
    }
}

/// Decode and downscale. Opaque images become JPEG (q=88), images with
/// transparency PNG so checkerboards and logos look right.
pub fn generate(path: &Path, px: u32, opts: &DecodeOptions) -> Result<Thumb> {
    let d = decode::decode(path, opts, Purpose::Thumbnail(px))?;
    let img = if d.image.width() > px || d.image.height() > px { d.image.thumbnail(px, px) } else { d.image };
    if img.color().has_alpha() && has_transparency(&img) {
        let rgba = image::DynamicImage::ImageRgba8(img.to_rgba8());
        let mut out = Vec::new();
        rgba.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)?;
        Ok(Thumb { bytes: out, mime: "image/png" })
    } else {
        Ok(Thumb { bytes: encode::jpeg(&img, 88)?, mime: "image/jpeg" })
    }
}

fn has_transparency(img: &image::DynamicImage) -> bool {
    img.to_rgba8().pixels().any(|p| p.0[3] < 255)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buckets_round_up() {
        assert_eq!(bucket_for(1), 128);
        assert_eq!(bucket_for(256), 256);
        assert_eq!(bucket_for(300), 384);
        assert_eq!(bucket_for(5000), 768);
    }

    #[test]
    fn cache_roundtrip_invalidation_and_limit() {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(Db::open_in_memory().unwrap());
        let cache = ThumbCache::new(dir.path().join("thumbs"), db, 10 * 1024 * 1024).unwrap();
        let img = dir.path().join("p.png");
        image::RgbImage::from_fn(1000, 500, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 7])).save(&img).unwrap();

        let t = cache.get(&img, 256, &DecodeOptions::default()).unwrap();
        assert_eq!(t.mime, "image/jpeg");
        let decoded = image::load_from_memory(&t.bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (256, 128));
        assert_eq!(cache.stats().unwrap().entries, 1);

        // Hit: no new entry.
        cache.get(&img, 200, &DecodeOptions::default()).unwrap();
        assert_eq!(cache.stats().unwrap().entries, 1);

        // Changing the file (size) invalidates via the key.
        std::thread::sleep(std::time::Duration::from_millis(20));
        image::RgbImage::new(64, 64).save(&img).unwrap();
        cache.get(&img, 256, &DecodeOptions::default()).unwrap();
        assert_eq!(cache.stats().unwrap().entries, 2);

        cache.set_limit(0);
        cache.cleanup().unwrap();
        assert_eq!(cache.stats().unwrap().entries, 0);
    }

    #[test]
    fn transparent_images_become_png() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.png");
        image::RgbaImage::from_pixel(50, 50, image::Rgba([0, 0, 0, 0])).save(&p).unwrap();
        assert_eq!(generate(&p, 128, &DecodeOptions::default()).unwrap().mime, "image/png");
    }
}
