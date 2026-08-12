use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePage {
    pub id: String,
    pub index: usize,
    pub name: String,
    pub cache_path: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePublication {
    pub id: String,
    pub title: String,
    pub source_label: String,
    pub format: String,
    pub pages: Vec<NativePage>,
    pub cover_page_id: String,
    pub current_page: usize,
    pub progress: f64,
    pub direction: String,
    pub added_at: String,
    pub updated_at: String,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImportResult {
    pub publications: Vec<NativePublication>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct NewPage {
    pub id: String,
    pub index: usize,
    pub name: String,
    pub cache_path: PathBuf,
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
