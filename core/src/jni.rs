//! Minimal JNI surface for the native Android app.
//!
//! Plain `jni`-crate functions, no codegen: the Kotlin side declares
//! `external fun`s on `TactileCore` and this module answers the core version,
//! library-open smoke test, listing, import, on-demand cover/page ensure and
//! reader-state (progress) load/save. Failures never throw — they come back
//! as `{"error": ...}` JSON.

use std::path::PathBuf;

use jni::objects::{JClass, JString};
use jni::sys::{jdouble, jstring};
use jni::JNIEnv;

use crate::db::LibraryDb;

fn pkg_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

fn ok_json(publications: usize) -> String {
    format!(
        r#"{{"version":"{}","publications":{}}}"#,
        pkg_version(),
        publications
    )
}

fn err_json(message: String) -> String {
    let safe = message.replace('\\', "\\\\").replace('"', "\\\"");
    format!(r#"{{"version":"{}","error":"{}"}}"#, pkg_version(), safe)
}

fn return_string(env: &mut JNIEnv, text: String) -> jstring {
    match env.new_string(text) {
        Ok(value) => value.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// `com.jrmello4.tactilereader.core.TactileCore.nativeVersion()`
#[no_mangle]
pub extern "C" fn Java_com_jrmello4_tactilereader_core_TactileCore_nativeVersion(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    return_string(&mut env, pkg_version())
}

/// `com.jrmello4.tactilereader.core.TactileCore.nativeOpenLibrary(dir)`.
///
/// Opens (creating if needed) the library database at `dir` and reports the
/// publication count, proving SQLite + the schema work on the device.
#[no_mangle]
pub extern "C" fn Java_com_jrmello4_tactilereader_core_TactileCore_nativeOpenLibrary(
    mut env: JNIEnv,
    _class: JClass,
    dir: JString,
) -> jstring {
    let result = (|| -> Result<String, String> {
        let dir: String = env
            .get_string(&dir)
            .map_err(|error| error.to_string())?
            .into();
        let db = LibraryDb::open(PathBuf::from(dir)).map_err(|error| error.to_string())?;
        let count = db
            .list_publications()
            .map_err(|error| error.to_string())?
            .len();
        Ok(ok_json(count))
    })();
    match result {
        Ok(ok) => return_string(&mut env, ok),
        Err(error) => return_string(&mut env, err_json(error)),
    }
}

/// `com.jrmello4.tactilereader.core.TactileCore.nativeListPublications(dbDir)`.
///
/// Returns `{"publications":[...]}` with the core `NativePublication` JSON
/// (camelCase). Powers the native library shelf.
#[no_mangle]
pub extern "C" fn Java_com_jrmello4_tactilereader_core_TactileCore_nativeListPublications(
    mut env: JNIEnv,
    _class: JClass,
    dir: JString,
) -> jstring {
    let result = (|| -> Result<String, String> {
        let dir: String = env
            .get_string(&dir)
            .map_err(|error| error.to_string())?
            .into();
        let db = LibraryDb::open(PathBuf::from(dir)).map_err(|error| error.to_string())?;
        let publications = db.list_publications().map_err(|error| error.to_string())?;
        let array = serde_json::to_string(&publications).map_err(|error| error.to_string())?;
        Ok(format!(r#"{{"publications":{array}}}"#))
    })();
    match result {
        Ok(ok) => return_string(&mut env, ok),
        Err(error) => return_string(&mut env, err_json(error)),
    }
}

/// `com.jrmello4.tactilereader.core.TactileCore.nativeImportPaths(dbDir, pathsJson)`.
///
/// `pathsJson` is a JSON array of filesystem paths. Returns the core
/// `NativeImportResult` JSON (`publications` + `diagnostics`).
#[no_mangle]
pub extern "C" fn Java_com_jrmello4_tactilereader_core_TactileCore_nativeImportPaths(
    mut env: JNIEnv,
    _class: JClass,
    dir: JString,
    paths: JString,
) -> jstring {
    let result = (|| -> Result<String, String> {
        let dir: String = env
            .get_string(&dir)
            .map_err(|error| error.to_string())?
            .into();
        let paths_raw: String = env
            .get_string(&paths)
            .map_err(|error| error.to_string())?
            .into();
        let paths: Vec<String> =
            serde_json::from_str(&paths_raw).map_err(|error| error.to_string())?;
        let db = LibraryDb::open(PathBuf::from(dir)).map_err(|error| error.to_string())?;
        let outcome =
            crate::importer::import_paths(&db, &paths).map_err(|error| error.to_string())?;
        serde_json::to_string(&outcome).map_err(|error| error.to_string())
    })();
    match result {
        Ok(ok) => return_string(&mut env, ok),
        Err(error) => return_string(&mut env, err_json(error)),
    }
}

/// `com.jrmello4.tactilereader.core.TactileCore.nativeEnsureCover(dbDir, publicationId, pageId)`.
///
/// Ensures the derived bytes of one cover page exist (rebuilding from the
/// read-only original when needed) and returns
/// `{"coverSrc":"<abs path>","width":W,"height":H}`. The listing reports only
/// identifiers and whatever cache path already exists; the shelf calls this
/// lazily for visible cards so a 124-publication library does not rebuild
/// every cover at boot. Failures come back as `{"error": ...}`.
#[no_mangle]
pub extern "C" fn Java_com_jrmello4_tactilereader_core_TactileCore_nativeEnsureCover(
    mut env: JNIEnv,
    _class: JClass,
    dir: JString,
    publication_id: JString,
    page_id: JString,
) -> jstring {
    let result = ensure_page_json(&mut env, dir, publication_id, page_id, "coverSrc");
    match result {
        Ok(ok) => return_string(&mut env, ok),
        Err(error) => return_string(&mut env, err_json(error)),
    }
}

/// Shared page-cache ensure behind `nativeEnsureCover` and
/// `nativeEnsurePage`: rebuilds the derived bytes of one page from the
/// read-only original when needed and reports them under `path_key`.
fn ensure_page_json(
    env: &mut JNIEnv,
    dir: JString,
    publication_id: JString,
    page_id: JString,
    path_key: &str,
) -> Result<String, String> {
    let dir: String = env
        .get_string(&dir)
        .map_err(|error| error.to_string())?
        .into();
    let publication_id: String = env
        .get_string(&publication_id)
        .map_err(|error| error.to_string())?
        .into();
    let page_id: String = env
        .get_string(&page_id)
        .map_err(|error| error.to_string())?
        .into();
    if publication_id.is_empty() || page_id.is_empty() {
        return Err("page does not belong to the publication".to_owned());
    }
    let db = LibraryDb::open(PathBuf::from(dir)).map_err(|error| error.to_string())?;
    let page = db
        .ensure_page_cache(&publication_id, &page_id)
        .map_err(|error| error.to_string())?;
    if page.cache_path.is_empty() {
        return Err("derived page cache is missing".to_owned());
    }
    Ok(serde_json::json!({
        path_key: page.cache_path,
        "width": page.width,
        "height": page.height,
    })
    .to_string())
}

/// `com.jrmello4.tactilereader.core.TactileCore.nativeListPages(dbDir, publicationId)`.
///
/// Returns `{"pages":[...]}` with the full core `NativePage` JSON
/// (camelCase, natural order). Entries may carry an empty `cachePath` when
/// no derived bytes exist yet — the reader ensures each visible page via
/// `nativeEnsurePage` instead of rebuilding the whole chapter up front.
#[no_mangle]
pub extern "C" fn Java_com_jrmello4_tactilereader_core_TactileCore_nativeListPages(
    mut env: JNIEnv,
    _class: JClass,
    dir: JString,
    publication_id: JString,
) -> jstring {
    let result = (|| -> Result<String, String> {
        let dir: String = env
            .get_string(&dir)
            .map_err(|error| error.to_string())?
            .into();
        let publication_id: String = env
            .get_string(&publication_id)
            .map_err(|error| error.to_string())?
            .into();
        if publication_id.is_empty() {
            return Err("publication id is empty".to_owned());
        }
        let db = LibraryDb::open(PathBuf::from(dir)).map_err(|error| error.to_string())?;
        let pages = db
            .list_publication_pages(&publication_id)
            .map_err(|error| error.to_string())?;
        let array = serde_json::to_string(&pages).map_err(|error| error.to_string())?;
        Ok(format!(r#"{{"pages":{array}}}"#))
    })();
    match result {
        Ok(ok) => return_string(&mut env, ok),
        Err(error) => return_string(&mut env, err_json(error)),
    }
}

/// `com.jrmello4.tactilereader.core.TactileCore.nativeEnsurePage(dbDir, publicationId, pageId)`.
///
/// Same contract as `nativeEnsureCover` but reported under `pageSrc` for
/// the reader strip: `{"pageSrc":"<abs path>","width":W,"height":H}`.
#[no_mangle]
pub extern "C" fn Java_com_jrmello4_tactilereader_core_TactileCore_nativeEnsurePage(
    mut env: JNIEnv,
    _class: JClass,
    dir: JString,
    publication_id: JString,
    page_id: JString,
) -> jstring {
    let result = ensure_page_json(&mut env, dir, publication_id, page_id, "pageSrc");
    match result {
        Ok(ok) => return_string(&mut env, ok),
        Err(error) => return_string(&mut env, err_json(error)),
    }
}

/// `com.jrmello4.tactilereader.core.TactileCore.nativeLoadReaderState(dbDir, publicationId)`.
///
/// Returns `{"state":null}` or `{"state":{"pageId":...,"scrollRatio":...}}`
/// so the reader restores exactly where it stopped.
#[no_mangle]
pub extern "C" fn Java_com_jrmello4_tactilereader_core_TactileCore_nativeLoadReaderState(
    mut env: JNIEnv,
    _class: JClass,
    dir: JString,
    publication_id: JString,
) -> jstring {
    let result = (|| -> Result<String, String> {
        let dir: String = env
            .get_string(&dir)
            .map_err(|error| error.to_string())?
            .into();
        let publication_id: String = env
            .get_string(&publication_id)
            .map_err(|error| error.to_string())?
            .into();
        if publication_id.is_empty() {
            return Err("publication id is empty".to_owned());
        }
        let db = LibraryDb::open(PathBuf::from(dir)).map_err(|error| error.to_string())?;
        let state = db
            .load_reader_state(&publication_id)
            .map_err(|error| error.to_string())?;
        let json = serde_json::to_string(&state).map_err(|error| error.to_string())?;
        Ok(format!(r#"{{"state":{json}}}"#))
    })();
    match result {
        Ok(ok) => return_string(&mut env, ok),
        Err(error) => return_string(&mut env, err_json(error)),
    }
}

/// `com.jrmello4.tactilereader.core.TactileCore.nativeSaveReaderState(dbDir, publicationId, pageId, scrollRatio)`.
///
/// Persists `{pageId, scrollRatio}` (ratio clamped to 0..=1; NaN becomes 0).
/// Zoom stays at the reader default (`page`, 1x, no pan) — pinch zoom is a
/// later slice. Returns `{"ok":true}`.
#[no_mangle]
pub extern "C" fn Java_com_jrmello4_tactilereader_core_TactileCore_nativeSaveReaderState(
    mut env: JNIEnv,
    _class: JClass,
    dir: JString,
    publication_id: JString,
    page_id: JString,
    scroll_ratio: jdouble,
) -> jstring {
    let result = (|| -> Result<String, String> {
        let dir: String = env
            .get_string(&dir)
            .map_err(|error| error.to_string())?
            .into();
        let publication_id: String = env
            .get_string(&publication_id)
            .map_err(|error| error.to_string())?
            .into();
        let page_id: String = env
            .get_string(&page_id)
            .map_err(|error| error.to_string())?
            .into();
        if publication_id.is_empty() || page_id.is_empty() {
            return Err("publication id and page id must not be empty".to_owned());
        }
        let ratio = (scroll_ratio as f64).clamp(0.0, 1.0);
        let ratio = if ratio.is_nan() { 0.0 } else { ratio };
        let db = LibraryDb::open(PathBuf::from(dir)).map_err(|error| error.to_string())?;
        db.save_reader_state(
            &publication_id,
            &crate::models::NativeReaderState {
                zoom_mode: "page".to_owned(),
                zoom_scale: 1.0,
                pan_x: 0.0,
                pan_y: 0.0,
                page_id: Some(page_id),
                scroll_ratio: ratio,
            },
        )
        .map_err(|error| error.to_string())?;
        Ok(r#"{"ok":true}"#.to_owned())
    })();
    match result {
        Ok(ok) => return_string(&mut env, ok),
        Err(error) => return_string(&mut env, err_json(error)),
    }
}
