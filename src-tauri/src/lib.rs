mod adapters;
mod db;
mod error;
mod importer;
mod models;

use db::LibraryDb;
use models::{NativeImportResult, NativePublication};
use tauri::{Manager, State};

#[tauri::command]
fn list_publications(database: State<'_, LibraryDb>) -> Result<Vec<NativePublication>, String> {
    database
        .list_publications()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_publications(
    paths: Vec<String>,
    database: State<'_, LibraryDb>,
) -> Result<NativeImportResult, String> {
    importer::import_paths(&database, &paths).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_progress(
    publication_id: String,
    current_page: u32,
    database: State<'_, LibraryDb>,
) -> Result<(), String> {
    database
        .save_progress(&publication_id, current_page)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_profile(database: State<'_, LibraryDb>) -> Result<Option<serde_json::Value>, String> {
    database.load_profile().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_profile(profile: serde_json::Value, database: State<'_, LibraryDb>) -> Result<(), String> {
    database
        .save_profile(&profile)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let database = LibraryDb::open(data_dir)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_publications,
            import_publications,
            save_progress,
            load_profile,
            save_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tactile Reader");
}
