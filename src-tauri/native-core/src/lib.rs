//! Tactile Reader portable core.
//!
//! SQLite library, archive importers (CBZ/CBR/7z collections, image folders),
//! derived page cache with LRU eviction, bookmarks, reader states and series
//! naming. No UI framework, no Tauri, no PDF runtime: hosts that can render
//! PDF inject a backend through [`archive::set_pdf_backend`]. Without one,
//! PDF imports report "unavailable" and originals are preserved.

pub mod archive;
pub mod db;
pub mod error;
pub mod importer;
pub mod models;
pub mod publication_names;

pub use db::LibraryDb;
pub use error::{CoreError, CoreResult};
