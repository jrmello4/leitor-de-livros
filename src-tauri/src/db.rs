use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::{
    error::{CoreError, CoreResult},
    models::{NativePage, NativePublication, NewPublication},
};

const MIGRATION_VERSION: i64 = 1;

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
                    added_at, updated_at, diagnostic
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
                diagnostic: row.get(8)?,
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
                        added_at, updated_at, diagnostic
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
                        diagnostic: row.get(8)?,
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

    if current_version < MIGRATION_VERSION {
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
            params![MIGRATION_VERSION, now()],
        )?;
    }

    transaction.commit()?;
    Ok(())
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
    }
}
