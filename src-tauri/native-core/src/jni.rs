//! Minimal JNI surface for the native Android app.
//!
//! Plain `jni`-crate functions, no codegen: the Kotlin side declares two
//! `external fun`s on `TactileCore` and this module answers the core version
//! plus a library-open smoke test (SQLite open + publication count). Failures
//! never throw — they come back as `{"error": ...}` JSON.

use std::path::PathBuf;

use jni::objects::{JClass, JString};
use jni::sys::jstring;
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
