mod commands;
mod media_server;
mod protocol;
mod state;

use commands::{data, files, library, tools, update};
use state::AppState;
use tauri::{Emitter, Manager};

/// Files/folders passed on the command line (file associations, "Open with").
fn launch_args(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| std::fs::canonicalize(a).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| a.clone()))
        .filter(|a| std::path::Path::new(a).exists())
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let paths = launch_args(&argv);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if !paths.is_empty() {
                let _ = app.emit("open-paths", paths);
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                // rawler logs a warning for every embedded image a camera lacks.
                .level_for("rawler", log::LevelFilter::Error)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("lumen".into()) }),
                ])
                .max_file_size(5 * 1024 * 1024)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .register_asynchronous_uri_scheme_protocol("lumen", |ctx, request, responder| {
            protocol::handle(ctx.app_handle(), request, responder);
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            let state = AppState::new(data_dir, cache_dir).map_err(|e| Box::new(std::io::Error::other(e.to_string())))?;
            *state.launch_paths.lock() = launch_args(&std::env::args().collect::<Vec<_>>());
            app.manage(state);
            protocol::start_workers(app.handle().clone());
            media_server::start();
            log::info!("ENViewer {} started", app.package_info().version);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library::get_formats,
            library::get_launch_paths,
            library::standard_folders,
            library::path_kind,
            library::list_subfolders,
            library::scan_folder,
            library::cancel_scan,
            library::load_items,
            library::set_thumb_generation,
            library::get_image_info,
            library::frontend_log,
            library::media_base_url,
            library::app_paths,
            data::get_favorites,
            data::set_favorite,
            data::list_collections,
            data::create_collection,
            data::rename_collection,
            data::delete_collection,
            data::add_to_collection,
            data::remove_from_collection,
            data::collection_items,
            data::add_recent,
            data::get_recents,
            data::clear_recents,
            data::get_pinned_folders,
            data::pin_folder,
            data::unpin_folder,
            data::get_settings,
            data::set_setting,
            data::cache_stats,
            data::clear_thumbnail_cache,
            data::get_edit,
            data::save_edit,
            files::reveal_in_folder,
            files::contact_developer,
            files::open_developer_website,
            update::check_update,
            update::install_update,
            update::restart_app,
            update::open_release_page,
            files::open_external,
            files::copy_text,
            files::copy_image,
            files::trash_paths,
            files::rename_path,
            files::transfer_paths,
            files::cancel_task,
            tools::export_image,
            tools::plan_batch_rename,
            tools::run_batch_rename,
            tools::batch_convert,
            tools::find_duplicates,
            tools::find_similar,
            tools::find_broken,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ENViewer");
}
