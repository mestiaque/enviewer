use lumen_core::db::Db;
use lumen_core::decode::{DecodeOptions, RawMode};
use lumen_core::thumbs::ThumbCache;
use parking_lot::{Mutex, RwLock};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Arc;

pub const DEFAULT_THUMB_CACHE_MB: u64 = 1024;
pub const DEFAULT_FULL_CACHE_MB: u64 = 512;

/// Size-bounded LRU of encoded full-size images (backend-decoded formats only),
/// so flipping back and forth between images is instant.
pub struct ByteLru {
    limit: u64,
    used: u64,
    order: VecDeque<String>,
    map: HashMap<String, Arc<Vec<u8>>>,
}

impl ByteLru {
    pub fn new(limit: u64) -> Self {
        Self { limit, used: 0, order: VecDeque::new(), map: HashMap::new() }
    }
    pub fn get(&mut self, k: &str) -> Option<Arc<Vec<u8>>> {
        let v = self.map.get(k)?.clone();
        if let Some(pos) = self.order.iter().position(|x| x == k) {
            let key = self.order.remove(pos).unwrap();
            self.order.push_back(key);
        }
        Some(v)
    }
    pub fn put(&mut self, k: String, v: Arc<Vec<u8>>) {
        if v.len() as u64 > self.limit {
            return;
        }
        if let Some(old) = self.map.insert(k.clone(), v.clone()) {
            self.used -= old.len() as u64;
            self.order.retain(|x| x != &k);
        }
        self.used += v.len() as u64;
        self.order.push_back(k);
        while self.used > self.limit {
            let Some(old) = self.order.pop_front() else { break };
            if let Some(b) = self.map.remove(&old) {
                self.used -= b.len() as u64;
            }
        }
    }
    pub fn set_limit(&mut self, limit: u64) {
        self.limit = limit;
        self.put_noop();
    }
    fn put_noop(&mut self) {
        while self.used > self.limit {
            let Some(old) = self.order.pop_front() else { break };
            if let Some(b) = self.map.remove(&old) {
                self.used -= b.len() as u64;
            }
        }
    }
    pub fn clear(&mut self) {
        self.map.clear();
        self.order.clear();
        self.used = 0;
    }
}

pub struct AppState {
    pub db: Arc<Db>,
    pub thumbs: Arc<ThumbCache>,
    pub full_cache: Mutex<ByteLru>,
    pub decode_opts: RwLock<DecodeOptions>,
    pub scan_cancel: Mutex<Arc<AtomicBool>>,
    /// Thumbnail requests carry the generation they were made in; queued jobs
    /// from an older generation (previous folder) are dropped.
    pub thumb_generation: AtomicU64,
    pub tasks: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub launch_paths: Mutex<Vec<String>>,

}

impl AppState {
    pub fn new(data_dir: PathBuf, cache_dir: PathBuf) -> lumen_core::Result<Self> {
        let db = Arc::new(Db::open(&data_dir.join("lumen.sqlite3"))?);
        let settings = db.settings().unwrap_or_default();
        let thumb_mb = settings.get("thumbCacheMb").and_then(|v| v.as_u64()).unwrap_or(DEFAULT_THUMB_CACHE_MB);
        let full_mb = settings.get("memoryCacheMb").and_then(|v| v.as_u64()).unwrap_or(DEFAULT_FULL_CACHE_MB);
        let raw_mode = match settings.get("rawMode").and_then(|v| v.as_str()) {
            Some("develop") => RawMode::Develop,
            _ => RawMode::Embedded,
        };
        let thumbs = Arc::new(ThumbCache::new(cache_dir.join("thumbnails"), db.clone(), thumb_mb * 1024 * 1024)?);
        Ok(Self {
            db,
            thumbs,
            full_cache: Mutex::new(ByteLru::new(full_mb * 1024 * 1024)),
            decode_opts: RwLock::new(DecodeOptions { raw_mode }),
            scan_cancel: Mutex::new(Arc::new(AtomicBool::new(false))),
            thumb_generation: AtomicU64::new(0),
            tasks: Mutex::new(HashMap::new()),
            launch_paths: Mutex::new(Vec::new()),

        })
    }

    pub fn new_task(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.tasks.lock().insert(id.to_string(), flag.clone());
        flag
    }

    pub fn end_task(&self, id: &str) {
        self.tasks.lock().remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lru_evicts_oldest() {
        let mut l = ByteLru::new(10);
        l.put("a".into(), Arc::new(vec![0; 4]));
        l.put("b".into(), Arc::new(vec![0; 4]));
        assert!(l.get("a").is_some()); // a is now most recent
        l.put("c".into(), Arc::new(vec![0; 4]));
        assert!(l.get("b").is_none());
        assert!(l.get("a").is_some() && l.get("c").is_some());
        l.put("huge".into(), Arc::new(vec![0; 11]));
        assert!(l.get("huge").is_none());
    }
}
