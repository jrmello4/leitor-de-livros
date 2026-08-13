use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use image::{ImageFormat, ImageReader};

use crate::{
    error::{CoreError, CoreResult},
    models::{
        CacheInfo, NativeBookmark, NativePage, NativePublication, NativeReaderState,
        NewPublication, PageSourceRef,
    },
};

const DEFAULT_CACHE_LIMIT_BYTES: i64 = 2 * 1024 * 1024 * 1024;
const CACHE_MISSING_DIAGNOSTIC: &str =
    "Derived cache is unavailable; page reconstruction is required.";
#[allow(dead_code)]
const CACHE_UNREBUILDABLE_DIAGNOSTIC: &str =
    "The derived page cannot be reconstructed because its source reference is unavailable.";
const CUSTOM_COVER_MISSING_DIAGNOSTIC: &str =
    "The custom cover is unavailable; the original publication cover is shown.";
const MIGRATION_VERSION: i64 = 5;
const MAX_CUSTOM_COVER_BYTES: u64 = 10 * 1024 * 1024;

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
        retry_delete_tombstones(&cache_dir);
        retry_eviction_tombstones(&connection, &cache_dir);
        reconcile_cache_entries(&mut connection, &cache_dir)?;

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
                    added_at, updated_at, is_favorite, diagnostic,
                    custom_cover_cache, custom_cover_name
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
                custom_cover_cache: row.get(10)?,
                custom_cover_name: row.get(11)?,
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
                        added_at, updated_at, is_favorite, diagnostic,
                        custom_cover_cache, custom_cover_name
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
                        custom_cover_cache: row.get(10)?,
                        custom_cover_name: row.get(11)?,
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
                 direction, added_at, updated_at, diagnostic,
                 custom_cover_source, custom_cover_cache, custom_cover_name)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL, NULL)",
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
            let byte_size = cache_file_size(&self.cache_dir, &page.cache_path)?;
            transaction.execute(
                "INSERT INTO pages
                    (id, publication_id, page_index, name, cache_path, source_ref, width, height)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    page.id,
                    publication.id,
                    page.index as i64,
                    page.name,
                    cache_path,
                    serde_json::to_string(&page.source_ref)?,
                    page.width as i64,
                    page.height as i64,
                ],
            )?;
            transaction.execute(
                "INSERT INTO cache_entries
                    (page_id, publication_id, cache_path, byte_size, last_accessed_at, pinned)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                params![
                    page.id,
                    publication.id,
                    cache_path,
                    byte_size,
                    publication.updated_at
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

    pub fn set_custom_cover(&self, publication_id: &str, source_path: &str) -> CoreResult<()> {
        let source = Path::new(source_path)
            .canonicalize()
            .map_err(|_| CoreError::from("custom cover source is unavailable"))?;
        let metadata = std::fs::metadata(&source)?;
        if !metadata.is_file() {
            return Err(CoreError::from("custom cover source is not a file"));
        }
        if metadata.len() == 0 || metadata.len() > MAX_CUSTOM_COVER_BYTES {
            return Err(CoreError::from("custom cover exceeds the 10 MiB limit"));
        }
        let image = ImageReader::open(&source)?.with_guessed_format()?.decode()?;
        let source_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| CoreError::from("custom cover name is invalid"))?;
        let publication_cache_dir = self.publication_cache_dir(publication_id)?;
        std::fs::create_dir_all(&publication_cache_dir)?;
        let target = publication_cache_dir.join("custom-cover.png");
        let temporary = publication_cache_dir.join(format!(".custom-cover.{}.tmp", now()));
        image.save_with_format(&temporary, ImageFormat::Png)?;

        let mut connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let exists = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM publications WHERE id = ?1)",
            [publication_id],
            |row| row.get::<_, bool>(0),
        )?;
        if !exists {
            let _ = std::fs::remove_file(&temporary);
            return Err(CoreError::from("publication does not exist"));
        }

        let backup = publication_cache_dir.join(format!(".custom-cover.{}.bak", now()));
        if target.exists() {
            std::fs::rename(&target, &backup)?;
        }
        if let Err(error) = std::fs::rename(&temporary, &target) {
            if backup.exists() {
                let _ = std::fs::rename(&backup, &target);
            }
            let _ = std::fs::remove_file(&temporary);
            return Err(error.into());
        }

        let transaction_result = (|| -> CoreResult<()> {
            let transaction = connection.transaction()?;
            transaction.execute(
                "UPDATE publications
                    SET custom_cover_source = ?1,
                        custom_cover_cache = ?2,
                        custom_cover_name = ?3,
                        updated_at = ?4
                  WHERE id = ?5",
                params![
                    source.to_string_lossy().as_ref(),
                    target.to_string_lossy().as_ref(),
                    source_name,
                    now(),
                    publication_id,
                ],
            )?;
            transaction.commit()?;
            Ok(())
        })();
        if let Err(error) = transaction_result {
            let _ = std::fs::remove_file(&target);
            if backup.exists() {
                let _ = std::fs::rename(&backup, &target);
            }
            return Err(error);
        }
        let _ = std::fs::remove_file(&backup);
        Ok(())
    }

    pub fn clear_custom_cover(&self, publication_id: &str) -> CoreResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let (cache_path, source_path) = connection
            .query_row(
                "SELECT custom_cover_cache, custom_cover_source FROM publications WHERE id = ?1",
                [publication_id],
                |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?
            .ok_or_else(|| CoreError::from("publication does not exist or has no custom cover"))?;
        let changed = connection.execute(
            "UPDATE publications
                SET custom_cover_source = NULL,
                    custom_cover_cache = NULL,
                    custom_cover_name = NULL,
                    updated_at = ?1
              WHERE id = ?2",
            params![now(), publication_id],
        )?;
        if changed != 1 {
            return Err(CoreError::from("publication does not exist"));
        }
        let cache_root = self.cache_dir.canonicalize()?;
        let source_canonical = source_path
            .as_deref()
            .and_then(|path| Path::new(path).canonicalize().ok());
        if let Ok(canonical) = Path::new(cache_path.as_deref().unwrap_or_default()).canonicalize() {
            if canonical.starts_with(cache_root) && source_canonical.as_ref() != Some(&canonical) {
                let _ = std::fs::remove_file(canonical);
            }
        }
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
        let changed = connection.execute(
            "INSERT INTO bookmarks (publication_id, page_id, label, created_at, updated_at)
             SELECT ?1, ?2, ?3, ?4, ?5
              WHERE EXISTS (
                    SELECT 1 FROM pages WHERE id = ?2 AND publication_id = ?1
              )
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
        if changed == 0 {
            return Err(CoreError::from(
                "bookmark page does not belong to the publication",
            ));
        }
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

    #[allow(dead_code)]
    pub fn set_cache_limit(&self, max_bytes: i64) -> CoreResult<()> {
        self.set_cache_limit_with_protected(max_bytes, &[])
    }

    pub fn set_cache_limit_with_protected(
        &self,
        max_bytes: i64,
        protected_page_ids: &[String],
    ) -> CoreResult<()> {
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
        drop(connection);
        self.enforce_cache_limit(protected_page_ids)?;
        Ok(())
    }

    /// Marks cached pages as recently used for the active reader session.
    /// This is a recency hint only: it must not turn every visited page into
    /// a permanent pin, otherwise LRU cleanup could never reclaim it. An
    /// explicitly pinned entry remains pinned through `record_page_cache`'s
    /// `None` update. Missing derived files are skipped; the next reader open
    /// will rebuild them through `ensure_page_cache`.
    pub fn touch_page_cache_for_publication(
        &self,
        publication_id: &str,
        page_ids: &[String],
    ) -> CoreResult<()> {
        for page_id in page_ids {
            let cache_path = {
                let connection = self
                    .connection
                    .lock()
                    .map_err(|_| CoreError::from("database lock poisoned"))?;
                connection
                    .query_row(
                        "SELECT cache_path FROM pages
                          WHERE id = ?1 AND publication_id = ?2",
                        params![page_id, publication_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
            };
            let Some(cache_path) = cache_path else {
                return Err(CoreError::from("page does not belong to the publication"));
            };
            let Some((_, byte_size)) =
                validated_cache_file(&self.cache_dir, Path::new(&cache_path))?
            else {
                continue;
            };
            self.record_page_cache(page_id, byte_size, None)?;
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub fn touch_page_cache(&self, page_id: &str, byte_size: i64, pinned: bool) -> CoreResult<()> {
        self.record_page_cache(page_id, byte_size, Some(pinned))
    }

    fn record_page_cache(
        &self,
        page_id: &str,
        byte_size: i64,
        pinned: Option<bool>,
    ) -> CoreResult<()> {
        if byte_size < 0 {
            return Err(CoreError::from("cache byte size cannot be negative"));
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let page = connection
            .query_row(
                "SELECT publication_id, cache_path FROM pages WHERE id = ?1",
                [page_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or_else(|| CoreError::from("page does not exist"))?;
        let actual_size = cache_file_size(&self.cache_dir, Path::new(&page.1))?;
        if actual_size != byte_size {
            return Err(CoreError::from(
                "cache byte size does not match the derived file",
            ));
        }
        connection.execute(
            "INSERT INTO cache_entries
                (page_id, publication_id, cache_path, byte_size, last_accessed_at, pinned)
             VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, 0))
             ON CONFLICT(page_id) DO UPDATE SET
                publication_id = excluded.publication_id,
                cache_path = excluded.cache_path,
                byte_size = excluded.byte_size,
                last_accessed_at = excluded.last_accessed_at,
                pinned = COALESCE(?6, cache_entries.pinned)",
            params![
                page_id,
                page.0,
                page.1,
                actual_size,
                now(),
                pinned.map(i64::from)
            ],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn enforce_cache_limit(&self, protected_page_ids: &[String]) -> CoreResult<i64> {
        let protected = protected_page_ids
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let (mut used_bytes, max_bytes) = connection.query_row(
            "SELECT
                (SELECT COALESCE(SUM(byte_size), 0) FROM cache_entries),
                (SELECT max_bytes FROM cache_settings WHERE id = 'default')",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )?;
        if used_bytes <= max_bytes {
            return Ok(0);
        }
        let candidates = {
            let mut statement = connection.prepare(
                "SELECT page_id, publication_id, cache_path, byte_size
                   FROM cache_entries
                  WHERE pinned = 0
                  ORDER BY last_accessed_at ASC, page_id ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let origin_paths = {
            let mut statement =
                connection.prepare("SELECT source_ref FROM pages WHERE source_ref <> ''")?;
            let source_refs = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            source_refs
                .iter()
                .filter_map(|value| decode_source_ref(value))
                .filter_map(|source_ref| source_ref_path(&source_ref).canonicalize().ok())
                .collect::<HashSet<_>>()
        };
        let mut freed_bytes = 0_i64;
        for (page_id, publication_id, cache_path, recorded_size) in candidates {
            if used_bytes <= max_bytes {
                break;
            }
            if protected.contains(page_id.as_str()) {
                continue;
            }
            let renamed_cache = if let Some((validated_path, actual_size)) =
                validated_cache_file(&self.cache_dir, Path::new(&cache_path))?
            {
                if !origin_paths.contains(&validated_path) {
                    let eviction_path =
                        validated_path.with_file_name(format!(".{}.{}.evict", page_id, now()));
                    std::fs::rename(&validated_path, &eviction_path)?;
                    Some((validated_path, eviction_path, actual_size))
                } else {
                    None
                }
            } else {
                None
            };
            let database_update = (|| -> CoreResult<()> {
                let transaction = connection.transaction()?;
                transaction.execute("DELETE FROM cache_entries WHERE page_id = ?1", [&page_id])?;
                transaction
                    .execute("UPDATE pages SET cache_path = '' WHERE id = ?1", [&page_id])?;
                mark_publication_cache_missing(&transaction, &publication_id)?;
                transaction.commit()?;
                Ok(())
            })();
            if let Err(error) = database_update {
                if let Some((original, eviction, _)) = renamed_cache {
                    let _ = std::fs::rename(eviction, original);
                }
                return Err(error);
            }
            if let Some((_, eviction, actual_size)) = renamed_cache {
                std::fs::remove_file(eviction)?;
                freed_bytes = freed_bytes.saturating_add(actual_size);
            }
            used_bytes = used_bytes.saturating_sub(recorded_size.max(0));
        }
        Ok(freed_bytes)
    }

    #[allow(dead_code)]
    pub fn ensure_page_cache(&self, publication_id: &str, page_id: &str) -> CoreResult<NativePage> {
        self.ensure_page_cache_with_protected(publication_id, page_id, &[])
    }

    pub fn ensure_page_cache_with_protected(
        &self,
        publication_id: &str,
        page_id: &str,
        additional_protected_page_ids: &[String],
    ) -> CoreResult<NativePage> {
        let (mut page, format) = {
            let connection = self
                .connection
                .lock()
                .map_err(|_| CoreError::from("database lock poisoned"))?;
            connection
                .query_row(
                    "SELECT p.id, p.page_index, p.name, p.cache_path, p.source_ref,
                            p.width, p.height, publications.format
                       FROM pages p
                       JOIN publications ON publications.id = p.publication_id
                      WHERE p.publication_id = ?1 AND p.id = ?2",
                    params![publication_id, page_id],
                    |row| {
                        let source_ref = row.get::<_, String>(4)?;
                        Ok((
                            NativePage {
                                id: row.get(0)?,
                                index: row.get::<_, i64>(1)? as usize,
                                name: row.get(2)?,
                                cache_path: row.get(3)?,
                                source_ref: decode_source_ref(&source_ref),
                                width: row.get::<_, i64>(5)? as u32,
                                height: row.get::<_, i64>(6)? as u32,
                            },
                            row.get::<_, String>(7)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| CoreError::from("page does not belong to the publication"))?
        };
        let mut protected_page_ids = self.protected_page_ids(publication_id, page.index)?;
        for protected_page_id in additional_protected_page_ids {
            if !protected_page_ids.contains(protected_page_id) {
                protected_page_ids.push(protected_page_id.clone());
            }
        }
        if let Some((_, byte_size)) =
            validated_cache_file(&self.cache_dir, Path::new(&page.cache_path))?
        {
            self.record_page_cache(page_id, byte_size, None)?;
            self.enforce_cache_limit(&protected_page_ids)?;
            return Ok(page);
        }

        let source_ref = page.source_ref.as_ref().ok_or_else(|| {
            let _ =
                self.append_publication_diagnostic(publication_id, CACHE_UNREBUILDABLE_DIAGNOSTIC);
            CoreError::from(CACHE_UNREBUILDABLE_DIAGNOSTIC)
        })?;
        let rebuilt = crate::importer::rebuild_page(&format, source_ref)?;
        let publication_cache_dir = self.publication_cache_dir(publication_id)?;
        std::fs::create_dir_all(&publication_cache_dir)?;
        let cache_path = crate::importer::cache_page(
            &publication_cache_dir,
            page_id,
            &rebuilt.extension,
            &rebuilt.bytes,
        )?;
        let cache_path_string = cache_path
            .to_str()
            .ok_or_else(|| CoreError::from("cache path is not valid UTF-8"))?
            .to_owned();
        let database_update = (|| -> CoreResult<()> {
            let mut connection = self
                .connection
                .lock()
                .map_err(|_| CoreError::from("database lock poisoned"))?;
            let transaction = connection.transaction()?;
            transaction.execute(
                "UPDATE pages SET cache_path = ?1, width = ?2, height = ?3
                  WHERE publication_id = ?4 AND id = ?5",
                params![
                    cache_path_string,
                    rebuilt.width as i64,
                    rebuilt.height as i64,
                    publication_id,
                    page_id,
                ],
            )?;
            transaction.execute(
                "INSERT INTO cache_entries
                    (page_id, publication_id, cache_path, byte_size, last_accessed_at, pinned)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0)
                 ON CONFLICT(page_id) DO UPDATE SET
                    publication_id = excluded.publication_id,
                    cache_path = excluded.cache_path,
                    byte_size = excluded.byte_size,
                    last_accessed_at = excluded.last_accessed_at",
                params![
                    page_id,
                    publication_id,
                    cache_path_string,
                    i64::try_from(rebuilt.bytes.len()).map_err(|_| CoreError::from(
                        "derived page cache is too large to record"
                    ))?,
                    now(),
                ],
            )?;
            transaction.commit()?;
            Ok(())
        })();
        if let Err(error) = database_update {
            let _ = std::fs::remove_file(&cache_path);
            return Err(error);
        }
        cache_file_size(&self.cache_dir, &cache_path)?;
        self.enforce_cache_limit(&protected_page_ids)?;
        page.cache_path = cache_path_string;
        page.width = rebuilt.width;
        page.height = rebuilt.height;
        Ok(page)
    }

    #[allow(dead_code)]
    pub fn clear_cache(&self) -> CoreResult<()> {
        self.clear_cache_with_protected(&[])
    }

    pub fn clear_cache_with_protected(&self, protected_page_ids: &[String]) -> CoreResult<()> {
        let cache_root = self.cache_dir.canonicalize()?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let origin_paths = canonical_origin_paths(&connection)?;
        let protected = protected_page_ids.iter().cloned().collect::<HashSet<_>>();
        let protected_paths = {
            let mut statement = connection.prepare(
                "SELECT cache_path FROM cache_entries
                  WHERE page_id = ?1",
            )?;
            let mut paths = HashSet::new();
            for page_id in protected_page_ids {
                let cache_path = statement
                    .query_row([page_id], |row| row.get::<_, String>(0))
                    .optional()?;
                if let Some(cache_path) = cache_path {
                    if let Some((path, _)) =
                        validated_cache_file(&self.cache_dir, Path::new(&cache_path))?
                    {
                        paths.insert(path);
                    }
                }
            }
            paths
        };
        remove_derived_files_except(&cache_root, &cache_root, &origin_paths, &protected_paths)?;

        let entries = {
            let mut statement = connection.prepare(
                "SELECT page_id, publication_id
                   FROM cache_entries",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let affected_publications = entries
            .iter()
            .filter(|(page_id, _)| !protected.contains(page_id))
            .map(|(_, publication_id)| publication_id.clone())
            .collect::<HashSet<_>>();
        let transaction = connection.transaction()?;
        for (page_id, _) in entries {
            if protected.contains(&page_id) {
                continue;
            }
            transaction.execute("DELETE FROM cache_entries WHERE page_id = ?1", [&page_id])?;
            transaction.execute("UPDATE pages SET cache_path = '' WHERE id = ?1", [&page_id])?;
        }
        for publication_id in affected_publications {
            mark_publication_cache_missing(&transaction, &publication_id)?;
        }
        transaction.commit()?;
        remove_empty_directories(&cache_root)?;
        Ok(())
    }

    pub fn delete_publication(&self, publication_id: &str) -> CoreResult<()> {
        let cache_publication_dir = self.publication_cache_dir(publication_id)?;
        let cache_root = self.cache_dir.canonicalize()?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM publications WHERE id = ?1)",
            [publication_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(CoreError::from("publication does not exist"));
        }
        let origin_paths = canonical_origin_paths(&connection)?;

        // Stage derived files before changing SQLite. If any filesystem step
        // fails, the publication row and all dependent metadata remain intact.
        // Origins are deliberately skipped, including origins that happen to
        // be located inside the derived-cache tree.
        let staging_root = cache_root.join(format!(".{}.{}.delete", publication_id, now()));
        let mut staged_files = Vec::new();
        if cache_publication_dir.exists() {
            std::fs::create_dir_all(&staging_root)?;
            if let Err(error) = stage_derived_files(
                &cache_root,
                &cache_publication_dir,
                &origin_paths,
                &staging_root,
                &mut staged_files,
            ) {
                let restore_error = restore_staged_files(&staged_files).err();
                let _ = std::fs::remove_dir_all(&staging_root);
                if let Some(restore_error) = restore_error {
                    return Err(CoreError::from(format!(
                        "cache cleanup failed: {error}; cache rollback failed: {restore_error}"
                    )));
                }
                return Err(error);
            }

            // Remove only the now-empty derived directories before opening the
            // metadata transaction. The staged bytes must remain available
            // until the transaction commits so a database failure can restore
            // the complete cache state.
            if let Err(error) = remove_empty_directories(&cache_publication_dir) {
                let restore_error = restore_staged_files(&staged_files).err();
                let _ = std::fs::remove_dir_all(&staging_root);
                if let Some(restore_error) = restore_error {
                    return Err(CoreError::from(format!(
                        "cache cleanup failed: {error}; cache rollback failed: {restore_error}"
                    )));
                }
                return Err(error);
            }
        }

        let transaction_result = (|| -> CoreResult<()> {
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
            let deleted =
                transaction.execute("DELETE FROM publications WHERE id = ?1", [publication_id])?;
            if deleted != 1 {
                return Err(CoreError::from("publication disappeared during removal"));
            }
            transaction.commit()?;
            Ok(())
        })();
        if let Err(error) = transaction_result {
            let restore_error = restore_staged_files(&staged_files).err();
            let _ = std::fs::remove_dir_all(&staging_root);
            drop(connection);
            if let Some(restore_error) = restore_error {
                return Err(CoreError::from(format!(
                    "publication removal failed: {error}; cache rollback failed: {restore_error}"
                )));
            }
            return Err(error);
        }
        drop(connection);
        // The database commit is the point of no return. A leftover empty
        // tombstone is harmless and can be retried later, so cleanup failure
        // here must not report a failed deletion after metadata is gone.
        let _ = std::fs::remove_dir_all(&staging_root);
        let cache_publication_is_empty = cache_publication_dir
            .read_dir()
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);
        if cache_publication_is_empty {
            let _ = std::fs::remove_dir(&cache_publication_dir);
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
        let version = validate_profile_payload(profile)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
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

    #[allow(dead_code)]
    fn protected_page_ids(
        &self,
        publication_id: &str,
        page_index: usize,
    ) -> CoreResult<Vec<String>> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        let lower = page_index.saturating_sub(1) as i64;
        let upper = page_index.saturating_add(1) as i64;
        let mut statement = connection.prepare(
            "SELECT id FROM pages
              WHERE publication_id = ?1 AND page_index BETWEEN ?2 AND ?3",
        )?;
        let page_ids = statement
            .query_map(params![publication_id, lower, upper], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into);
        page_ids
    }

    #[allow(dead_code)]
    fn append_publication_diagnostic(
        &self,
        publication_id: &str,
        diagnostic: &str,
    ) -> CoreResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| CoreError::from("database lock poisoned"))?;
        connection.execute(
            "UPDATE publications
                SET diagnostic = CASE
                    WHEN diagnostic IS NULL OR diagnostic = '' THEN ?1
                    WHEN instr(diagnostic, ?1) > 0 THEN diagnostic
                    ELSE diagnostic || ' ' || ?1
                END
              WHERE id = ?2",
            params![diagnostic, publication_id],
        )?;
        Ok(())
    }

    fn read_publication(
        &self,
        connection: &Connection,
        row: PublicationRow,
    ) -> CoreResult<NativePublication> {
        let mut page_statement = connection.prepare(
            "SELECT id, page_index, name, cache_path, source_ref, width, height
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
                    source_ref: decode_source_ref(&page.get::<_, String>(4)?),
                    width: page.get::<_, i64>(5)? as u32,
                    height: page.get::<_, i64>(6)? as u32,
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
        let source_names = if row.format == "images" {
            pages.iter().map(|page| page.name.clone()).collect()
        } else {
            vec![row.source_label.clone()]
        };

        let custom_cover_path = row
            .custom_cover_cache
            .as_deref()
            .and_then(|path| self.valid_custom_cover_path(path));
        let mut diagnostic = row.diagnostic;
        if row.custom_cover_cache.is_some() && custom_cover_path.is_none() {
            diagnostic = Some(match diagnostic {
                Some(existing) if !existing.contains(CUSTOM_COVER_MISSING_DIAGNOSTIC) => {
                    format!("{existing} {CUSTOM_COVER_MISSING_DIAGNOSTIC}")
                }
                Some(existing) => existing,
                None => CUSTOM_COVER_MISSING_DIAGNOSTIC.to_owned(),
            });
        }
        let has_custom_cover_path = custom_cover_path.is_some();

        Ok(NativePublication {
            id: row.id,
            title: row.title,
            source_label: row.source_label,
            source_names,
            format: row.format,
            cover_page_id: row.cover_page_id,
            current_page: current_page.min(pages.len().saturating_sub(1)),
            progress,
            direction: row.direction,
            added_at: row.added_at,
            updated_at: row.updated_at,
            is_favorite: row.is_favorite,
            diagnostic,
            custom_cover_path,
            custom_cover_name: if has_custom_cover_path {
                row.custom_cover_name
            } else {
                None
            },
            pages,
        })
    }

    fn valid_custom_cover_path(&self, path: &str) -> Option<String> {
        let candidate = Path::new(path);
        let cache_root = self.cache_dir.canonicalize().ok()?;
        let canonical = candidate.canonicalize().ok()?;
        if !canonical.starts_with(cache_root) || !canonical.is_file() {
            return None;
        }
        canonical.to_str().map(str::to_owned)
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
    custom_cover_cache: Option<String>,
    custom_cover_name: Option<String>,
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

    if current_version < 3 {
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

    if current_version < 4 {
        backfill_deterministic_source_refs(&transaction)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?1)",
            params![now()],
        )?;
    }

    if current_version < MIGRATION_VERSION {
        for (column, definition) in [
            ("custom_cover_source", "TEXT"),
            ("custom_cover_cache", "TEXT"),
            ("custom_cover_name", "TEXT"),
        ] {
            if !column_exists(&transaction, "publications", column)? {
                transaction.execute(
                    &format!("ALTER TABLE publications ADD COLUMN {column} {definition}"),
                    [],
                )?;
            }
        }
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?1)",
            params![now()],
        )?;
    }

    transaction.commit()?;
    Ok(())
}

fn backfill_deterministic_source_refs(transaction: &rusqlite::Transaction<'_>) -> CoreResult<()> {
    if !column_exists(transaction, "publications", "format")?
        || !column_exists(transaction, "publications", "source_path")?
        || !column_exists(transaction, "pages", "page_index")?
        || !column_exists(transaction, "pages", "source_ref")?
    {
        return Ok(());
    }
    let rows = {
        let mut statement = transaction.prepare(
            "SELECT pages.id, publications.format, publications.source_path,
                    pages.page_index,
                    (SELECT COUNT(*) FROM pages siblings
                      WHERE siblings.publication_id = pages.publication_id)
               FROM pages
               JOIN publications ON publications.id = pages.publication_id
              WHERE pages.source_ref = ''",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    for (page_id, format, source_path, page_index, page_count) in rows {
        let source_ref = match format.as_str() {
            "pdf" => source_path
                .strip_prefix("pdf:")
                .map(|path| PageSourceRef::Pdf {
                    path: path.to_owned(),
                    page_index: page_index.max(0) as usize,
                }),
            "images" if page_count == 1 => {
                source_path
                    .strip_prefix("image:")
                    .map(|path| PageSourceRef::Image {
                        path: path.to_owned(),
                    })
            }
            _ => None,
        };
        if let Some(source_ref) = source_ref {
            transaction.execute(
                "UPDATE pages SET source_ref = ?1 WHERE id = ?2",
                params![serde_json::to_string(&source_ref)?, page_id],
            )?;
        }
    }
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

fn reconcile_cache_entries(connection: &mut Connection, cache_dir: &Path) -> CoreResult<()> {
    let pages = {
        let mut statement = connection.prepare(
            "SELECT id, publication_id, cache_path
               FROM pages",
        )?;
        let pages = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        pages
    };
    let transaction = connection.transaction()?;
    for (page_id, publication_id, cache_path) in pages {
        match cache_file_size_if_valid(cache_dir, Path::new(&cache_path))? {
            Some(byte_size) => {
                transaction.execute(
                    "INSERT INTO cache_entries
                        (page_id, publication_id, cache_path, byte_size, last_accessed_at, pinned)
                     VALUES (?1, ?2, ?3, ?4, ?5, 0)
                     ON CONFLICT(page_id) DO UPDATE SET
                         publication_id = excluded.publication_id,
                         cache_path = excluded.cache_path,
                         byte_size = excluded.byte_size",
                    params![page_id, publication_id, cache_path, byte_size, now()],
                )?;
            }
            None => {
                transaction.execute("DELETE FROM cache_entries WHERE page_id = ?1", [&page_id])?;
                transaction
                    .execute("UPDATE pages SET cache_path = '' WHERE id = ?1", [&page_id])?;
                mark_publication_cache_missing(&transaction, &publication_id)?;
            }
        }
    }
    transaction.commit()?;
    Ok(())
}

fn cache_file_size(cache_dir: &Path, cache_path: &Path) -> CoreResult<i64> {
    cache_file_size_if_valid(cache_dir, cache_path)?.ok_or_else(|| {
        CoreError::from("derived page cache is missing or outside the cache directory")
    })
}

fn cache_file_size_if_valid(cache_dir: &Path, cache_path: &Path) -> CoreResult<Option<i64>> {
    Ok(validated_cache_file(cache_dir, cache_path)?.map(|(_, byte_size)| byte_size))
}

fn validated_cache_file(cache_dir: &Path, cache_path: &Path) -> CoreResult<Option<(PathBuf, i64)>> {
    if cache_path.as_os_str().is_empty() || !cache_path.exists() {
        return Ok(None);
    }
    let cache_root = cache_dir.canonicalize()?;
    let canonical_path = cache_path.canonicalize()?;
    if !canonical_path.starts_with(cache_root) || !canonical_path.is_file() {
        return Ok(None);
    }
    let byte_size = i64::try_from(canonical_path.metadata()?.len())
        .map_err(|_| CoreError::from("derived page cache is too large to record"))?;
    Ok(Some((canonical_path, byte_size)))
}

fn decode_source_ref(value: &str) -> Option<PageSourceRef> {
    if value.is_empty() {
        None
    } else {
        serde_json::from_str(value).ok()
    }
}

#[allow(dead_code)]
fn source_ref_path(source_ref: &PageSourceRef) -> &Path {
    match source_ref {
        PageSourceRef::Image { path }
        | PageSourceRef::Archive { path, .. }
        | PageSourceRef::Pdf { path, .. } => Path::new(path),
    }
}

fn canonical_origin_paths(connection: &Connection) -> CoreResult<HashSet<PathBuf>> {
    let mut statement =
        connection.prepare("SELECT source_ref FROM pages WHERE source_ref <> ''")?;
    let source_refs = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut origin_paths = source_refs
        .iter()
        .filter_map(|value| decode_source_ref(value))
        .filter_map(|source_ref| source_ref_path(&source_ref).canonicalize().ok())
        .collect::<HashSet<_>>();
    let mut statement = connection.prepare("SELECT source_path FROM publications")?;
    let source_paths = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    origin_paths.extend(
        source_paths
            .iter()
            .filter_map(|source_path| legacy_origin_path(source_path))
            .filter_map(|path| path.canonicalize().ok()),
    );
    let mut statement = connection.prepare(
        "SELECT custom_cover_source FROM publications
          WHERE custom_cover_source IS NOT NULL AND custom_cover_source <> ''",
    )?;
    let custom_cover_sources = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    origin_paths.extend(
        custom_cover_sources
            .iter()
            .map(Path::new)
            .filter_map(|path| path.canonicalize().ok()),
    );
    Ok(origin_paths)
}

fn legacy_origin_path(source_path: &str) -> Option<&Path> {
    ["archive:", "cbr:", "pdf:", "image:"]
        .iter()
        .find_map(|prefix| source_path.strip_prefix(prefix).map(Path::new))
}

fn retry_eviction_tombstones(connection: &Connection, cache_dir: &Path) {
    let Ok(cache_root) = cache_dir.canonicalize() else {
        return;
    };
    let Ok(origin_paths) = canonical_origin_paths(connection) else {
        return;
    };
    remove_eviction_tombstones(&cache_root, &cache_root, &origin_paths);
}

fn retry_delete_tombstones(cache_dir: &Path) {
    let Ok(cache_root) = cache_dir.canonicalize() else {
        return;
    };
    remove_delete_tombstones(&cache_root, &cache_root);
}

fn remove_delete_tombstones(cache_root: &Path, directory: &Path) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let is_delete_tombstone = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with('.') && name.ends_with(".delete"));
        if is_delete_tombstone {
            if path
                .canonicalize()
                .is_ok_and(|canonical| canonical.starts_with(cache_root))
            {
                let _ = std::fs::remove_dir_all(path);
            }
            continue;
        }
        remove_delete_tombstones(cache_root, &path);
    }
}

fn remove_eviction_tombstones(
    cache_root: &Path,
    directory: &Path,
    origin_paths: &HashSet<PathBuf>,
) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            remove_eviction_tombstones(cache_root, &path, origin_paths);
            continue;
        }
        if !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with('.') && name.ends_with(".evict"))
        {
            continue;
        }
        let Ok(canonical) = path.canonicalize() else {
            continue;
        };
        if canonical.starts_with(cache_root) && !origin_paths.contains(&canonical) {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn remove_derived_files_except(
    cache_root: &Path,
    directory: &Path,
    origin_paths: &HashSet<PathBuf>,
    protected_paths: &HashSet<PathBuf>,
) -> CoreResult<()> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            remove_derived_files_except(cache_root, &path, origin_paths, protected_paths)?;
            if path.read_dir()?.next().is_none() {
                std::fs::remove_dir(path)?;
            }
        } else {
            let canonical = path.canonicalize()?;
            if canonical.starts_with(cache_root)
                && !origin_paths.contains(&canonical)
                && !protected_paths.contains(&canonical)
            {
                std::fs::remove_file(path)?;
            }
        }
    }
    Ok(())
}

fn validate_profile_payload(profile: &Value) -> CoreResult<i64> {
    let object = profile
        .as_object()
        .ok_or_else(|| CoreError::from("profile payload must be an object"))?;
    let version = object
        .get("version")
        .and_then(Value::as_i64)
        .ok_or_else(|| CoreError::from("profile payload version is required"))?;
    match version {
        1 => {
            validate_profile_object(object, false)?;
            Ok(1)
        }
        2 => {
            let active_id = object
                .get("activeProfileId")
                .and_then(Value::as_str)
                .filter(|value| is_valid_profile_id(value))
                .ok_or_else(|| CoreError::from("active profile id is invalid"))?;
            let profiles = object
                .get("profiles")
                .and_then(Value::as_array)
                .filter(|profiles| !profiles.is_empty())
                .ok_or_else(|| CoreError::from("profile store must contain a profile"))?;
            let mut ids = HashSet::new();
            for profile in profiles {
                let profile_object = profile
                    .as_object()
                    .ok_or_else(|| CoreError::from("profile must be an object"))?;
                validate_profile_object(profile_object, true)?;
                let id = profile_object
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| CoreError::from("profile id is required"))?;
                if !ids.insert(id.to_owned()) {
                    return Err(CoreError::from("profile ids must be unique"));
                }
            }
            if !ids.contains(active_id) {
                return Err(CoreError::from("active profile must exist"));
            }
            Ok(2)
        }
        _ => Err(CoreError::from("profile payload version is not supported")),
    }
}

fn validate_profile_object(
    profile: &serde_json::Map<String, Value>,
    require_zoom: bool,
) -> CoreResult<()> {
    if profile.get("version").and_then(Value::as_i64) != Some(1) {
        return Err(CoreError::from("profile version is not supported"));
    }
    if require_zoom {
        let id = profile
            .get("id")
            .and_then(Value::as_str)
            .filter(|value| is_valid_profile_id(value))
            .ok_or_else(|| CoreError::from("profile id is invalid"))?;
        if id.is_empty() {
            return Err(CoreError::from("profile id is invalid"));
        }
    }
    let name = profile
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().count() <= 80)
        .ok_or_else(|| CoreError::from("profile name is invalid"))?;
    if name.is_empty() {
        return Err(CoreError::from("profile name is invalid"));
    }
    validate_enum(profile, "mode", &["single", "spread"])?;
    validate_enum(profile, "direction", &["ltr", "rtl"])?;
    validate_enum(profile, "contrast", &["standard", "high"])?;
    validate_enum(profile, "layoutZone", &["top", "bottom", "left", "right"])?;
    if require_zoom || profile.contains_key("zoomMode") {
        validate_enum(profile, "zoomMode", &["page", "width", "manual"])?;
    }
    if profile
        .get("reducedMotion")
        .and_then(Value::as_bool)
        .is_none()
    {
        return Err(CoreError::from("reduced motion must be boolean"));
    }
    let duration = profile
        .get("pageTurnDuration")
        .and_then(Value::as_i64)
        .filter(|value| (120..=1200).contains(value))
        .ok_or_else(|| CoreError::from("turn duration is invalid"))?;
    let _ = duration;
    if require_zoom || profile.contains_key("zoomScale") {
        let scale = profile
            .get("zoomScale")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && (0.5..=3.0).contains(value))
            .ok_or_else(|| CoreError::from("zoom scale is invalid"))?;
        let _ = scale;
    }
    let bindings = profile
        .get("bindings")
        .and_then(Value::as_object)
        .ok_or_else(|| CoreError::from("bindings must be an object"))?;
    for action in [
        "next_page",
        "previous_page",
        "toggle_library",
        "toggle_fullscreen",
        "toggle_settings",
        "toggle_spread",
        "toggle_navigator",
        "toggle_bookmark",
        "cancel",
    ] {
        if bindings.get(action).is_none()
            && matches!(action, "toggle_navigator" | "toggle_bookmark")
        {
            continue;
        }
        let valid = bindings
            .get(action)
            .and_then(Value::as_array)
            .map(|codes| {
                codes.len() <= 2
                    && codes.iter().all(|code| {
                        code.as_str()
                            .map(|value| !value.is_empty() && value.chars().count() <= 64)
                            .unwrap_or(false)
                    })
            })
            .unwrap_or(false);
        if !valid {
            return Err(CoreError::from("bindings contain an invalid action"));
        }
    }
    Ok(())
}

fn validate_enum(
    profile: &serde_json::Map<String, Value>,
    field: &str,
    allowed: &[&str],
) -> CoreResult<()> {
    let value = profile
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| CoreError::from(format!("{field} is required")))?;
    if !allowed.contains(&value) {
        return Err(CoreError::from(format!("{field} is invalid")));
    }
    Ok(())
}

fn is_valid_profile_id(value: &str) -> bool {
    value.len() >= 2
        && value.len() <= 80
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn stage_derived_files(
    cache_root: &Path,
    directory: &Path,
    origin_paths: &HashSet<PathBuf>,
    staging_root: &Path,
    staged_files: &mut Vec<(PathBuf, PathBuf)>,
) -> CoreResult<()> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            stage_derived_files(cache_root, &path, origin_paths, staging_root, staged_files)?;
            continue;
        }

        let canonical = path.canonicalize()?;
        if !canonical.starts_with(cache_root) || origin_paths.contains(&canonical) {
            continue;
        }

        let relative = canonical
            .strip_prefix(cache_root)
            .map_err(|_| CoreError::from("derived cache path escaped its root"))?;
        let staged_path = staging_root.join(relative);
        if let Some(parent) = staged_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(&path, &staged_path)?;
        staged_files.push((path, staged_path));
    }
    Ok(())
}

