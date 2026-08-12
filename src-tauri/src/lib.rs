mod adapters;
mod db;
mod error;
mod importer;
mod models;

use db::LibraryDb;
use models::{CacheInfo, NativeBookmark, NativeImportResult, NativePublication, NativeReaderState};
use tauri::{path::BaseDirectory, Manager, State};

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
fn set_publication_favorite(
    publication_id: String,
    is_favorite: bool,
    database: State<'_, LibraryDb>,
) -> Result<(), String> {
    database
        .set_publication_favorite(&publication_id, is_favorite)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_bookmarks(
    publication_id: String,
    database: State<'_, LibraryDb>,
) -> Result<Vec<NativeBookmark>, String> {
    database
        .list_bookmarks(&publication_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn upsert_bookmark(
    publication_id: String,
    bookmark: NativeBookmark,
    database: State<'_, LibraryDb>,
) -> Result<(), String> {
    database
        .upsert_bookmark(&publication_id, &bookmark)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_bookmark(
    publication_id: String,
    page_id: String,
    database: State<'_, LibraryDb>,
) -> Result<(), String> {
    database
        .remove_bookmark(&publication_id, &page_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_reader_state(
    publication_id: String,
    state: NativeReaderState,
    database: State<'_, LibraryDb>,
) -> Result<(), String> {
    database
        .save_reader_state(&publication_id, &state)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_reader_state(
    publication_id: String,
    database: State<'_, LibraryDb>,
) -> Result<Option<NativeReaderState>, String> {
    database
        .load_reader_state(&publication_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_cache_info(database: State<'_, LibraryDb>) -> Result<CacheInfo, String> {
    database.cache_info().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_cache_limit(max_bytes: i64, database: State<'_, LibraryDb>) -> Result<(), String> {
    database
        .set_cache_limit(max_bytes)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_cache(database: State<'_, LibraryDb>) -> Result<(), String> {
    database.clear_cache().map_err(|error| error.to_string())
}

#[tauri::command]
fn touch_pages(
    publication_id: String,
    page_ids: Vec<String>,
    database: State<'_, LibraryDb>,
) -> Result<(), String> {
    database
        .touch_page_cache_for_publication(&publication_id, &page_ids)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_publication(
    publication_id: String,
    database: State<'_, LibraryDb>,
) -> Result<(), String> {
    database
        .delete_publication(&publication_id)
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

#[tauri::command]
fn load_panel_graph(
    publication_id: String,
    page_id: String,
    database: State<'_, LibraryDb>,
) -> Result<Option<serde_json::Value>, String> {
    database
        .load_panel_graph(&publication_id, &page_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_panel_graph(
    publication_id: String,
    page_id: String,
    graph: serde_json::Value,
    database: State<'_, LibraryDb>,
) -> Result<(), String> {
    database
        .save_panel_graph(&publication_id, &page_id, &graph)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let pdfium_resource = app.path().resolve("pdfium.dll", BaseDirectory::Resource)?;
            adapters::configure_pdfium_resource_path(pdfium_resource);
            let data_dir = app.path().app_data_dir()?;
            let database = LibraryDb::open(data_dir)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_publications,
            import_publications,
            save_progress,
            set_publication_favorite,
            list_bookmarks,
            upsert_bookmark,
            remove_bookmark,
            save_reader_state,
            load_reader_state,
            get_cache_info,
            set_cache_limit,
            clear_cache,
            touch_pages,
            delete_publication,
            load_profile,
            save_profile,
            load_panel_graph,
            save_panel_graph
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tactile Reader");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_page_does_not_serialize_source_reference_into_ipc() {
        let page = models::NativePage {
            id: "page-1".to_owned(),
            index: 0,
            name: "page.png".to_owned(),
            cache_path: "C:\\cache\\page.png".to_owned(),
            source_ref: Some(models::PageSourceRef::Image {
                path: "C:\\original\\page.png".to_owned(),
            }),
            width: 1200,
            height: 1700,
        };
        let value = serde_json::to_value(page).expect("page");

        assert!(value.get("sourceRef").is_none());
        assert!(!value.to_string().contains("original"));
    }

    #[test]
    fn native_metadata_types_serialize_with_frontend_field_names() {
        let publication = NativePublication {
            id: "publication-1".to_owned(),
            title: "Test".to_owned(),
            source_label: "Source".to_owned(),
            format: "images".to_owned(),
            pages: Vec::new(),
            cover_page_id: "page-1".to_owned(),
            current_page: 0,
            progress: 0.0,
            direction: "ltr".to_owned(),
            added_at: "1".to_owned(),
            updated_at: "2".to_owned(),
            is_favorite: true,
            diagnostic: None,
        };
        let reader_state = NativeReaderState {
            zoom_mode: "manual".to_owned(),
            zoom_scale: 1.5,
            pan_x: 10.0,
            pan_y: -5.0,
        };
        let bookmark = NativeBookmark {
            page_id: "page-1".to_owned(),
            label: "Opening".to_owned(),
            created_at: "1".to_owned(),
            updated_at: "2".to_owned(),
        };
        let cache_info = CacheInfo {
            used_bytes: 128,
            max_bytes: 1024,
            entry_count: 1,
        };

        assert_eq!(
            serde_json::to_value(publication).expect("publication")["isFavorite"],
            true
        );
        assert_eq!(
            serde_json::to_value(reader_state).expect("reader state"),
            serde_json::json!({
                "zoomMode": "manual",
                "zoomScale": 1.5,
                "panX": 10.0,
                "panY": -5.0,
            })
        );
        assert_eq!(
            serde_json::to_value(bookmark).expect("bookmark"),
            serde_json::json!({
                "pageId": "page-1",
                "label": "Opening",
                "createdAt": "1",
                "updatedAt": "2",
            })
        );
        assert_eq!(
            serde_json::to_value(cache_info).expect("cache info"),
            serde_json::json!({
                "usedBytes": 128,
                "maxBytes": 1024,
                "entryCount": 1,
            })
        );
    }
}
