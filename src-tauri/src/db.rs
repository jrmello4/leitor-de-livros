use std::{
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::{
    error::{CoreError, CoreResult},
    models::{
        CacheInfo, NativeBookmark, NativePage, NativePublication, NativeReaderState, NewPublication,
    },
};

const DEFAULT_CACHE_LIMIT_BYTES: i64 = 2 * 1024 * 1024 * 1024;
const MIGRATION_VERSION: i64 = 3;

pub struct LibraryDb {
    connection: Mutex<Connection>,
    cache_dir: PathBuf,
}

impl LibraryDb {
    pub fn open(data_dir: PathBuf) -> CoreResult<Self> {
        std::fs::create_dir_all(&data_dir)?;
        let cache_dir = data_dir.join("cache").join("pages");
        std::fs::create_dir_all(&cache_dir)?;

        let database_path = data_dir.join("reader.sqlite3");
        let mut connection = Connection::open(database_path)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;",
        )?;
        migrate(&mut connection)?;

        Ok(Self {
            connection: Mutex::new(connection),
            cache_dir,
        })
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub fn list_publications(&self) -> CoreResult<Vec<NativePublication>> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let mut statement = connection.prepare(
            "SELECT id, title, source_label, format, cover_page_id, direction,
                    added_at, updated_at, is_favorite, diagnostic
               FROM publications
              ORDER BY updated_at DESC, title COLLATE NOCASE ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(PublicationRow {
                id: row.get(0)?,
                title: row.get(1)?,
                source_label: row.get(2)?,
                format: row.get(3)?,
                cover_page_id: row.get(4)?,
                direction: row.get(5)?,
                added_at: row.get(6)?,
                updated_at: row.get(7)?,
                is_favorite: row.get::<_, i64>(8)? != 0,
                diagnostic: row.get(9)?,
            })
        })?;

        let mut publications = Vec::new();
        for row in rows {
            publications.push(self.read_publication(&connection, row?)?);
        }
        Ok(publications)
    }

    pub fn find_by_source_path(&self, source_path: &str) -> CoreResult<Option<NativePublication>> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let row = connection
            .query_row(
                "SELECT id, title, source_label, format, cover_page_id, direction,
                        added_at, updated_at, is_favorite, diagnostic
                   FROM publications
                  WHERE source_path = ?1",
                [source_path],
                |row| {
                    Ok(PublicationRow {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        source_label: row.get(2)?,
                        format: row.get(3)?,
                        cover_page_id: row.get(4)?,
                        direction: row.get(5)?,
                        added_at: row.get(6)?,
                        updated_at: row.get(7)?,
                        is_favorite: row.get::<_, i64>(8)? != 0,
                        diagnostic: row.get(9)?,
                    })
                },
            )
            .optional()?;

        row.map(|publication| self.read_publication(&connection, publication))
            .transpose()
    }

    pub fn insert_publication(
        &self,
        publication: &NewPublication,
    ) -> CoreResult<NativePublication> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let transaction = connection.transaction()?;

        transaction.execute(
            "INSERT INTO publications
                (id, title, source_label, format, source_path, cover_page_id,
                 direction, added_at, updated_at, diagnostic)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                publication.id,
                publication.title,
                publication.source_label,
                publication.format,
                publication.source_path,
                publication.cover_page_id,
                publication.direction,
                publication.added_at,
                publication.updated_at,
                publication.diagnostic,
            ],
        )?;

        for page in &publication.pages {
            let cache_path = page
                .cache_path
                .to_str()
                .ok_or_else(|| CoreError::from("cache path is not valid UTF-8"))?;
            transaction.execute(
                "INSERT INTO pages
                    (id, publication_id, page_index, name, cache_path, width, height)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    page.id,
                    publication.id,
                    page.index as i64,
                    page.name,
                    cache_path,
                    page.width as i64,
                    page.height as i64,
                ],
            )?;
        }

        transaction.execute(
            "INSERT INTO progress (publication_id, current_page, updated_at)
             VALUES (?1, ?2, ?3)",
            params![
                publication.id,
                publication.current_page as i64,
                publication.updated_at
            ],
        )?;
        transaction.commit()?;
        drop(connection);

        self.find_by_source_path(&publication.source_path)?
            .ok_or_else(|| CoreError::from("publication disappeared after insert"))
    }

    pub fn save_progress(&self, publication_id: &str, current_page: u32) -> CoreResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let updated_at = now();
        connection.execute(
            "INSERT INTO progress (publication_id, current_page, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(publication_id) DO UPDATE SET
                 current_page = excluded.current_page,
                 updated_at = excluded.updated_at",
            params![publication_id, current_page, updated_at],
        )?;
        connection.execute(
            "UPDATE publications SET updated_at = ?1 WHERE id = ?2",
            params![updated_at, publication_id],
        )?;
        Ok(())
    }

    pub fn set_publication_favorite(
        &self,
        publication_id: &str,
        is_favorite: bool,
    ) -> CoreResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        connection.execute(
            "UPDATE publications SET is_favorite = ?1, updated_at = ?2 WHERE id = ?3",
            params![if is_favorite { 1 } else { 0 }, now(), publication_id],
        )?;
        Ok(())
    }

    pub fn list_bookmarks(&self, publication_id: &str) -> CoreResult<Vec<NativeBookmark>> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let mut statement = connection.prepare(
            "SELECT page_id, label, created_at, updated_at
               FROM bookmarks
              WHERE publication_id = ?1
              ORDER BY created_at ASC, page_id ASC",
        )?;
        let bookmarks = statement
            .query_map([publication_id], |row| {
                Ok(NativeBookmark {
                    page_id: row.get(0)?,
                    label: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(bookmarks)
    }

    pub fn upsert_bookmark(
        &self,
        publication_id: &str,
        bookmark: &NativeBookmark,
    ) -> CoreResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        connection.execute(
            "INSERT INTO bookmarks (publication_id, page_id, label, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(publication_id, page_id) DO UPDATE SET
                 label = excluded.label,
                 updated_at = excluded.updated_at",
            params![
                publication_id,
                bookmark.page_id,
                bookmark.label,
                bookmark.created_at,
                bookmark.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn remove_bookmark(&self, publication_id: &str, page_id: &str) -> CoreResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        connection.execute(
            "DELETE FROM bookmarks WHERE publication_id = ?1 AND page_id = ?2",
            params![publication_id, page_id],
        )?;
        Ok(())
    }

    pub fn save_reader_state(
        &self,
        publication_id: &str,
        state: &NativeReaderState,
    ) -> CoreResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        connection.execute(
            "INSERT INTO reader_states
                (publication_id, zoom_mode, zoom_scale, pan_x, pan_y, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(publication_id) DO UPDATE SET
                 zoom_mode = excluded.zoom_mode,
                 zoom_scale = excluded.zoom_scale,
                 pan_x = excluded.pan_x,
                 pan_y = excluded.pan_y,
                 updated_at = excluded.updated_at",
            params![
                publication_id,
                state.zoom_mode,
                state.zoom_scale,
                state.pan_x,
                state.pan_y,
                now(),
            ],
        )?;
        Ok(())
    }

    pub fn load_reader_state(&self, publication_id: &str) -> CoreResult<Option<NativeReaderState>> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        connection
            .query_row(
                "SELECT zoom_mode, zoom_scale, pan_x, pan_y
                   FROM reader_states
                  WHERE publication_id = ?1",
                [publication_id],
                |row| {
                    Ok(NativeReaderState {
                        zoom_mode: row.get(0)?,
                        zoom_scale: row.get(1)?,
                        pan_x: row.get(2)?,
                        pan_y: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn cache_info(&self) -> CoreResult<CacheInfo> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let (used_bytes, entry_count) = connection.query_row(
            "SELECT COALESCE(SUM(byte_size), 0), COUNT(*) FROM cache_entries",
            [],
            |row| Ok((row.get(0)?, row.get::<_, i64>(1)?)),
        )?;
        let max_bytes = connection.query_row(
            "SELECT max_bytes FROM cache_settings WHERE id = 'default'",
            [],
            |row| row.get(0),
        )?;
        Ok(CacheInfo {
            used_bytes,
            max_bytes,
            entry_count: entry_count.max(0) as usize,
        })
    }

    pub fn set_cache_limit(&self, max_bytes: i64) -> CoreResult<()> {
        if max_bytes <= 0 {
            return Err(CoreError::from("cache limit must be greater than zero"));
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        connection.execute(
            "INSERT INTO cache_settings (id, max_bytes, updated_at)
             VALUES ('default', ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET
                 max_bytes = excluded.max_bytes,
                 updated_at = excluded.updated_at",
            params![max_bytes, now()],
        )?;
        Ok(())
    }

    pub fn clear_cache(&self) -> CoreResult<()> {
        let cache_root = self.cache_dir.canonicalize()?;
        for entry in std::fs::read_dir(&cache_root)? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                std::fs::remove_dir_all(path)?;
            } else {
                std::fs::remove_file(path)?;
            }
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        connection.execute("DELETE FROM cache_entries", [])?;
        Ok(())
    }

    pub fn delete_publication(&self, publication_id: &str) -> CoreResult<()> {
        let cache_publication_dir = self.publication_cache_dir(publication_id)?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let transaction = connection.transaction()?;
        for table in [
            "bookmarks",
            "reader_states",
            "cache_entries",
            "panel_graphs",
            "progress",
            "pages",
        ] {
            transaction.execute(
                &format!("DELETE FROM {table} WHERE publication_id = ?1"),
                [publication_id],
            )?;
        }
        transaction.execute("DELETE FROM publications WHERE id = ?1", [publication_id])?;
        transaction.commit()?;
        drop(connection);

        if cache_publication_dir.exists() {
            std::fs::remove_dir_all(cache_publication_dir)?;
        }
        Ok(())
    }

    pub fn load_profile(&self) -> CoreResult<Option<Value>> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let payload = connection
            .query_row(
                "SELECT payload_json FROM profiles WHERE id = 'default'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(payload.and_then(|json| serde_json::from_str(&json).ok()))
    }

    pub fn save_profile(&self, profile: &Value) -> CoreResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let version = profile.get("version").and_then(Value::as_i64).unwrap_or(1);
        connection.execute(
            "INSERT INTO profiles (id, version, payload_json, updated_at)
             VALUES ('default', ?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
                 version = excluded.version,
                 payload_json = excluded.payload_json,
                 updated_at = excluded.updated_at",
            params![version, serde_json::to_string(profile)?, now()],
        )?;
        Ok(())
    }

    pub fn load_panel_graph(
        &self,
        publication_id: &str,
        page_id: &str,
    ) -> CoreResult<Option<Value>> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let payload = connection
            .query_row(
                "SELECT payload_json
                   FROM panel_graphs
                  WHERE publication_id = ?1 AND page_id = ?2",
                params![publication_id, page_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(payload.and_then(|json| serde_json::from_str(&json).ok()))
    }

    pub fn save_panel_graph(
        &self,
        publication_id: &str,
        page_id: &str,
        graph: &Value,
    ) -> CoreResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let updated_at = now();
        connection.execute(
            "INSERT INTO panel_graphs (publication_id, page_id, schema_version, payload_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(publication_id, page_id) DO UPDATE SET
                 schema_version = excluded.schema_version,
                 payload_json = excluded.payload_json,
                 updated_at = excluded.updated_at",
            params![
                publication_id,
                page_id,
                graph.get("version").and_then(Value::as_i64).unwrap_or(1),
                serde_json::to_string(graph)?,
                updated_at,
            ],
        )?;
        Ok(())
    }

    fn publication_cache_dir(&self, publication_id: &str) -> CoreResult<PathBuf> {
        let publication_path = Path::new(publication_id);
        let mut components = publication_path.components();
        let is_single_normal_component =
            matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
        if !is_single_normal_component {
            return Err(CoreError::from("invalid publication id for cache deletion"));
        }

        let cache_root = self.cache_dir.canonicalize()?;
        let candidate = self.cache_dir.join(publication_path);
        if candidate.exists() && !candidate.canonicalize()?.starts_with(&cache_root) {
            return Err(CoreError::from("cache path escapes the cache directory"));
        }
        Ok(candidate)
    }

    fn read_publication(
        &self,
        connection: &Connection,
        row: PublicationRow,
    ) -> CoreResult<NativePublication> {
        let mut page_statement = connection.prepare(
            "SELECT id, page_index, name, cache_path, width, height
               FROM pages
              WHERE publication_id = ?1
              ORDER BY page_index ASC",
        )?;
        let pages = page_statement
            .query_map([&row.id], |page| {
                Ok(NativePage {
                    id: page.get(0)?,
                    index: page.get::<_, i64>(1)? as usize,
                    name: page.get(2)?,
                    cache_path: page.get(3)?,
                    width: page.get::<_, i64>(4)? as u32,
                    height: page.get::<_, i64>(5)? as u32,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let current_page = connection
            .query_row(
                "SELECT current_page FROM progress WHERE publication_id = ?1",
                [&row.id],
                |progress| progress.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0)
            .max(0) as usize;
        let progress = calculate_progress(current_page, pages.len(), &row.direction);

        Ok(NativePublication {
            id: row.id,
            title: row.title,
            source_label: row.source_label,
            format: row.format,
            cover_page_id: row.cover_page_id,
            current_page: current_page.min(pages.len().saturating_sub(1)),
            progress,
            direction: row.direction,
            added_at: row.added_at,
            updated_at: row.updated_at,
            is_favorite: row.is_favorite,
            diagnostic: row.diagnostic,
            pages,
        })
    }
}

#[derive(Debug)]
struct PublicationRow {
    id: String,
    title: String,
    source_label: String,
    format: String,
    cover_page_id: String,
    direction: String,
    added_at: String,
    updated_at: String,
    is_favorite: bool,
    diagnostic: Option<String>,
}

fn migrate(connection: &mut Connection) -> CoreResult<()> {
    let transaction = connection.transaction()?;
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
             version INTEGER PRIMARY KEY,
             applied_at TEXT NOT NULL
         )",
    )?;
    let current_version = transaction.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;

    if current_version < 1 {
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS publications (
                 id TEXT PRIMARY KEY,
                 title TEXT NOT NULL,
                 source_label TEXT NOT NULL,
                 format TEXT NOT NULL,
                 source_path TEXT NOT NULL UNIQUE,
                 cover_page_id TEXT NOT NULL,
                 direction TEXT NOT NULL DEFAULT 'ltr',
                 added_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL,
                 diagnostic TEXT
             );
             CREATE TABLE IF NOT EXISTS pages (
                 id TEXT PRIMARY KEY,
                 publication_id TEXT NOT NULL,
                 page_index INTEGER NOT NULL,
                 name TEXT NOT NULL,
                 cache_path TEXT NOT NULL,
                 width INTEGER NOT NULL,
                 height INTEGER NOT NULL,
                 FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE,
                 UNIQUE(publication_id, page_index)
             );
             CREATE TABLE IF NOT EXISTS progress (
                 publication_id TEXT PRIMARY KEY,
                 current_page INTEGER NOT NULL DEFAULT 0,
                 updated_at TEXT NOT NULL,
                 FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS profiles (
                 id TEXT PRIMARY KEY,
                 version INTEGER NOT NULL,
                 payload_json TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS pages_publication_index
                 ON pages(publication_id, page_index);",
        )?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![1, now()],
        )?;
    }

    if current_version < 2 {
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS panel_graphs (
                 publication_id TEXT NOT NULL,
                 page_id TEXT NOT NULL,
                 schema_version INTEGER NOT NULL,
                 payload_json TEXT NOT NULL,
                 updated_at TEXT NOT NULL,
                 PRIMARY KEY (publication_id, page_id),
                 FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS panel_graphs_publication_index
                 ON panel_graphs(publication_id, updated_at DESC);",
        )?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?1)",
            params![now()],
        )?;
    }

    if current_version < MIGRATION_VERSION {
        if !column_exists(&transaction, "publications", "is_favorite")? {
            transaction.execute_batch(
                "ALTER TABLE publications
                 ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;",
            )?;
        }
        if !column_exists(&transaction, "pages", "source_ref")? {
            transaction.execute_batch(
                "ALTER TABLE pages ADD COLUMN source_ref TEXT NOT NULL DEFAULT '';",
            )?;
        }
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS reader_states (
                 publication_id TEXT PRIMARY KEY,
                 zoom_mode TEXT NOT NULL DEFAULT 'page',
                 zoom_scale REAL NOT NULL DEFAULT 1.0,
                 pan_x REAL NOT NULL DEFAULT 0.0,
                 pan_y REAL NOT NULL DEFAULT 0.0,
                 updated_at TEXT NOT NULL,
                 FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS bookmarks (
                 publication_id TEXT NOT NULL,
                 page_id TEXT NOT NULL,
                 label TEXT NOT NULL DEFAULT '',
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL,
                 PRIMARY KEY(publication_id, page_id),
                 FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE,
                 FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS cache_entries (
                 page_id TEXT PRIMARY KEY,
                 publication_id TEXT NOT NULL,
                 cache_path TEXT NOT NULL,
                 byte_size INTEGER NOT NULL,
                 last_accessed_at TEXT NOT NULL,
                 pinned INTEGER NOT NULL DEFAULT 0,
                 FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE,
                 FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS cache_settings (
                 id TEXT PRIMARY KEY,
                 max_bytes INTEGER NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS bookmarks_publication_index
                 ON bookmarks(publication_id, created_at ASC);
             CREATE INDEX IF NOT EXISTS cache_entries_publication_index
                 ON cache_entries(publication_id, last_accessed_at ASC);",
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO cache_settings (id, max_bytes, updated_at)
             VALUES ('default', ?1, ?2)",
            params![DEFAULT_CACHE_LIMIT_BYTES, now()],
        )?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?1)",
            params![now()],
        )?;
    }

    transaction.commit()?;
    Ok(())
}

fn column_exists(
    transaction: &rusqlite::Transaction<'_>,
    table: &str,
    column: &str,
) -> CoreResult<bool> {
    transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2)",
            params![table, column],
            |row| row.get::<_, i64>(0),
        )
        .map(|exists| exists != 0)
        .map_err(Into::into)
}

fn calculate_progress(current_page: usize, page_count: usize, direction: &str) -> f64 {
    if page_count == 0 {
        return 0.0;
    }
    if page_count == 1 {
        return 1.0;
    }
    let safe_page = current_page.min(page_count - 1);
    let logical_page = if direction == "rtl" {
        page_count - 1 - safe_page
    } else {
        safe_page
    };
    (logical_page + 1) as f64 / page_count as f64
}

fn now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{NativeBookmark, NativeReaderState, NewPage};

    const TWO_GIB: i64 = 2 * 1024 * 1024 * 1024;

    fn temporary_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("tactile-reader-{label}-{}", now()))
    }

    fn insert_test_publication(database: &LibraryDb, source_path: &str) {
        let cache_path = database
            .cache_dir()
            .join("publication-1")
            .join("page-1.png");
        std::fs::create_dir_all(cache_path.parent().expect("cache parent"))
            .expect("cache directory");
        std::fs::write(&cache_path, b"derived page").expect("cache page");
        database
            .insert_publication(&NewPublication {
                id: "publication-1".to_owned(),
                title: "Test publication".to_owned(),
                source_label: "Test source".to_owned(),
                source_path: source_path.to_owned(),
                format: "images".to_owned(),
                pages: vec![NewPage {
                    id: "page-1".to_owned(),
                    index: 0,
                    name: "page-1.png".to_owned(),
                    cache_path,
                    width: 1,
                    height: 1,
                }],
                cover_page_id: "page-1".to_owned(),
                current_page: 0,
                direction: "ltr".to_owned(),
                added_at: "0".to_owned(),
                updated_at: "0".to_owned(),
                diagnostic: None,
            })
            .expect("insert publication");
    }

    #[test]
    fn migration_is_idempotent_and_profile_round_trips() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys");
        migrate(&mut connection).expect("first migration");
        migrate(&mut connection).expect("second migration");

        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration version");
        assert_eq!(version, MIGRATION_VERSION);
        let cache_limit: i64 = connection
            .query_row(
                "SELECT max_bytes FROM cache_settings WHERE id = 'default'",
                [],
                |row| row.get(0),
            )
            .expect("default cache limit");
        assert_eq!(cache_limit, TWO_GIB);
    }

    #[test]
    fn existing_v1_database_receives_panel_graph_schema() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite");
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (
                     version INTEGER PRIMARY KEY,
                     applied_at TEXT NOT NULL
                 );
                 INSERT INTO schema_migrations (version, applied_at) VALUES (1, '0');
                 CREATE TABLE publications (id TEXT PRIMARY KEY);
                 CREATE TABLE pages (
                    id TEXT PRIMARY KEY,
                    publication_id TEXT NOT NULL,
                    page_index INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    cache_path TEXT NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL
                 );",
            )
            .expect("v1 schema");

        migrate(&mut connection).expect("migrate v1 database");
        let graph_table: String = connection
            .query_row(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'panel_graphs'",
                [],
                |row| row.get(0),
            )
            .expect("panel graph table");
        assert_eq!(graph_table, "panel_graphs");
    }

    #[test]
    fn existing_v1_database_gains_metadata_columns_and_tables() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite");
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                 INSERT INTO schema_migrations (version, applied_at) VALUES (1, '0');
                 CREATE TABLE publications (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, source_label TEXT NOT NULL,
                    format TEXT NOT NULL, source_path TEXT NOT NULL UNIQUE, cover_page_id TEXT NOT NULL,
                    direction TEXT NOT NULL DEFAULT 'ltr', added_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL, diagnostic TEXT
                 );
                 CREATE TABLE pages (
                    id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, page_index INTEGER NOT NULL,
                    name TEXT NOT NULL, cache_path TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL
                 );",
            )
            .expect("v1 schema");

        migrate(&mut connection).expect("migrate v1 database");

        let favorite_column: String = connection
            .query_row(
                "SELECT name FROM pragma_table_info('publications') WHERE name = 'is_favorite'",
                [],
                |row| row.get(0),
            )
            .expect("favorite column");
        let source_ref_column: String = connection
            .query_row(
                "SELECT name FROM pragma_table_info('pages') WHERE name = 'source_ref'",
                [],
                |row| row.get(0),
            )
            .expect("source reference column");
        assert_eq!(favorite_column, "is_favorite");
        assert_eq!(source_ref_column, "source_ref");
        for table in [
            "reader_states",
            "bookmarks",
            "cache_entries",
            "cache_settings",
        ] {
            let actual: String = connection
                .query_row(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .expect("metadata table");
            assert_eq!(actual, table);
        }
    }

    #[test]
    fn existing_v2_database_keeps_progress_when_upgraded_to_v3() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite");
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                 INSERT INTO schema_migrations (version, applied_at) VALUES (1, '0'), (2, '0');
                 CREATE TABLE publications (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, source_label TEXT NOT NULL,
                    format TEXT NOT NULL, source_path TEXT NOT NULL UNIQUE, cover_page_id TEXT NOT NULL,
                    direction TEXT NOT NULL DEFAULT 'ltr', added_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL, diagnostic TEXT
                 );
                 INSERT INTO publications VALUES ('publication-1', 'Test', 'Test', 'images', 'source:test', 'page-1', 'ltr', '0', '0', NULL);
                 CREATE TABLE pages (
                    id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, page_index INTEGER NOT NULL,
                    name TEXT NOT NULL, cache_path TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL
                 );
                 CREATE TABLE progress (publication_id TEXT PRIMARY KEY, current_page INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
                 INSERT INTO progress VALUES ('publication-1', 4, '0');",
            )
            .expect("v2 schema");

        migrate(&mut connection).expect("migrate v2 database");

        let current_page: i64 = connection
            .query_row(
                "SELECT current_page FROM progress WHERE publication_id = 'publication-1'",
                [],
                |row| row.get(0),
            )
            .expect("progress retained");
        assert_eq!(current_page, 4);
    }

    #[test]
    fn favorites_bookmarks_and_reader_state_round_trip_and_delete() {
        let root = temporary_root("metadata");
        let source_path = root.join("source.cbz");
        std::fs::create_dir_all(&root).expect("root");
        std::fs::write(&source_path, b"original source").expect("source");
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication(&database, &source_path.to_string_lossy());

        database
            .set_publication_favorite("publication-1", true)
            .expect("favorite");
        assert!(database.list_publications().expect("publications")[0].is_favorite);

        let bookmark = NativeBookmark {
            page_id: "page-1".to_owned(),
            label: "A favorite panel".to_owned(),
            created_at: "1".to_owned(),
            updated_at: "1".to_owned(),
        };
        database
            .upsert_bookmark("publication-1", &bookmark)
            .expect("save bookmark");
        assert_eq!(
            database.list_bookmarks("publication-1").expect("bookmarks"),
            vec![bookmark.clone()]
        );

        let state = NativeReaderState {
            zoom_mode: "manual".to_owned(),
            zoom_scale: 1.7,
            pan_x: 20.0,
            pan_y: -12.0,
        };
        database
            .save_reader_state("publication-1", &state)
            .expect("save state");
        assert_eq!(
            database.load_reader_state("publication-1").expect("state"),
            Some(state)
        );

        database
            .remove_bookmark("publication-1", "page-1")
            .expect("remove bookmark");
        assert!(database
            .list_bookmarks("publication-1")
            .expect("bookmarks")
            .is_empty());

        database
            .upsert_bookmark("publication-1", &bookmark)
            .expect("save bookmark again");
        database
            .delete_publication("publication-1")
            .expect("delete publication");
        assert!(database
            .list_bookmarks("publication-1")
            .expect("bookmarks")
            .is_empty());
        assert_eq!(
            database.load_reader_state("publication-1").expect("state"),
            None
        );

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn bookmarks_cascade_when_the_publication_row_is_deleted() {
        let root = temporary_root("bookmark-cascade");
        let source_path = root.join("source.cbz");
        std::fs::create_dir_all(&root).expect("root");
        std::fs::write(&source_path, b"original source").expect("source");
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication(&database, &source_path.to_string_lossy());
        database
            .upsert_bookmark(
                "publication-1",
                &NativeBookmark {
                    page_id: "page-1".to_owned(),
                    label: "Opening".to_owned(),
                    created_at: "1".to_owned(),
                    updated_at: "1".to_owned(),
                },
            )
            .expect("save bookmark");

        let connection = database.connection.lock().expect("database lock");
        connection
            .execute("DELETE FROM publications WHERE id = 'publication-1'", [])
            .expect("delete publication row");
        drop(connection);

        assert!(database
            .list_bookmarks("publication-1")
            .expect("bookmarks")
            .is_empty());

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn cache_info_limit_and_clear_cache_round_trip() {
        let root = temporary_root("cache-info");
        let source_path = root.join("source.cbz");
        std::fs::create_dir_all(&root).expect("root");
        std::fs::write(&source_path, b"original source").expect("source");
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication(&database, &source_path.to_string_lossy());
        let cached_page = database
            .cache_dir()
            .join("publication-1")
            .join("page-1.png");
        let cached_bytes = std::fs::metadata(&cached_page)
            .expect("cached page metadata")
            .len() as i64;
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "INSERT INTO cache_entries
                    (page_id, publication_id, cache_path, byte_size, last_accessed_at, pinned)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                params![
                    "page-1",
                    "publication-1",
                    cached_page.to_string_lossy(),
                    cached_bytes,
                    "1"
                ],
            )
            .expect("cache entry");
        drop(connection);

        assert_eq!(
            database.cache_info().expect("initial cache info"),
            CacheInfo {
                used_bytes: cached_bytes,
                max_bytes: TWO_GIB,
                entry_count: 1,
            }
        );

        database.set_cache_limit(4096).expect("cache limit");
        database.clear_cache().expect("clear cache");

        assert_eq!(
            database.cache_info().expect("cleared cache info"),
            CacheInfo {
                used_bytes: 0,
                max_bytes: 4096,
                entry_count: 0,
            }
        );
        assert!(!cached_page.exists());
        assert!(database.cache_dir().is_dir());

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn cache_limit_rejects_non_positive_values() {
        let root = temporary_root("cache-limit-validation");
        let database = LibraryDb::open(root.clone()).expect("database");

        assert!(database.set_cache_limit(0).is_err());
        assert!(database.set_cache_limit(-1).is_err());
        assert_eq!(
            database.cache_info().expect("cache info").max_bytes,
            TWO_GIB
        );

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn deleting_publication_removes_only_its_derived_cache_and_preserves_source_bytes() {
        let root = temporary_root("delete");
        let source_path = root.join("external-source.cbz");
        let source_bytes = b"sentinel source bytes";
        std::fs::create_dir_all(&root).expect("root");
        std::fs::write(&source_path, source_bytes).expect("sentinel source");
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication(&database, &source_path.to_string_lossy());
        let cache_publication_dir = database.cache_dir().join("publication-1");
        assert!(cache_publication_dir.is_dir());

        database
            .delete_publication("publication-1")
            .expect("delete publication");

        assert!(database
            .list_publications()
            .expect("publications")
            .is_empty());
        assert!(!cache_publication_dir.exists());
        assert_eq!(
            std::fs::read(&source_path).expect("read sentinel"),
            source_bytes
        );

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn deleting_publication_rejects_current_directory_as_an_id() {
        let root = temporary_root("delete-current-directory");
        let database = LibraryDb::open(root.clone()).expect("database");
        let cache_sentinel = database.cache_dir().join("sentinel.bin");
        std::fs::write(&cache_sentinel, b"derived cache sentinel").expect("cache sentinel");

        let result = database.delete_publication(".");
        let preserved_bytes = std::fs::read(&cache_sentinel);

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");

        assert!(result.is_err(), "current directory must not be a valid id");
        assert_eq!(
            preserved_bytes.expect("cache sentinel remains readable"),
            b"derived cache sentinel"
        );
    }

    #[test]
    fn panel_graph_round_trips_after_migration() {
        let root = std::env::temp_dir().join(format!("tactile-reader-panel-{}", now()));
        let database = LibraryDb::open(root.clone()).expect("database");
        let graph = serde_json::json!({
            "version": 1,
            "pageId": "page-1",
            "regions": [{ "id": "page-1:panel-1", "order": 0 }]
        });

        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "INSERT INTO publications
                    (id, title, source_label, format, source_path, cover_page_id,
                     direction, added_at, updated_at, diagnostic)
                 VALUES ('publication-1', 'Test', 'Test', 'images', 'source:test', 'page-1',
                         'ltr', '0', '0', NULL)",
                [],
            )
            .expect("publication");
        drop(connection);
        database
            .save_panel_graph("publication-1", "page-1", &graph)
            .expect("save graph");
        assert_eq!(
            database
                .load_panel_graph("publication-1", "page-1")
                .expect("load graph"),
            Some(graph)
        );

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }
}
