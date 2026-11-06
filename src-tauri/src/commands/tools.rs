//! Export, batch operations and smart organisation.

use super::files::Progress;
use crate::state::AppState;
use lumen_core::batch::{self, ConvertOptions, RenameInput, RenamePlan};
use lumen_core::edit::EditParams;
use lumen_core::encode::ExportFormat;
use lumen_core::fileops::OpResult;
use lumen_core::organize::{self, BrokenFile, DuplicateGroup, SimilarGroup};
use lumen_core::{CoreError, Result};
use std::path::PathBuf;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

fn join_err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Other(e.to_string())
}

/// Render the edits onto a full-resolution decode and write a *new* file.
#[tauri::command]
pub async fn export_image(app: AppHandle, path: String, params: Option<EditParams>, dest: String, format: ExportFormat, quality: u8) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let src = PathBuf::from(&path);
        let dest = PathBuf::from(&dest);
        if dest == src {
            return Err(CoreError::Other("Choose a different file name; the original is never overwritten".into()));
        }
        let raw = app.state::<AppState>().decode_opts.read().raw_mode;
        // The save dialog has already confirmed replacing an existing copy.
        if dest.exists() {
            std::fs::remove_file(&dest)?;
        }
        batch::export_one(&src, params.as_ref(), &dest, format, quality, raw, None, None).map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(join_err)?
}

#[tauri::command]
pub fn plan_batch_rename(inputs: Vec<RenameInput>, pattern: String, start: usize, keep_ext: bool) -> Vec<RenamePlan> {
    batch::plan_rename(&inputs, &pattern, start, keep_ext)
}

#[tauri::command]
pub async fn run_batch_rename(app: AppHandle, plan: Vec<RenamePlan>) -> Result<Vec<OpResult>> {
    tauri::async_runtime::spawn_blocking(move || {
        let res = batch::execute_rename(&plan)?;
        let state = app.state::<AppState>();
        for r in &res {
            if let (None, Some(t)) = (&r.error, &r.target) {
                let _ = state.db.rename_path(&r.source, t);
            }
        }
        Ok(res)
    })
    .await
    .map_err(join_err)?
}

#[tauri::command]
pub async fn batch_convert(app: AppHandle, paths: Vec<String>, options: ConvertOptions, apply_edits: bool, task_id: String, on_progress: Channel<Progress>) -> Result<Vec<OpResult>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if !PathBuf::from(&options.dest_dir).is_dir() {
            return Err(CoreError::Other("Destination folder does not exist".into()));
        }
        let cancel = state.new_task(&task_id);
        let p: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let db = state.db.clone();
        let edits = |src: &std::path::Path| -> Option<EditParams> {
            if !apply_edits {
                return None;
            }
            db.edit_params(&src.to_string_lossy()).ok().flatten().and_then(|s| serde_json::from_str(&s).ok())
        };
        let res = batch::convert(&p, &options, edits, &cancel, |done, total| {
            let _ = on_progress.send(Progress { done, total });
        });
        state.end_task(&task_id);
        Ok(res)
    })
    .await
    .map_err(join_err)?
}

#[tauri::command]
pub async fn find_duplicates(app: AppHandle, paths: Vec<String>, task_id: String, on_progress: Channel<Progress>) -> Result<Vec<DuplicateGroup>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cancel = state.new_task(&task_id);
        let p: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let r = organize::find_duplicates(&p, &cancel, |done, total| {
            let _ = on_progress.send(Progress { done, total });
        });
        state.end_task(&task_id);
        r
    })
    .await
    .map_err(join_err)
}

#[tauri::command]
pub async fn find_similar(app: AppHandle, paths: Vec<String>, threshold: u32, task_id: String, on_progress: Channel<Progress>) -> Result<Vec<SimilarGroup>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cancel = state.new_task(&task_id);
        let opts = *state.decode_opts.read();
        let p: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let r = organize::find_similar(&p, threshold.min(20), &opts, &cancel, |done, total| {
            let _ = on_progress.send(Progress { done, total });
        });
        state.end_task(&task_id);
        r
    })
    .await
    .map_err(join_err)
}

#[tauri::command]
pub async fn find_broken(app: AppHandle, paths: Vec<String>, task_id: String, on_progress: Channel<Progress>) -> Result<Vec<BrokenFile>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cancel = state.new_task(&task_id);
        let opts = *state.decode_opts.read();
        let p: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let r = organize::find_broken(&p, &opts, &cancel, |done, total| {
            let _ = on_progress.send(Progress { done, total });
        });
        state.end_task(&task_id);
        r
    })
    .await
    .map_err(join_err)
}
