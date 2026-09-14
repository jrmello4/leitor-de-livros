use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PageSourceRef {
    Image { path: String },
    Archive { path: String, member: String },
    Pdf { path: String, page_index: usize },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePage {
    pub id: String,
    pub index: usize,
    pub name: String,
    pub cache_path: String,
    #[serde(skip_serializing)]
    pub source_ref: Option<PageSourceRef>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePublication {
    pub id: String,
    pub title: String,
    pub source_label: String,
    pub source_names: Vec<String>,
    pub format: String,
    /// Empty for a library listing. The reader loads the pages of the one
    /// publication it opens; shipping every page of every publication to draw a
    /// grid of covers costs far more than the grid needs.
    pub pages: Vec<NativePage>,
    pub page_count: usize,
    /// Cache path of the page the cover is drawn from, so a listing can render
    /// a cover without carrying the page list.
    pub cover_src: Option<String>,
    /// Page the reader would resume on, kept so the cache can protect it
    /// without the listing loading every page.
    pub current_page_id: Option<String>,
    pub cover_page_id: String,
    pub current_page: usize,
    pub progress: f64,
    pub direction: String,
    pub added_at: String,
    pub updated_at: String,
    pub is_favorite: bool,
    pub diagnostic: Option<String>,
    pub custom_cover_path: Option<String>,
    pub custom_cover_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBookmark {
    pub page_id: String,
    pub label: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeReaderState {
    pub zoom_mode: String,
    pub zoom_scale: f64,
    pub pan_x: f64,
    pub pan_y: f64,
    #[serde(default)]
    pub page_id: Option<String>,
    #[serde(default)]
    pub scroll_ratio: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub used_bytes: i64,
    pub max_bytes: i64,
    pub entry_count: usize,
}

/// Uma chamada para hidratar bookmarks + viewport de toda a biblioteca.
/// Substitui o N×2 `list_bookmarks` + `load_reader_state` do boot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub bookmarks: std::collections::HashMap<String, Vec<NativeBookmark>>,
    pub reader_states: std::collections::HashMap<String, NativeReaderState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImportResult {
    pub publications: Vec<NativePublication>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImportProgress {
    pub processed: usize,
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub current_name: String,
}

#[derive(Debug, Clone)]
pub struct NewPage {
    pub id: String,
    pub index: usize,
    pub name: String,
    pub cache_path: PathBuf,
    pub source_ref: PageSourceRef,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone)]
pub struct NewPublication {
    pub id: String,
    pub title: String,
    pub source_label: String,
    pub source_path: String,
    pub format: String,
    pub pages: Vec<NewPage>,
    pub cover_page_id: String,
    pub current_page: usize,
    pub direction: String,
    pub added_at: String,
    pub updated_at: String,
    pub diagnostic: Option<String>,
}
