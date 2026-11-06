//! Favourites, collections, recents, pinned folders, settings, caches and edits.

use crate::state::AppState;
use lumen_core::db::{Collection, Folder, RecentEntry};
use lumen_core::decode::RawMode;
use lumen_core::edit::EditParams;
use lumen_core::thumbs::CacheStats;
use lumen_core::{CoreError, Result};
use std::path::Path;
use tauri::State;

#[tauri::command]
pub fn get_favorites(state: State<AppState>) -> Result<Vec<String>> {
    state.db.favorites()
}

#[tauri::command]
pub fn set_favorite(state: State<AppState>, paths: Vec<String>, favorite: bool) -> Result<()> {
    for p in paths {
        state.db.set_favorite(&p, favorite)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_collections(state: State<AppState>) -> Result<Vec<Collection>> {
    state.db.collections()
}

#[tauri::command]
pub fn create_collection(state: State<AppState>, name: String) -> Result<i64> {
    if name.trim().is_empty() {
        return Err(CoreError::Other("Collection name cannot be empty".into()));
    }
    state.db.create_collection(&name).map_err(|e| match e {
        CoreError::Db(rusqlite_err) if rusqlite_err.to_string().contains("UNIQUE") => CoreError::Exists(name.clone()),
        other => other,
    })
}

#[tauri::command]
pub fn rename_collection(state: State<AppState>, id: i64, name: String) -> Result<()> {
    state.db.rename_collection(id, &name)
}

#[tauri::command]
pub fn delete_collection(state: State<AppState>, id: i64) -> Result<()> {
    state.db.delete_collection(id)
}

#[tauri::command]
pub fn add_to_collection(state: State<AppState>, id: i64, paths: Vec<String>) -> Result<()> {
    state.db.add_to_collection(id, &paths)
}

#[tauri::command]
pub fn remove_from_collection(state: State<AppState>, id: i64, paths: Vec<String>) -> Result<()> {
    state.db.remove_from_collection(id, &paths)
}

#[tauri::command]
pub fn collection_items(state: State<AppState>, id: i64) -> Result<Vec<String>> {
    state.db.collection_items(id)
}

#[tauri::command]
pub fn add_recent(state: State<AppState>, path: String, kind: String) -> Result<()> {
    if state.db.settings()?.get("keepHistory").and_then(|v| v.as_bool()) == Some(false) {
        return Ok(());
    }
    state.db.add_recent(&path, &kind)
}

#[tauri::command]
pub fn get_recents(state: State<AppState>, kind: String, limit: i64) -> Result<Vec<RecentEntry>> {
    let mut v = state.db.recents(&kind, limit)?;
    v.retain(|r| Path::new(&r.path).exists());
    Ok(v)
}

#[tauri::command]
pub fn clear_recents(state: State<AppState>) -> Result<()> {
    state.db.clear_recents()
}

#[tauri::command]
pub fn get_pinned_folders(state: State<AppState>) -> Result<Vec<Folder>> {
    state.db.folders()
}

#[tauri::command]
pub fn pin_folder(state: State<AppState>, path: String) -> Result<()> {
    let name = Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
    state.db.add_folder(&path, &name)
}

#[tauri::command]
pub fn unpin_folder(state: State<AppState>, path: String) -> Result<()> {
    state.db.remove_folder(&path)
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<serde_json::Map<String, serde_json::Value>> {
    state.db.settings()
}

/// Persist one setting and apply settings that the backend owns.
#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: serde_json::Value) -> Result<()> {
    state.db.set_setting(&key, &value)?;
    match key.as_str() {
        "thumbCacheMb" => {
            if let Some(mb) = value.as_u64() {
                state.thumbs.set_limit(mb * 1024 * 1024);
                let thumbs = state.thumbs.clone();
                std::thread::spawn(move || thumbs.cleanup());
            }
        }
        "memoryCacheMb" => {
            if let Some(mb) = value.as_u64() {
                state.full_cache.lock().set_limit(mb * 1024 * 1024);
            }
        }
        "rawMode" => {
            state.decode_opts.write().raw_mode = if value.as_str() == Some("develop") { RawMode::Develop } else { RawMode::Embedded };
            state.full_cache.lock().clear();
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn cache_stats(state: State<AppState>) -> Result<CacheStats> {
    state.thumbs.stats()
}

#[tauri::command]
pub fn clear_thumbnail_cache(state: State<AppState>) -> Result<()> {
    state.full_cache.lock().clear();
    state.thumbs.clear()
}

#[tauri::command]
pub fn get_edit(state: State<AppState>, path: String) -> Result<Option<EditParams>> {
    Ok(match state.db.edit_params(&path)? {
        Some(s) => Some(serde_json::from_str(&s)?),
        None => None,
    })
}

#[tauri::command]
pub fn save_edit(state: State<AppState>, path: String, params: Option<EditParams>) -> Result<()> {
    match params.filter(|p| !p.is_identity()) {
        Some(p) => state.db.save_edit_params(&path, Some(&serde_json::to_string(&p)?)),
        None => state.db.save_edit_params(&path, None),
    }
}
