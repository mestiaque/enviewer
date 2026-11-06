use crate::state::AppState;
use lumen_core::metadata::{self, Probe};
use lumen_core::scan::{self, MediaItem, ScanSummary, SubFolder};
use lumen_core::{formats, CoreError, Result};
use rayon_free::par_chunks;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ScanEvent {
    Items { items: Vec<MediaItem> },
    Listed { summary: ScanSummary },
    Probes { probes: Vec<ProbeResult> },
    Done,
    Error { message: String },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub path: String,
    #[serde(flatten)]
    pub probe: Probe,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatsResponse {
    pub formats: Vec<formats::FormatCapability>,
    pub heif_version: Option<String>,
}

#[tauri::command]
pub fn get_formats() -> FormatsResponse {
    #[cfg(feature = "heif")]
    let heif_version = Some(lumen_core::decode::heif::version());
    #[cfg(not(feature = "heif"))]
    let heif_version = None;
    FormatsResponse { formats: formats::capabilities(), heif_version }
}

#[tauri::command]
pub fn get_launch_paths(state: State<AppState>) -> Vec<String> {
    std::mem::take(&mut *state.launch_paths.lock())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardFolder {
    pub id: &'static str,
    pub name: &'static str,
    pub path: String,
}

#[tauri::command]
pub fn standard_folders(app: AppHandle) -> Vec<StandardFolder> {
    let p = app.path();
    [
        ("home", "Home", p.home_dir()),
        ("pictures", "Pictures", p.picture_dir()),
        ("downloads", "Downloads", p.download_dir()),
        ("desktop", "Desktop", p.desktop_dir()),
        ("documents", "Documents", p.document_dir()),
    ]
    .into_iter()
    .filter_map(|(id, name, r)| r.ok().filter(|d| d.is_dir()).map(|d| StandardFolder { id, name, path: d.to_string_lossy().into_owned() }))
    .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathKind {
    pub exists: bool,
    pub is_dir: bool,
    pub parent: Option<String>,
    pub supported: bool,
}

#[tauri::command]
pub fn path_kind(path: String) -> PathKind {
    let p = Path::new(&path);
    PathKind {
        exists: p.exists(),
        is_dir: p.is_dir(),
        parent: p.parent().map(|d| d.to_string_lossy().into_owned()),
        // ENViewer opens images only (videos are ENPlayer's job).
        supported: formats::from_path(p).is_some_and(|f| f.kind == formats::MediaKind::Image),
    }
}

#[tauri::command]
pub async fn list_subfolders(path: String, include_hidden: bool) -> Result<Vec<SubFolder>> {
    tauri::async_runtime::spawn_blocking(move || scan::list_subfolders(Path::new(&path), include_hidden))
        .await
        .map_err(|e| CoreError::Other(e.to_string()))?
}

/// Scan a folder: stream items in batches, then stream probes (dimensions,
/// capture date, animation) from the metadata cache or the files.
#[tauri::command]
pub fn scan_folder(app: AppHandle, state: State<AppState>, path: String, include_hidden: bool, on_event: Channel<ScanEvent>) {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut cur = state.scan_cancel.lock();
        cur.store(true, Ordering::Relaxed);
        *cur = cancel.clone();
    }
    std::thread::spawn(move || {
        let mut all: Vec<(String, u64, i64)> = Vec::new();
        let res = scan::scan_folder(Path::new(&path), include_hidden, 1000, &cancel, |items| {
            all.extend(items.iter().filter(|i| i.kind == formats::MediaKind::Image).map(|i| (i.path.clone(), i.size, i.modified)));
            let _ = on_event.send(ScanEvent::Items { items });
        });
        match res {
            Ok(summary) => {
                let _ = on_event.send(ScanEvent::Listed { summary });
                let state = app.state::<AppState>();
                probe_all(&state, all, &cancel, &on_event);
                if !cancel.load(Ordering::Relaxed) {
                    let _ = on_event.send(ScanEvent::Done);
                }
            }
            Err(CoreError::Cancelled) => {}
            Err(e) => {
                let _ = on_event.send(ScanEvent::Error { message: e.to_string() });
            }
        }
    });
}

#[tauri::command]
pub fn cancel_scan(state: State<AppState>) {
    state.scan_cancel.lock().store(true, Ordering::Relaxed);
}

/// Items for arbitrary files (favourites / collections / recents), then probes.
#[tauri::command]
pub fn load_items(app: AppHandle, state: State<AppState>, paths: Vec<String>, on_event: Channel<ScanEvent>) {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut cur = state.scan_cancel.lock();
        cur.store(true, Ordering::Relaxed);
        *cur = cancel.clone();
    }
    std::thread::spawn(move || {
        let items = scan::items_for_paths(&paths);
        let all = items.iter().filter(|i| i.kind == formats::MediaKind::Image).map(|i| (i.path.clone(), i.size, i.modified)).collect();
        let total = items.len();
        let _ = on_event.send(ScanEvent::Items { items });
        let _ = on_event.send(ScanEvent::Listed { summary: ScanSummary { total, ..Default::default() } });
        let state = app.state::<AppState>();
        probe_all(&state, all, &cancel, &on_event);
        if !cancel.load(Ordering::Relaxed) {
            let _ = on_event.send(ScanEvent::Done);
        }
    });
}

fn probe_all(state: &AppState, files: Vec<(String, u64, i64)>, cancel: &AtomicBool, ch: &Channel<ScanEvent>) {
    // Cached first (cheap DB lookups), in large batches.
    let mut todo = Vec::new();
    let mut cached = Vec::new();
    for (p, size, mtime) in files {
        match state.db.cached_probe(&p, size, mtime) {
            Ok(Some(probe)) => cached.push(ProbeResult { path: p, probe }),
            _ => todo.push((p, size, mtime)),
        }
        if cached.len() >= 2000 {
            let _ = ch.send(ScanEvent::Probes { probes: std::mem::take(&mut cached) });
        }
    }
    if !cached.is_empty() {
        let _ = ch.send(ScanEvent::Probes { probes: cached });
    }
    par_chunks(&todo, 128, cancel, |chunk| {
        let rows: Vec<(String, u64, i64, Probe)> = chunk.iter().map(|(p, s, m)| (p.clone(), *s, *m, metadata::probe(Path::new(p)))).collect();
        let _ = state.db.store_probes(&rows);
        let _ = ch.send(ScanEvent::Probes { probes: rows.into_iter().map(|(path, _, _, probe)| ProbeResult { path, probe }).collect() });
    });
}

/// Minimal parallel chunk processor on std threads (keeps the app crate free
/// of a direct rayon dependency; the core uses rayon internally).
mod rayon_free {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    pub fn par_chunks<T: Sync>(items: &[T], chunk: usize, cancel: &AtomicBool, f: impl Fn(&[T]) + Sync) {
        let chunks: Vec<&[T]> = items.chunks(chunk.max(1)).collect();
        let next = AtomicUsize::new(0);
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8);
        std::thread::scope(|s| {
            for _ in 0..threads {
                s.spawn(|| loop {
                    if cancel.load(Ordering::Relaxed) {
                        return;
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(c) = chunks.get(i) else { return };
                    f(c);
                });
            }
        });
    }
}

#[tauri::command]
pub fn set_thumb_generation(state: State<AppState>, generation: u64) {
    state.thumb_generation.store(generation, Ordering::Relaxed);
}

#[tauri::command]
pub async fn get_image_info(path: String) -> Result<metadata::ImageInfo> {
    tauri::async_runtime::spawn_blocking(move || metadata::image_info(&PathBuf::from(path)))
        .await
        .map_err(|e| CoreError::Other(e.to_string()))?
}

/// Frontend errors/warnings end up in the same log file as the backend.
#[tauri::command]
pub fn frontend_log(level: String, message: String) {
    let msg: String = message.chars().take(4000).collect();
    match level.as_str() {
        "error" => log::error!(target: "frontend", "{msg}"),
        "warn" => log::warn!(target: "frontend", "{msg}"),
        _ => log::info!(target: "frontend", "{msg}"),
    }
}

/// Base URL of the loopback video server (see media_server.rs).
#[tauri::command]
pub fn media_base_url() -> Option<String> {
    crate::media_server::base_url()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub data: String,
    pub cache: String,
    pub logs: String,
}

/// Where Lumen keeps its database, thumbnail cache and logs (shown in About).
#[tauri::command]
pub fn app_paths(app: AppHandle) -> AppPaths {
    let p = app.path();
    let s = |r: tauri::Result<PathBuf>| r.map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    AppPaths { data: s(p.app_data_dir()), cache: s(p.app_cache_dir()), logs: s(p.app_log_dir()) }
}
