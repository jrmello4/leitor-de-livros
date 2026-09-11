use std::{borrow::Cow, path::Path};

/// Recover only prefixes whose storage location proves they were added by an
/// older importer. Never strip arbitrary numbers from an external filename.
pub(crate) fn original_import_name(source_key: &str, managed_import_dir: &Path) -> Option<String> {
    let source = ["archive:", "cbr:", "7z:", "pdf:"]
        .iter()
        .find_map(|prefix| source_key.strip_prefix(prefix))?;
    // Canonical Windows sources may have an extended-length path prefix.
    let source = storage_path(source);
    let path = Path::new(source.as_ref());
    let managed = managed_import_dir.to_str()?;
    let managed = storage_path(managed);
    let managed = Path::new(managed.as_ref());
    let parent = path.parent()?;
    let parent_name = parent.file_name()?.to_str()?;
    let filename = path.file_name()?.to_str()?;

    let original = if parent.parent() == Some(managed)
        && parent_name.strip_prefix("batch-").is_some_and(|batch| {
            batch
                .split_once('-')
                .is_some_and(|(time, nonce)| digits(time) && digits(nonce))
        }) {
        // SAF multi-selection: imports/batch-<time>-<nonce>/<index>-<name>.
        strip_index(filename, None)?
    } else if parent == managed {
        // First Android bridge: imports/<timestamp>-<index>-<name>.
        let (timestamp, rest) = filename.split_once('-')?;
        if timestamp.len() != 13 || !digits(timestamp) {
            return None;
        }
        strip_index(rest, None)?
    } else if parent_name
        .strip_prefix("collection-collection-")
        .is_some_and(|hash| hash.len() == 24 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        // Collection ZIP extraction: collection-<digest>/<index:04>-<name>.
        strip_index(filename, Some(4))?
    } else {
        return None;
    };
    Some(original.to_owned())
}

fn storage_path(value: &str) -> Cow<'_, str> {
    let value = value.strip_prefix(r"\\?\").unwrap_or(value);
    // Older Android copies used /data/data; the same primary-user app storage
    // is also exposed as /data/user/0. Do not rewrite other Android users.
    match value.strip_prefix("/data/data/") {
        Some(rest) => Cow::Owned(format!("/data/user/0/{rest}")),
        None => Cow::Borrowed(value),
    }
}

fn digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn strip_index(value: &str, width: Option<usize>) -> Option<&str> {
    let (index, original) = value.split_once('-')?;
    (digits(index) && width.is_none_or(|width| index.len() == width) && !original.is_empty())
        .then_some(original)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_files_directory_and_primary_user_alias_match_legacy_sources() {
        let root = Path::new("/data/user/0/com.jrmello4.tactilereader/files/imports");
        for source in [
            "archive:/data/data/com.jrmello4.tactilereader/files/imports/batch-1788980940132-685559126034362/0-Arqueiro Verde Absoluto #01.cbr",
            "cbr:/data/user/0/com.jrmello4.tactilereader/files/imports/batch-1788980940132-685559126034362/0-Arqueiro Verde Absoluto #01.cbr",
        ] {
            assert_eq!(original_import_name(source, root).as_deref(), Some("Arqueiro Verde Absoluto #01.cbr"));
        }
        assert_eq!(original_import_name(
            "archive:/data/user/10/com.jrmello4.tactilereader/files/imports/batch-123-456/0-Arqueiro Verde #01.cbr", root,
        ), None);
    }

    #[test]
    fn recovers_each_legacy_import_layout() {
        for (path, expected) in [
            ("imports/batch-1788979885761-684528334738766/0-Arqueiro Verde Absoluto #01.cbr", "Arqueiro Verde Absoluto #01.cbr"),
            ("imports/batch-1788979885761-684528334738766/002-Batman Absoluto #10.cbr", "Batman Absoluto #10.cbr"),
            ("imports/1788956256851-0-Batman Absoluto #00.cbz", "Batman Absoluto #00.cbz"),
            ("HQ/collection-collection-0123456789abcdef01234567/0001-Arqueiro Verde Absoluto #02.cbr", "Arqueiro Verde Absoluto #02.cbr"),
            ("imports/batch-123-456/2-2000 AD #01.cbr", "2000 AD #01.cbr"),
            ("imports/batch-123-456/2-0-Arqueiro Verde #01.cbr", "0-Arqueiro Verde #01.cbr"),
        ] {
            assert_eq!(original_import_name(&format!("cbr:{path}"), Path::new("imports")).as_deref(), Some(expected));
        }
    }

    #[test]
    fn preserves_original_numbers_and_new_import_layouts() {
        for path in [
            "HQ/002 - Batman Absoluto #01.cbr",
            "HQ/100 Bullets #01.cbr",
            "HQ/1984.cbr",
            "imports/folder-123-456/0-Arqueiro Verde #01.cbr",
            "imports/batch-123-456/2/2000 AD #01.cbr",
            "imports/batch-123-456/2/0-Arqueiro Verde #01.cbr",
            "HQ/collection-collection-0123456789abcdef01234567/0001/0-Arqueiro Verde #01.cbr",
            "HQ/collection-favorites/0001-Arqueiro Verde #01.cbr",
        ] {
            assert_eq!(
                original_import_name(&format!("cbr:{path}"), Path::new("imports")),
                None,
                "{path}"
            );
        }
    }
}
