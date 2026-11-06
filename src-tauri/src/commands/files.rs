//! File management, clipboard and shell integration.

use crate::state::AppState;
use lumen_core::decode::{self, Purpose};
use lumen_core::fileops::{self, OpResult};
use lumen_core::{CoreError, Result};
use serde::Serialize;
use std::path::PathBuf;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: usize,
    pub total: usize,
}

fn join_err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Other(e.to_string())
}

#[tauri::command]
pub fn reveal_in_folder(app: AppHandle, path: String) -> Result<()> {
    app.opener().reveal_item_in_dir(&path).map_err(join_err)
}

#[tauri::command]
pub fn open_external(app: AppHandle, path: String) -> Result<()> {
    app.opener().open_path(&path, None::<&str>).map_err(join_err)
}

/// Opens the mail client addressed to the developer (About → Contact). Fixed address: the
/// webview cannot use this to open arbitrary URLs.
#[tauri::command]
pub fn contact_developer(app: AppHandle) -> Result<()> {
    app.opener().open_url("mailto:info@mestiaque.com?subject=ENViewer", None::<&str>).map_err(join_err)
}

/// Opens the developer's website (About → Website). Fixed URL, like contact_developer.
#[tauri::command]
pub fn open_developer_website(app: AppHandle) -> Result<()> {
    app.opener().open_url("https://mestiaque.com", None::<&str>).map_err(join_err)
}

#[tauri::command]
pub fn copy_text(app: AppHandle, text: String) -> Result<()> {
    app.clipboard().write_text(text).map_err(join_err)
}

/// Copy the decoded image (as a bitmap) to the system clipboard.
#[tauri::command]
pub async fn copy_image(app: AppHandle, path: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let opts = *app.state::<AppState>().decode_opts.read();
        let img = decode::decode(&PathBuf::from(&path), &opts, Purpose::Full)?.image.to_rgba8();
        let (w, h) = img.dimensions();
        let image = tauri::image::Image::new_owned(img.into_raw(), w, h);
        app.clipboard().write_image(&image).map_err(join_err)
    })
    .await
    .map_err(join_err)?
}

#[tauri::command]
pub async fn trash_paths(paths: Vec<String>) -> Result<Vec<OpResult>> {
    tauri::async_runtime::spawn_blocking(move || {
        let p: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        fileops::trash_files(&p)
    })
    .await
    .map_err(join_err)
}

#[tauri::command]
pub fn rename_path(state: State<AppState>, path: String, new_name: String) -> Result<String> {
    let dst = fileops::rename(&PathBuf::from(&path), &new_name)?;
    let dst = dst.to_string_lossy().into_owned();
    state.db.rename_path(&path, &dst)?;
    Ok(dst)
}

#[tauri::command]
pub async fn transfer_paths(app: AppHandle, paths: Vec<String>, dest_dir: String, mode: String, task_id: String, on_progress: Channel<Progress>) -> Result<Vec<OpResult>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cancel = state.new_task(&task_id);
        let p: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let dest = PathBuf::from(&dest_dir);
        if !dest.is_dir() {
            return Err(CoreError::Other("Destination folder does not exist".into()));
        }
        let progress = |done, total| {
            let _ = on_progress.send(Progress { done, total });
        };
        let res = if mode == "move" { fileops::move_files(&p, &dest, &cancel, progress) } else { fileops::copy_files(&p, &dest, &cancel, progress) };
        if mode == "move" {
            for r in &res {
                if let (None, Some(t)) = (&r.error, &r.target) {
                    let _ = state.db.rename_path(&r.source, t);
                }
            }
        }
        state.end_task(&task_id);
        Ok(res)
    })
    .await
    .map_err(join_err)?
}

#[tauri::command]
pub fn cancel_task(state: State<AppState>, task_id: String) {
    if let Some(flag) = state.tasks.lock().get(&task_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}