fn restore_staged_files(staged_files: &[(PathBuf, PathBuf)]) -> CoreResult<()> {
    for (original, staged) in staged_files.iter().rev() {
        if !staged.exists() {
            continue;
        }
        if let Some(parent) = original.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(staged, original)?;
    }
    Ok(())
}

fn remove_empty_directories(directory: &Path) -> CoreResult<()> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            remove_empty_directories(&path)?;
            if path.read_dir()?.next().is_none() {
                std::fs::remove_dir(path)?;
            }
        }
    }
    Ok(())
}

fn mark_publication_cache_missing(
    transaction: &rusqlite::Transaction<'_>,
    publication_id: &str,
) -> CoreResult<()> {
    transaction.execute(
        "UPDATE publications
            SET diagnostic = CASE
                WHEN diagnostic IS NULL OR diagnostic = '' THEN ?1
                WHEN instr(diagnostic, ?1) > 0 THEN diagnostic
                ELSE diagnostic || ' ' || ?1
            END
          WHERE id = ?2",
        params![CACHE_MISSING_DIAGNOSTIC, publication_id],
    )?;
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
    use crate::models::{NativeBookmark, NativeReaderState, NewPage, PageSourceRef};

    const TWO_GIB: i64 = 2 * 1024 * 1024 * 1024;

    fn temporary_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("tactile-reader-{label}-{}", now()))
    }

    fn insert_test_publication(database: &LibraryDb, source_path: &str) {
        insert_test_publication_with_ids(database, "publication-1", "page-1", source_path);
    }

    fn insert_test_publication_with_ids(
        database: &LibraryDb,
        publication_id: &str,
        page_id: &str,
        source_path: &str,
    ) {
        let cache_path = database
            .cache_dir()
            .join(publication_id)
            .join(format!("{page_id}.png"));
        std::fs::create_dir_all(cache_path.parent().expect("cache parent"))
            .expect("cache directory");
        std::fs::write(&cache_path, b"derived page").expect("cache page");
        database
            .insert_publication(&NewPublication {
                id: publication_id.to_owned(),
                title: "Test publication".to_owned(),
                source_label: "Test source".to_owned(),
                source_path: source_path.to_owned(),
                format: "images".to_owned(),
                pages: vec![NewPage {
                    id: page_id.to_owned(),
                    index: 0,
                    name: format!("{page_id}.png"),
                    cache_path,
                    source_ref: PageSourceRef::Image {
                        path: source_path.to_owned(),
                    },
                    width: 1,
                    height: 1,
                }],
                cover_page_id: page_id.to_owned(),
                current_page: 0,
                direction: "ltr".to_owned(),
                added_at: "0".to_owned(),
                updated_at: "0".to_owned(),
                diagnostic: None,
            })
            .expect("insert publication");
    }

    fn write_test_png(path: &Path) {
        use std::io::Cursor;

        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(3, 4)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .expect("encode png");
        std::fs::write(path, bytes.into_inner()).expect("write png");
    }

    #[test]
    fn custom_cover_round_trip_preserves_original_and_cleans_derived_data() {
        let root = temporary_root("custom-cover");
        std::fs::create_dir_all(&root).expect("root");
        let publication_source = root.join("publication.cbz");
        let cover_source = root.join("replacement.png");
        let original_bytes = b"original publication";
        std::fs::write(&publication_source, original_bytes).expect("publication source");
        write_test_png(&cover_source);
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication(&database, &publication_source.to_string_lossy());

        database
            .set_custom_cover("publication-1", &cover_source.to_string_lossy())
            .expect("set custom cover");
        let publication = database
            .list_publications()
            .expect("publications")
            .remove(0);
        assert_eq!(publication.custom_cover_name.as_deref(), Some("replacement.png"));
        assert!(publication
            .custom_cover_path
            .as_deref()
            .is_some_and(|path| Path::new(path).exists()));
        assert_eq!(std::fs::read(&publication_source).expect("source bytes"), original_bytes);

        database
            .clear_custom_cover("publication-1")
            .expect("clear custom cover");
        let cleared = database
            .list_publications()
            .expect("publications")
            .remove(0);
        assert!(cleared.custom_cover_path.is_none());
        assert!(cleared.custom_cover_name.is_none());
        assert!(cover_source.exists());

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
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
    fn profile_ipc_payload_validates_named_profile_schema() {
        let root = temporary_root("profile-validation");
        let database = LibraryDb::open(root.clone()).expect("database");
        let valid = serde_json::json!({
            "version": 2,
            "activeProfileId": "paper-atelier",
            "profiles": [{
                "id": "paper-atelier",
                "version": 1,
                "name": "Paper Atelier",
                "mode": "single",
                "direction": "ltr",
                "contrast": "standard",
                "reducedMotion": false,
                "pageTurnDuration": 420,
                "layoutZone": "top",
                "zoomMode": "page",
                "zoomScale": 1.0,
                "bindings": {
                    "next_page": ["ArrowRight"],
                    "previous_page": ["ArrowLeft"],
                    "toggle_library": ["KeyL"],
                    "toggle_fullscreen": ["KeyF"],
                    "toggle_settings": ["KeyS"],
                    "toggle_spread": ["KeyM"],
                    "cancel": ["Escape"]
                }
            }]
        });
        database.save_profile(&valid).expect("valid profile");
        assert_eq!(
            database.load_profile().expect("load profile"),
            Some(valid.clone())
        );

        for (field, value) in [
            ("direction", "diagonal"),
            ("zoomMode", "warp"),
            ("layoutZone", "center"),
        ] {
            let mut invalid = valid.clone();
            invalid["profiles"][0][field] = serde_json::json!(value);
            assert!(
                database.save_profile(&invalid).is_err(),
                "{field} should be rejected"
            );
        }
        assert_eq!(
            database.load_profile().expect("load after rejected writes"),
            Some(valid)
        );
        drop(database);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_profile_payload_survives_native_restart_for_frontend_migration() {
        let root = temporary_root("profile-restart");
        let legacy = serde_json::json!({
            "version": 1,
            "name": "Archive mode",
            "mode": "spread",
            "direction": "rtl",
            "contrast": "high",
            "reducedMotion": true,
            "pageTurnDuration": 720,
            "layoutZone": "bottom",
            "bindings": {
                "next_page": ["KeyN"],
                "previous_page": ["KeyP"],
                "toggle_library": ["KeyL"],
                "toggle_fullscreen": ["KeyF"],
                "toggle_settings": ["KeyS"],
                "toggle_spread": ["KeyM"],
                "cancel": ["Escape"]
            }
        });
        let database = LibraryDb::open(root.clone()).expect("database");
        database.save_profile(&legacy).expect("legacy profile");
        assert_eq!(
            database.load_profile().expect("load legacy"),
            Some(legacy.clone())
        );
        drop(database);

        let reopened = LibraryDb::open(root.clone()).expect("reopen database");
        assert_eq!(
            reopened.load_profile().expect("load after restart"),
            Some(legacy)
        );
        drop(reopened);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn named_profile_store_round_trips_across_native_restart() {
        let root = temporary_root("named-profile-restart");
        let store = serde_json::json!({
            "version": 2,
            "activeProfileId": "night-study",
            "profiles": [
                {
                    "id": "paper-atelier",
                    "version": 1,
                    "name": "Paper Atelier",
                    "mode": "single",
                    "direction": "ltr",
                    "contrast": "standard",
                    "reducedMotion": false,
                    "pageTurnDuration": 420,
                    "layoutZone": "top",
                    "zoomMode": "page",
                    "zoomScale": 1.0,
                    "bindings": {
                        "next_page": ["ArrowRight"],
                        "previous_page": ["ArrowLeft"],
                        "toggle_library": ["KeyL"],
                        "toggle_fullscreen": ["KeyF"],
                        "toggle_settings": ["KeyS"],
                        "toggle_spread": ["KeyM"],
                        "cancel": ["Escape"]
                    }
                },
                {
                    "id": "night-study",
                    "version": 1,
                    "name": "Night Study",
                    "mode": "spread",
                    "direction": "rtl",
                    "contrast": "high",
                    "reducedMotion": true,
                    "pageTurnDuration": 720,
                    "layoutZone": "bottom",
                    "zoomMode": "manual",
                    "zoomScale": 1.5,
                    "bindings": {
                        "next_page": ["KeyN"],
                        "previous_page": ["KeyP"],
                        "toggle_library": ["KeyL"],
                        "toggle_fullscreen": ["KeyF"],
                        "toggle_settings": ["KeyS"],
                        "toggle_spread": ["KeyM"],
                        "cancel": ["Escape"]
                    }
                }
            ]
        });
        let database = LibraryDb::open(root.clone()).expect("database");
        database.save_profile(&store).expect("named profile store");
        drop(database);

        let reopened = LibraryDb::open(root.clone()).expect("reopen database");
        assert_eq!(
            reopened.load_profile().expect("load named profiles"),
            Some(store)
        );
        drop(reopened);
        let _ = std::fs::remove_dir_all(root);
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
    fn bookmark_page_must_belong_to_its_publication() {
        let root = temporary_root("bookmark-ownership");
        std::fs::create_dir_all(&root).expect("root");
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication_with_ids(
            &database,
            "publication-1",
            "page-1",
            &root.join("source-1.cbz").to_string_lossy(),
        );
        insert_test_publication_with_ids(
            &database,
            "publication-2",
            "page-2",
            &root.join("source-2.cbz").to_string_lossy(),
        );

        let result = database.upsert_bookmark(
            "publication-1",
            &NativeBookmark {
                page_id: "page-2".to_owned(),
                label: "Wrong publication".to_owned(),
                created_at: "1".to_owned(),
                updated_at: "1".to_owned(),
            },
        );

        assert!(result.is_err());
        assert!(database
            .list_bookmarks("publication-1")
            .expect("bookmarks")
            .is_empty());

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
        let cleared_publication = database
            .find_by_source_path(&source_path.to_string_lossy())
            .expect("deduplicated publication lookup")
            .expect("existing publication");
        assert_eq!(cleared_publication.pages[0].cache_path, "");
        assert!(cleared_publication
            .diagnostic
            .as_deref()
            .expect("cache diagnostic")
            .contains("cache"));

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn opening_database_reconciles_missing_cache_entries_from_existing_files() {
        let root = temporary_root("cache-reconcile");
        let source_path = root.join("source.cbz");
        std::fs::create_dir_all(&root).expect("root");
        std::fs::write(&source_path, b"original source").expect("source");
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication(&database, &source_path.to_string_lossy());
        let expected_bytes = std::fs::metadata(
            database
                .cache_dir()
                .join("publication-1")
                .join("page-1.png"),
        )
        .expect("cache metadata")
        .len() as i64;
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute("DELETE FROM cache_entries", [])
            .expect("simulate pre-v3 cache metadata");
        drop(connection);
        drop(database);

        let reopened = LibraryDb::open(root.clone()).expect("reopen database");

        assert_eq!(
            reopened.cache_info().expect("reconciled cache info"),
            CacheInfo {
                used_bytes: expected_bytes,
                max_bytes: TWO_GIB,
                entry_count: 1,
            }
        );

        drop(reopened);
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
    fn setting_a_lower_cache_limit_evicts_unprotected_entries_immediately() {
        let root = temporary_root("cache-limit-enforcement");
        std::fs::create_dir_all(&root).expect("root");
        let database = LibraryDb::open(root.clone()).expect("database");
        let source_path = root.join("source.png");
        std::fs::write(&source_path, b"source").expect("source");
        let publication_cache = database.cache_dir().join("publication-limit");
        std::fs::create_dir_all(&publication_cache).expect("cache directory");
        let pages = ["page-limit-a", "page-limit-b"]
            .iter()
            .enumerate()
            .map(|(index, page_id)| {
                let cache_path = publication_cache.join(format!("{page_id}.png"));
                std::fs::write(&cache_path, [index as u8; 4]).expect("cache page");
                NewPage {
                    id: (*page_id).to_owned(),
                    index,
                    name: format!("{page_id}.png"),
                    cache_path,
                    source_ref: PageSourceRef::Image {
                        path: source_path.to_string_lossy().into_owned(),
                    },
                    width: 1,
                    height: 1,
                }
            })
            .collect::<Vec<_>>();
        database
            .insert_publication(&NewPublication {
                id: "publication-limit".to_owned(),
                title: "Limit".to_owned(),
                source_label: "source".to_owned(),
                source_path: source_path.to_string_lossy().into_owned(),
                format: "images".to_owned(),
                pages,
                cover_page_id: "page-limit-a".to_owned(),
                current_page: 0,
                direction: "ltr".to_owned(),
                added_at: "0".to_owned(),
                updated_at: "0".to_owned(),
                diagnostic: None,
            })
            .expect("publication");

        database.set_cache_limit(1).expect("set cache limit");

        assert_eq!(database.cache_info().expect("cache info").max_bytes, 1);
        assert!(database.cache_info().expect("cache info").used_bytes <= 1);
        assert_eq!(database.cache_info().expect("cache info").entry_count, 0);
        assert!(!publication_cache.join("page-limit-a.png").exists());
        assert!(!publication_cache.join("page-limit-b.png").exists());

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
    fn deleting_publication_preserves_origin_inside_its_cache_tree() {
        let root = temporary_root("delete-origin-in-cache");
        let database = LibraryDb::open(root.clone()).expect("database");
        let publication_cache = database.cache_dir().join("publication-1");
        std::fs::create_dir_all(&publication_cache).expect("publication cache");
        let source_path = publication_cache.join("original.png");
        let source_bytes = b"origin must never be deleted";
        std::fs::write(&source_path, source_bytes).expect("origin");
        insert_test_publication(&database, &source_path.to_string_lossy());

        database
            .delete_publication("publication-1")
            .expect("delete publication");

        assert_eq!(
            std::fs::read(&source_path).expect("origin remains"),
            source_bytes
        );
        assert!(database
            .list_publications()
            .expect("publications")
            .is_empty());

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn deleting_legacy_publication_preserves_source_path_origin_inside_cache() {
        let root = temporary_root("delete-legacy-origin-in-cache");
        let database = LibraryDb::open(root.clone()).expect("database");
        let publication_cache = database.cache_dir().join("publication-1");
        std::fs::create_dir_all(&publication_cache).expect("publication cache");
        let source_path = publication_cache.join("original.cbz");
        let source_bytes = b"legacy origin must never be deleted";
        std::fs::write(&source_path, source_bytes).expect("origin");
        insert_test_publication(&database, &source_path.to_string_lossy());
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "UPDATE publications SET format = 'cbz', source_path = ?1 WHERE id = 'publication-1'",
                [format!("archive:{}", source_path.display())],
            )
            .expect("legacy publication source");
        connection
            .execute(
                "UPDATE pages SET source_ref = '' WHERE publication_id = 'publication-1'",
                [],
            )
            .expect("legacy pages");
        drop(connection);

        database
            .delete_publication("publication-1")
            .expect("delete publication");

        assert_eq!(
            std::fs::read(&source_path).expect("legacy origin remains"),
            source_bytes
        );

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn failed_cache_cleanup_keeps_publication_metadata_and_source_intact() {
        let root = temporary_root("delete-cache-failure");
        let source_path = root.join("external-source.cbz");
        let source_bytes = b"source must survive a failed removal";
        std::fs::create_dir_all(&root).expect("root");
        std::fs::write(&source_path, source_bytes).expect("source");
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication(&database, &source_path.to_string_lossy());

        let cache_path = database.cache_dir().join("publication-1");
        std::fs::remove_dir_all(&cache_path).expect("remove cache directory");
        std::fs::write(&cache_path, b"cache path is not a directory").expect("blocking cache path");

        let result = database.delete_publication("publication-1");

        assert!(result.is_err(), "invalid cache path must fail removal");
        assert_eq!(database.list_publications().expect("publications").len(), 1);
        assert_eq!(
            std::fs::read(&source_path).expect("source remains"),
            source_bytes
        );
        assert!(
            cache_path.is_file(),
            "failed cleanup must leave the cache path intact"
        );

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn failed_metadata_transaction_restores_staged_cache_and_metadata() {
        let root = temporary_root("delete-db-failure");
        let source_path = root.join("external-source.cbz");
        let source_bytes = b"source must survive a failed transaction";
        std::fs::create_dir_all(&root).expect("root");
        std::fs::write(&source_path, source_bytes).expect("source");
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication(&database, &source_path.to_string_lossy());
        let cache_path = database
            .cache_dir()
            .join("publication-1")
            .join("page-1.png");
        let cache_bytes = std::fs::read(&cache_path).expect("cache bytes");
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute_batch(
                "CREATE TRIGGER block_publication_delete
                 BEFORE DELETE ON publications
                 BEGIN SELECT RAISE(ABORT, 'blocked by test'); END;",
            )
            .expect("delete trigger");
        drop(connection);

        let result = database.delete_publication("publication-1");

        assert!(result.is_err());
        assert_eq!(database.list_publications().expect("publications").len(), 1);
        assert_eq!(
            std::fs::read(&cache_path).expect("restored cache"),
            cache_bytes
        );
        assert_eq!(
            std::fs::read(&source_path).expect("source remains"),
            source_bytes
        );

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn deleting_publication_preserves_another_publications_origin_inside_its_cache_tree() {
        let root = temporary_root("delete-cross-publication-origin");
        let database = LibraryDb::open(root.clone()).expect("database");
        let first_source = root.join("first-source.png");
        std::fs::write(&first_source, b"first source").expect("first source");
        insert_test_publication_with_ids(
            &database,
            "publication-1",
            "page-1",
            &first_source.to_string_lossy(),
        );
        let second_source = database
            .cache_dir()
            .join("publication-1")
            .join("second-source.png");
        let second_bytes = b"second publication origin";
        std::fs::write(&second_source, second_bytes).expect("second source");
        insert_test_publication_with_ids(
            &database,
            "publication-2",
            "page-2",
            &second_source.to_string_lossy(),
        );

        database
            .delete_publication("publication-1")
            .expect("delete first publication");

        assert_eq!(
            std::fs::read(&second_source).expect("second origin remains"),
            second_bytes
        );
        assert_eq!(database.list_publications().expect("publications").len(), 1);

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

    #[test]
    fn enforce_cache_limit_evicts_lru_and_preserves_protected_pages() {
        let root = temporary_root("cache-lru");
        std::fs::create_dir_all(&root).expect("root");
        let database = LibraryDb::open(root.clone()).expect("database");
        let source_path = root.join("source.png");
        std::fs::write(&source_path, b"source").expect("source");
        let publication_id = "publication-lru";
        let publication_cache = database.cache_dir().join(publication_id);
        std::fs::create_dir_all(&publication_cache).expect("cache directory");
        let mut pages = Vec::new();
        for (index, page_id) in ["page-old", "page-protected", "page-new"]
            .iter()
            .enumerate()
        {
            let cache_path = publication_cache.join(format!("{page_id}.png"));
            std::fs::write(&cache_path, [index as u8; 4]).expect("cache page");
            pages.push(NewPage {
                id: (*page_id).to_owned(),
                index,
                name: format!("{page_id}.png"),
                cache_path,
                source_ref: PageSourceRef::Image {
                    path: source_path.to_string_lossy().into_owned(),
                },
                width: 1,
                height: 1,
            });
        }
        database
            .insert_publication(&NewPublication {
                id: publication_id.to_owned(),
                title: "LRU".to_owned(),
                source_label: "source".to_owned(),
                source_path: source_path.to_string_lossy().into_owned(),
                format: "images".to_owned(),
                pages,
                cover_page_id: "page-old".to_owned(),
                current_page: 0,
                direction: "ltr".to_owned(),
                added_at: "0".to_owned(),
                updated_at: "0".to_owned(),
                diagnostic: None,
            })
            .expect("publication");
        let connection = database.connection.lock().expect("database lock");
        for (page_id, accessed_at) in [
            ("page-old", "1"),
            ("page-protected", "2"),
            ("page-new", "3"),
        ] {
            connection
                .execute(
                    "UPDATE cache_entries SET last_accessed_at = ?1 WHERE page_id = ?2",
                    params![accessed_at, page_id],
                )
                .expect("access order");
        }
        drop(connection);
        // Keep the cache over the eventual limit so this test can exercise
        // `enforce_cache_limit`'s protected-page behavior explicitly. The
        // public setter enforces immediately by design.
        database.set_cache_limit(12).expect("cache limit");
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "UPDATE cache_settings SET max_bytes = 8 WHERE id = 'default'",
                [],
            )
            .expect("lower cache setting for enforcement test");
        drop(connection);

        let freed = database
            .enforce_cache_limit(&["page-protected".to_owned()])
            .expect("enforce cache limit");

        assert_eq!(freed, 4);
        assert!(!publication_cache.join("page-old.png").exists());
        assert!(publication_cache.join("page-protected.png").exists());
        assert!(publication_cache.join("page-new.png").exists());
        assert_eq!(database.cache_info().expect("cache info").used_bytes, 8);

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn cache_limit_and_clear_keep_the_active_working_set() {
        let root = temporary_root("cache-working-set");
        std::fs::create_dir_all(&root).expect("root");
        let source_path = root.join("source.png");
        std::fs::write(&source_path, b"source").expect("source");
        let database = LibraryDb::open(root.clone()).expect("database");
        let publication_id = "publication-working-set";
        let publication_cache = database.cache_dir().join(publication_id);
        std::fs::create_dir_all(&publication_cache).expect("cache directory");
        let pages = ["page-current", "page-adjacent", "page-old"]
            .iter()
            .enumerate()
            .map(|(index, page_id)| {
                let cache_path = publication_cache.join(format!("{}.png", page_id));
                std::fs::write(&cache_path, [index as u8; 4]).expect("cache page");
                NewPage {
                    id: (*page_id).to_owned(),
                    index,
                    name: format!("{}.png", page_id),
                    cache_path,
                    source_ref: PageSourceRef::Image {
                        path: source_path.to_string_lossy().into_owned(),
                    },
                    width: 1,
                    height: 1,
                }
            })
            .collect::<Vec<_>>();
        database
            .insert_publication(&NewPublication {
                id: publication_id.to_owned(),
                title: "Working set".to_owned(),
                source_label: "source".to_owned(),
                source_path: source_path.to_string_lossy().into_owned(),
                format: "images".to_owned(),
                pages,
                cover_page_id: "page-current".to_owned(),
                current_page: 0,
                direction: "ltr".to_owned(),
                added_at: "0".to_owned(),
                updated_at: "0".to_owned(),
                diagnostic: None,
            })
            .expect("publication");

        let protected = vec!["page-current".to_owned(), "page-adjacent".to_owned()];
        database
            .set_cache_limit_with_protected(8, &protected)
            .expect("protected cache limit");

        assert!(publication_cache.join("page-current.png").exists());
        assert!(publication_cache.join("page-adjacent.png").exists());
        assert!(!publication_cache.join("page-old.png").exists());

        database
            .clear_cache_with_protected(&protected)
            .expect("protected clear cache");

        assert!(publication_cache.join("page-current.png").exists());
        assert!(publication_cache.join("page-adjacent.png").exists());
        assert!(!publication_cache.join("page-old.png").exists());
        assert_eq!(database.cache_info().expect("cache info").entry_count, 2);

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn cache_hit_preserves_an_existing_pin() {
        let root = temporary_root("cache-pin-hit");
        std::fs::create_dir_all(&root).expect("root");
        let source_path = root.join("source.png");
        std::fs::write(&source_path, b"source").expect("source");
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication(&database, &source_path.to_string_lossy());
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "UPDATE cache_entries SET pinned = 1 WHERE page_id = 'page-1'",
                [],
            )
            .expect("pin page");
        drop(connection);

        database
            .ensure_page_cache("publication-1", "page-1")
            .expect("cache hit");

        let connection = database.connection.lock().expect("database lock");
        let pinned: i64 = connection
            .query_row(
                "SELECT pinned FROM cache_entries WHERE page_id = 'page-1'",
                [],
                |row| row.get(0),
            )
            .expect("pin state");
        assert_eq!(pinned, 1);
        drop(connection);

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn touch_page_cache_updates_recency_without_permanent_pin() {
        let root = temporary_root("cache-touch-evictable");
        std::fs::create_dir_all(&root).expect("root");
        let source_path = root.join("source.png");
        std::fs::write(&source_path, b"source").expect("source");
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication(&database, &source_path.to_string_lossy());
        let cached_page = database
            .cache_dir()
            .join("publication-1")
            .join("page-1.png");

        database
            .touch_page_cache_for_publication("publication-1", &["page-1".to_owned()])
            .expect("touch page");

        let connection = database.connection.lock().expect("database lock");
        let pinned: i64 = connection
            .query_row(
                "SELECT pinned FROM cache_entries WHERE page_id = 'page-1'",
                [],
                |row| row.get(0),
            )
            .expect("pin state");
        assert_eq!(pinned, 0);
        drop(connection);

        database.set_cache_limit(1).expect("evict touched page");
        assert!(!cached_page.exists());

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn opening_database_retries_removal_of_eviction_tombstones() {
        let root = temporary_root("cache-eviction-retry");
        let database = LibraryDb::open(root.clone()).expect("database");
        let publication_cache = database.cache_dir().join("publication-1");
        std::fs::create_dir_all(&publication_cache).expect("publication cache");
        let tombstone = publication_cache.join(".page-1.123.evict");
        std::fs::write(&tombstone, b"evicted derived bytes").expect("tombstone");
        drop(database);

        let reopened = LibraryDb::open(root.clone()).expect("reopen database");

        assert!(!tombstone.exists());
        drop(reopened);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn opening_database_retries_removal_of_publication_delete_tombstones() {
        let root = temporary_root("cache-delete-retry");
        let database = LibraryDb::open(root.clone()).expect("database");
        let tombstone = database.cache_dir().join(".publication-1.123.delete");
        std::fs::create_dir_all(&tombstone).expect("delete tombstone");
        std::fs::write(tombstone.join("page-1.png"), b"staged derived bytes")
            .expect("staged bytes");
        drop(database);

        let reopened = LibraryDb::open(root.clone()).expect("reopen database");

        assert!(!tombstone.exists());
        drop(reopened);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[cfg(windows)]
    #[test]
    fn locked_eviction_tombstone_does_not_prevent_database_open() {
        use std::os::windows::fs::OpenOptionsExt;

        let root = temporary_root("cache-eviction-locked");
        let database = LibraryDb::open(root.clone()).expect("database");
        let publication_cache = database.cache_dir().join("publication-1");
        std::fs::create_dir_all(&publication_cache).expect("publication cache");
        let tombstone = publication_cache.join(".page-1.123.evict");
        std::fs::write(&tombstone, b"locked tombstone").expect("tombstone");
        drop(database);
        let locked = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&tombstone)
            .expect("lock tombstone");

        let reopened = LibraryDb::open(root.clone()).expect("open despite locked tombstone");

        assert!(tombstone.exists());
        drop(reopened);
        drop(locked);
        let reopened = LibraryDb::open(root.clone()).expect("retry after unlock");
        assert!(!tombstone.exists());
        drop(reopened);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn cache_eviction_never_removes_a_path_outside_the_cache_directory() {
        let root = temporary_root("cache-path-guard");
        std::fs::create_dir_all(&root).expect("root");
        let source_path = root.join("source.png");
        let source_bytes = b"source bytes must survive";
        std::fs::write(&source_path, source_bytes).expect("source");
        let database = LibraryDb::open(root.join("app")).expect("database");
        insert_test_publication(&database, &source_path.to_string_lossy());
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "UPDATE cache_entries SET cache_path = ?1, byte_size = 999 WHERE page_id = 'page-1'",
                [source_path.to_string_lossy().as_ref()],
            )
            .expect("poison cache path");
        drop(connection);
        database.set_cache_limit(1).expect("cache limit");

        let freed = database
            .enforce_cache_limit(&[])
            .expect("safe cache enforcement");

        assert_eq!(freed, 0);
        assert_eq!(
            std::fs::read(&source_path).expect("source remains"),
            source_bytes
        );
        assert_eq!(database.cache_info().expect("cache info").used_bytes, 0);

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn cache_eviction_never_removes_an_origin_stored_under_the_cache_root() {
        let root = temporary_root("cache-origin-guard");
        let database = LibraryDb::open(root.join("app")).expect("database");
        let source_path = database.cache_dir().join("source.png");
        let source_bytes = b"origin inside cache must survive";
        std::fs::write(&source_path, source_bytes).expect("source");
        insert_test_publication(&database, &source_path.to_string_lossy());
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "UPDATE cache_entries SET cache_path = ?1, byte_size = 999 WHERE page_id = 'page-1'",
                [source_path.to_string_lossy().as_ref()],
            )
            .expect("poison cache path");
        drop(connection);
        database.set_cache_limit(1).expect("cache limit");

        let freed = database
            .enforce_cache_limit(&[])
            .expect("safe cache enforcement");

        assert_eq!(freed, 0);
        assert_eq!(
            std::fs::read(&source_path).expect("source remains"),
            source_bytes
        );
        database.clear_cache().expect("clear derived cache");
        assert_eq!(
            std::fs::read(&source_path).expect("source remains after clear"),
            source_bytes
        );

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn missing_image_page_is_rebuilt_atomically_and_touched() {
        use std::io::Cursor;

        use image::{DynamicImage, ImageFormat};

        let root = temporary_root("cache-rebuild-image");
        let source_dir = root.join("source");
        std::fs::create_dir_all(&source_dir).expect("source directory");
        let source_path = source_dir.join("page.png");
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(3, 5)
            .write_to(&mut encoded, ImageFormat::Png)
            .expect("png");
        let source_bytes = encoded.into_inner();
        std::fs::write(&source_path, &source_bytes).expect("source image");
        let database = LibraryDb::open(root.join("app")).expect("database");
        let imported =
            crate::importer::import_paths(&database, &[source_path.to_string_lossy().into_owned()])
                .expect("import")
                .publications
                .remove(0);
        let page = &imported.pages[0];
        std::fs::remove_file(&page.cache_path).expect("remove derived page");

        let rebuilt = database
            .ensure_page_cache(&imported.id, &page.id)
            .expect("rebuild page");

        assert_eq!(
            std::fs::read(&rebuilt.cache_path).expect("rebuilt bytes"),
            source_bytes
        );
        assert_eq!((rebuilt.width, rebuilt.height), (3, 5));
        assert!(!Path::new(&rebuilt.cache_path)
            .parent()
            .expect("cache parent")
            .join(format!(".{}.tmp", rebuilt.id))
            .exists());
        assert_eq!(database.cache_info().expect("cache info").entry_count, 1);

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }

    #[test]
    fn migration_backfills_pdf_source_refs_but_leaves_ambiguous_archives_empty() {
        let mut connection = Connection::open_in_memory().expect("in-memory sqlite");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                 INSERT INTO schema_migrations (version, applied_at) VALUES (1, '0'), (2, '0'), (3, '0');
                 CREATE TABLE publications (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, source_label TEXT NOT NULL,
                    format TEXT NOT NULL, source_path TEXT NOT NULL UNIQUE, cover_page_id TEXT NOT NULL,
                    direction TEXT NOT NULL DEFAULT 'ltr', added_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL, diagnostic TEXT, is_favorite INTEGER NOT NULL DEFAULT 0
                 );
                 CREATE TABLE pages (
                    id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, page_index INTEGER NOT NULL,
                    name TEXT NOT NULL, cache_path TEXT NOT NULL, source_ref TEXT NOT NULL DEFAULT '',
                    width INTEGER NOT NULL, height INTEGER NOT NULL
                 );
                 INSERT INTO publications VALUES
                    ('pdf-1', 'PDF', 'PDF', 'pdf', 'pdf:C:\\books\\sample.pdf', 'pdf-page', 'ltr', '0', '0', NULL, 0),
                    ('cbz-1', 'CBZ', 'CBZ', 'cbz', 'archive:C:\\books\\sample.cbz', 'cbz-page', 'ltr', '0', '0', NULL, 0);
                 INSERT INTO pages VALUES
                    ('pdf-page', 'pdf-1', 2, 'page-2.png', '', '', 1, 1),
                    ('cbz-page', 'cbz-1', 0, 'page.png', '', '', 1, 1);",
            )
            .expect("v3 schema");

        migrate(&mut connection).expect("migrate v3 database");

        let pdf_ref: String = connection
            .query_row(
                "SELECT source_ref FROM pages WHERE id = 'pdf-page'",
                [],
                |row| row.get(0),
            )
            .expect("PDF source ref");
        let archive_ref: String = connection
            .query_row(
                "SELECT source_ref FROM pages WHERE id = 'cbz-page'",
                [],
                |row| row.get(0),
            )
            .expect("archive source ref");
        assert_eq!(
            decode_source_ref(&pdf_ref),
            Some(PageSourceRef::Pdf {
                path: "C:\\books\\sample.pdf".to_owned(),
                page_index: 2,
            })
        );
        assert_eq!(archive_ref, "");
    }

    #[test]
    fn missing_legacy_source_ref_returns_a_non_reconstruction_diagnostic() {
        let root = temporary_root("cache-no-source-ref");
        std::fs::create_dir_all(&root).expect("root");
        let source_path = root.join("source.cbz");
        std::fs::write(&source_path, b"source").expect("source");
        let database = LibraryDb::open(root.clone()).expect("database");
        insert_test_publication(&database, &source_path.to_string_lossy());
        let cached_path = database
            .cache_dir()
            .join("publication-1")
            .join("page-1.png");
        std::fs::remove_file(cached_path).expect("remove derived cache");
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute("UPDATE pages SET source_ref = '' WHERE id = 'page-1'", [])
            .expect("simulate legacy page");
        drop(connection);

        let result = database.ensure_page_cache("publication-1", "page-1");
        let publication = database
            .list_publications()
            .expect("publications")
            .remove(0);

        assert!(result.is_err());
        assert!(publication
            .diagnostic
            .as_deref()
            .expect("diagnostic")
            .contains("cannot be reconstructed"));

        drop(database);
        std::fs::remove_dir_all(root).expect("cleanup database");
    }
}
