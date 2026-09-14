use std::path::Path;

use std::{collections::HashSet, fs, path::PathBuf, sync::OnceLock};

#[cfg(not(target_os = "android"))]
use unrar::Archive;

use crate::{
    db::LibraryDb,
    error::{CoreError, CoreResult},
    importer,
    models::NativePublication,
};

use crate::models::{NewPage, NewPublication, PageSourceRef};

const MAX_DOCUMENT_BYTES: u64 = 1024 * 1024 * 1024;

/// Host-provided PDF backend (pdfium no desktop Tauri, um renderizador NDK no
/// futuro app nativo). Sem backend registrado, PDF responde "indisponível" e
/// os originais são preservados — o mesmo contrato do stub anterior.
type PdfImportBackend = fn(&LibraryDb, &str, &Path) -> CoreResult<NativePublication>;
type PdfRebuildBackend = fn(&Path, usize) -> CoreResult<importer::RebuiltPage>;
static PDF_IMPORT_BACKEND: OnceLock<PdfImportBackend> = OnceLock::new();
static PDF_REBUILD_BACKEND: OnceLock<PdfRebuildBackend> = OnceLock::new();

/// Registers the host PDF backend. Idempotent: the first registration wins.
pub fn set_pdf_backend(import: PdfImportBackend, rebuild: PdfRebuildBackend) {
    let _ = PDF_IMPORT_BACKEND.set(import);
    let _ = PDF_REBUILD_BACKEND.set(rebuild);
}

pub(crate) fn import_pdf(
    db: &LibraryDb,
    source_key: &str,
    path: &Path,
) -> CoreResult<NativePublication> {
    match PDF_IMPORT_BACKEND.get() {
        Some(import) => import(db, source_key, path),
        None => Err(CoreError::AdapterUnavailable(
            "PDF ainda não está disponível no Android; use CBZ, ZIP ou imagens. O arquivo original foi preservado.".to_owned(),
        )),
    }
}

pub(crate) fn rebuild_pdf_page(
    path: &Path,
    page_index: usize,
) -> CoreResult<importer::RebuiltPage> {
    match PDF_REBUILD_BACKEND.get() {
        Some(rebuild) => rebuild(path, page_index),
        None => Err(CoreError::AdapterUnavailable(
            "PDF ainda não está disponível no Android; use CBZ, ZIP ou imagens. O arquivo original foi preservado.".to_owned(),
        )),
    }
}

#[cfg(not(target_os = "android"))]
pub(crate) fn import_cbr(
    db: &LibraryDb,
    source_key: &str,
    path: &Path,
) -> CoreResult<NativePublication> {
    if let Some(existing) = db.find_by_source_path(source_key)? {
        return Ok(existing);
    }
    validate_document_size(path, "CBR")?;

    let publication_id = importer::digest_id("publication", source_key.as_bytes());
    let cache_dir = db.cache_dir().join(&publication_id);
    let result = build_cbr_publication(
        publication_id,
        source_key.to_owned(),
        path,
        cache_dir.clone(),
    );
    let publication = match result {
        Ok(publication) => publication,
        Err(error) => {
            let _ = fs::remove_dir_all(cache_dir);
            return Err(error);
        }
    };
    importer::persist_publication(db, &publication, &cache_dir)
}

#[cfg(target_os = "android")]
pub(crate) fn import_cbr(
    db: &LibraryDb,
    source_key: &str,
    path: &Path,
) -> CoreResult<NativePublication> {
    if let Some(existing) = db.find_by_source_path(source_key)? {
        return Ok(existing);
    }
    validate_android_cbr_size(path)?;

    let publication_id = importer::digest_id("publication", source_key.as_bytes());
    let cache_dir = db.cache_dir().join(&publication_id);
    let result = build_android_cbr_publication(
        publication_id,
        source_key.to_owned(),
        path,
        cache_dir.clone(),
    );
    let publication = match result {
        Ok(publication) => publication,
        Err(error) => {
            let _ = fs::remove_dir_all(cache_dir);
            return Err(error);
        }
    };
    importer::persist_publication(db, &publication, &cache_dir)
}

#[cfg(target_os = "android")]
fn validate_android_cbr_size(path: &Path) -> CoreResult<()> {
    let size = fs::metadata(path)?.len();
    if size > MAX_DOCUMENT_BYTES {
        return Err(CoreError::from(format!(
            "CBR exceeds the {} GiB document size safety limit",
            MAX_DOCUMENT_BYTES / 1024 / 1024 / 1024
        )));
    }
    Ok(())
}

#[cfg(target_os = "android")]
fn open_android_rar(path: &Path) -> CoreResult<unrar_rs::RarArchive> {
    let file = fs::File::open(path)?;
    unrar_rs::RarArchive::open(file)
        .map_err(|error| CoreError::from(format!("Unable to read CBR/RAR: {error}")))
}

#[cfg(target_os = "android")]
fn build_android_cbr_publication(
    publication_id: String,
    source_key: String,
    path: &Path,
    cache_dir: PathBuf,
) -> CoreResult<NewPublication> {
    fs::create_dir_all(&cache_dir)?;
    let mut archive = open_android_rar(path)?;
    if archive.metadata().is_encrypted {
        return Err(CoreError::from("encrypted CBR headers are not supported"));
    }

    let entries: Vec<_> = archive.entries().collect();
    let mut pages = Vec::new();
    let mut total_bytes = 0_u64;
    let mut seen_names = HashSet::new();

    for (member_index, entry) in entries.into_iter().enumerate() {
        let normalized_name = importer::validate_archive_name(&entry.name)?;
        if entry.is_encrypted {
            return Err(CoreError::from(format!(
                "encrypted CBR entry is not supported: {normalized_name}"
            )));
        }
        if entry.volumes.is_split() {
            return Err(CoreError::from(format!(
                "split CBR entries are not supported: {normalized_name}"
            )));
        }
        if entry.is_directory
            || !importer::is_image_extension(
                &importer::extension_from_name(&normalized_name).unwrap_or_default(),
            )
        {
            continue;
        }
        if !seen_names.insert(normalized_name.to_lowercase()) {
            return Err(CoreError::from("CBR contains duplicate page names"));
        }
        if pages.len() >= importer::MAX_PAGE_COUNT {
            return Err(CoreError::from(format!(
                "CBR exceeds the {} page safety limit",
                importer::MAX_PAGE_COUNT
            )));
        }
        let unpacked_size = entry.unpacked_size.ok_or_else(|| {
            CoreError::from(format!("CBR page size is missing: {normalized_name}"))
        })?;
        if unpacked_size > importer::MAX_PAGE_BYTES {
            return Err(CoreError::from(format!(
                "CBR page {} exceeds the {} MiB page limit",
                normalized_name,
                importer::MAX_PAGE_BYTES / 1024 / 1024
            )));
        }
        total_bytes = total_bytes.saturating_add(unpacked_size);
        if total_bytes > importer::MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(CoreError::from(
                "CBR exceeds the total uncompressed size safety limit",
            ));
        }

        // Decode one page at a time. Capacity is bounded by the validated RAR
        // header and the post-extraction check protects malformed archives.
        let mut bytes = Vec::with_capacity(unpacked_size as usize);
        archive
            .by_index(member_index)
            .map_err(|error| CoreError::from(format!("Unable to open CBR page: {error}")))?
            .copy_to(&mut bytes)
            .map_err(|error| CoreError::from(format!("Unable to extract CBR page: {error}")))?;
        if bytes.len() as u64 > importer::MAX_PAGE_BYTES {
            return Err(CoreError::from(format!(
                "CBR page {} exceeds the {} MiB page limit after extraction",
                normalized_name,
                importer::MAX_PAGE_BYTES / 1024 / 1024
            )));
        }
        let (width, height) = importer::validate_image(&bytes, &normalized_name)?;
        let extension = importer::extension_from_name(&normalized_name)
            .ok_or_else(|| CoreError::from("CBR image extension missing"))?;
        let page_id = format!("{publication_id}-page-{:04}", pages.len());
        let cache_path = importer::cache_page(&cache_dir, &page_id, &extension, &bytes)?;
        pages.push(NewPage {
            id: page_id,
            index: pages.len(),
            name: Path::new(&normalized_name)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&normalized_name)
                .to_owned(),
            cache_path,
            source_ref: PageSourceRef::Archive {
                path: path.to_string_lossy().into_owned(),
                member: normalized_name,
            },
            width,
            height,
        });
    }

    pages.sort_by(|left, right| importer::natural_compare(&left.name, &right.name));
    for (index, page) in pages.iter_mut().enumerate() {
        page.index = index;
    }
    if pages.is_empty() {
        return Err(CoreError::from(
            "CBR contains no supported raster image pages",
        ));
    }

    let title = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("Imported CBR")
        .to_owned();
    let source_label = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("CBR archive")
        .to_owned();
    importer::new_publication(
        publication_id,
        title,
        source_label,
        source_key,
        "cbr".to_owned(),
        pages,
    )
}

#[cfg(not(target_os = "android"))]
pub fn validate_document_size(path: &Path, format: &str) -> CoreResult<()> {
    let size = fs::metadata(path)?.len();
    if size > MAX_DOCUMENT_BYTES {
        return Err(CoreError::from(format!(
            "{format} exceeds the {} GiB document size safety limit",
            MAX_DOCUMENT_BYTES / 1024 / 1024 / 1024
        )));
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn build_cbr_publication(
    publication_id: String,
    source_key: String,
    path: &Path,
    cache_dir: PathBuf,
) -> CoreResult<NewPublication> {
    fs::create_dir_all(&cache_dir)?;
    let mut archive = Archive::new(path)
        .as_first_part()
        .open_for_processing()
        .map_err(|error| CoreError::Unrar(format!("{error:?}")))?;
    if archive.has_encrypted_headers() {
        return Err(CoreError::from("encrypted CBR headers are not supported"));
    }

    let mut pages = Vec::new();
    let mut total_bytes = 0_u64;
    let mut seen_names = HashSet::new();

    loop {
        let Some(entry) = archive
            .read_header()
            .map_err(|error| CoreError::Unrar(format!("{error:?}")))?
        else {
            break;
        };

        let raw_name = entry.entry().filename.to_string_lossy().into_owned();
        let normalized_name = importer::validate_archive_name(&raw_name)?;
        let is_directory = entry.entry().is_directory();
        let is_encrypted = entry.entry().is_encrypted();
        let is_split = entry.entry().is_split();
        let unpacked_size = entry.entry().unpacked_size;

        if is_encrypted {
            return Err(CoreError::from(format!(
                "encrypted CBR entry is not supported: {normalized_name}"
            )));
        }
        if is_split {
            return Err(CoreError::from(format!(
                "split CBR entries are not supported: {normalized_name}"
            )));
        }
        if is_directory
            || !importer::is_image_extension(
                &importer::extension_from_name(&normalized_name).unwrap_or_default(),
            )
        {
            archive = entry
                .skip()
                .map_err(|error| CoreError::Unrar(format!("{error:?}")))?;
            continue;
        }
        if !seen_names.insert(normalized_name.to_lowercase()) {
            return Err(CoreError::from("CBR contains duplicate page names"));
        }
        if pages.len() >= importer::MAX_PAGE_COUNT {
            return Err(CoreError::from(format!(
                "CBR exceeds the {} page safety limit",
                importer::MAX_PAGE_COUNT
            )));
        }
        if unpacked_size > importer::MAX_PAGE_BYTES {
            return Err(CoreError::from(format!(
                "CBR page {} exceeds the {} MiB page limit",
                normalized_name,
                importer::MAX_PAGE_BYTES / 1024 / 1024
            )));
        }
        total_bytes = total_bytes.saturating_add(unpacked_size);
        if total_bytes > importer::MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(CoreError::from(
                "CBR exceeds the total uncompressed size safety limit",
            ));
        }

        let (bytes, next_archive) = entry
            .read()
            .map_err(|error| CoreError::Unrar(format!("{error:?}")))?;
        if bytes.len() as u64 > importer::MAX_PAGE_BYTES {
            return Err(CoreError::from(format!(
                "CBR page {} exceeds the {} MiB page limit after extraction",
                normalized_name,
                importer::MAX_PAGE_BYTES / 1024 / 1024
            )));
        }
        let (width, height) = importer::validate_image(&bytes, &normalized_name)?;
        let extension = importer::extension_from_name(&normalized_name)
            .ok_or_else(|| CoreError::from("CBR image extension missing"))?;
        let page_id = format!("{publication_id}-page-{:04}", pages.len());
        let cache_path = importer::cache_page(&cache_dir, &page_id, &extension, &bytes)?;
        pages.push(NewPage {
            id: page_id,
            index: pages.len(),
            name: Path::new(&normalized_name)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&normalized_name)
                .to_owned(),
            cache_path,
            source_ref: PageSourceRef::Archive {
                path: path.to_string_lossy().into_owned(),
                member: normalized_name,
            },
            width,
            height,
        });
        archive = next_archive;
    }

    pages.sort_by(|left, right| importer::natural_compare(&left.name, &right.name));
    for (index, page) in pages.iter_mut().enumerate() {
        page.index = index;
    }
    if pages.is_empty() {
        return Err(CoreError::from(
            "CBR contains no supported raster image pages",
        ));
    }

    let title = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("Imported CBR")
        .to_owned();
    let source_label = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("CBR archive")
        .to_owned();
    importer::new_publication(
        publication_id,
        title,
        source_label,
        source_key,
        "cbr".to_owned(),
        pages,
    )
}

#[allow(dead_code)]
#[cfg(not(target_os = "android"))]
pub(crate) fn rebuild_cbr_page(path: &Path, member: &str) -> CoreResult<importer::RebuiltPage> {
    validate_document_size(path, "CBR")?;
    let normalized_member = importer::validate_archive_name(member)?;
    let mut archive = Archive::new(path)
        .as_first_part()
        .open_for_processing()
        .map_err(|error| CoreError::Unrar(format!("{error:?}")))?;
    if archive.has_encrypted_headers() {
        return Err(CoreError::from("encrypted CBR headers are not supported"));
    }

    loop {
        let Some(entry) = archive
            .read_header()
            .map_err(|error| CoreError::Unrar(format!("{error:?}")))?
        else {
            break;
        };
        let current_name =
            importer::validate_archive_name(entry.entry().filename.to_string_lossy().as_ref())?;
        if current_name != normalized_member {
            archive = entry
                .skip()
                .map_err(|error| CoreError::Unrar(format!("{error:?}")))?;
            continue;
        }
        if entry.entry().is_directory() || entry.entry().is_encrypted() || entry.entry().is_split()
        {
            return Err(CoreError::from("CBR page source cannot be reconstructed"));
        }
        if entry.entry().unpacked_size > importer::MAX_PAGE_BYTES {
            return Err(CoreError::from(format!(
                "CBR page {normalized_member} exceeds the {} MiB page limit",
                importer::MAX_PAGE_BYTES / 1024 / 1024
            )));
        }
        let (bytes, _) = entry
            .read()
            .map_err(|error| CoreError::Unrar(format!("{error:?}")))?;
        if bytes.len() as u64 > importer::MAX_PAGE_BYTES {
            return Err(CoreError::from(format!(
                "CBR page {normalized_member} exceeds the {} MiB page limit after extraction",
                importer::MAX_PAGE_BYTES / 1024 / 1024
            )));
        }
        let (width, height) = importer::validate_image(&bytes, &normalized_member)?;
        let extension = importer::extension_from_name(&normalized_member)
            .ok_or_else(|| CoreError::from("CBR image extension missing"))?;
        return Ok(importer::RebuiltPage {
            extension,
            bytes,
            width,
            height,
        });
    }
    Err(CoreError::from(format!(
        "CBR page source is missing: {normalized_member}"
    )))
}

#[cfg(target_os = "android")]
pub(crate) fn rebuild_cbr_page(path: &Path, member: &str) -> CoreResult<importer::RebuiltPage> {
    validate_android_cbr_size(path)?;
    let normalized_member = importer::validate_archive_name(member)?;
    let mut archive = open_android_rar(path)?;
    let member_index = archive
        .entries()
        .position(|entry| entry.name == normalized_member)
        .ok_or_else(|| {
            CoreError::from(format!("CBR page source is missing: {normalized_member}"))
        })?;
    let info = archive
        .entry_info(member_index)
        .ok_or_else(|| CoreError::from("CBR page source cannot be reconstructed"))?;
    if info.is_directory || info.is_encrypted || info.volumes.is_split() {
        return Err(CoreError::from("CBR page source cannot be reconstructed"));
    }
    let unpacked_size = info
        .unpacked_size
        .ok_or_else(|| CoreError::from("CBR page size is missing"))?;
    if unpacked_size > importer::MAX_PAGE_BYTES {
        return Err(CoreError::from(format!(
            "CBR page {normalized_member} exceeds the {} MiB page limit",
            importer::MAX_PAGE_BYTES / 1024 / 1024
        )));
    }
    let mut bytes = Vec::with_capacity(unpacked_size as usize);
    archive
        .by_index(member_index)
        .map_err(|error| CoreError::from(format!("Unable to open CBR page: {error}")))?
        .copy_to(&mut bytes)
        .map_err(|error| CoreError::from(format!("Unable to extract CBR page: {error}")))?;
    if bytes.len() as u64 > importer::MAX_PAGE_BYTES {
        return Err(CoreError::from(format!(
            "CBR page {normalized_member} exceeds the {} MiB page limit after extraction",
            importer::MAX_PAGE_BYTES / 1024 / 1024
        )));
    }
    let (width, height) = importer::validate_image(&bytes, &normalized_member)?;
    let extension = importer::extension_from_name(&normalized_member)
        .ok_or_else(|| CoreError::from("CBR image extension missing"))?;
    Ok(importer::RebuiltPage {
        extension,
        bytes,
        width,
        height,
    })
}

#[cfg(test)]
mod tests {

    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn test_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("tactile-reader-{label}-{suffix}"))
    }

    #[test]
    fn malformed_cbr_returns_diagnostic_without_persisting() {
        let root = test_root("malformed-cbr");
        fs::create_dir_all(&root).expect("test directory");
        let archive_path = root.join("broken.cbr");
        fs::write(&archive_path, b"not a rar archive").expect("malformed archive");
        let database = LibraryDb::open(root.join("app")).expect("database");

        let result =
            importer::import_paths(&database, &[archive_path.to_string_lossy().into_owned()])
                .expect("diagnostic result");

        assert!(result.publications.is_empty());
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.to_lowercase().contains("unrar")
                || diagnostic.to_lowercase().contains("archive")
        }));
        assert!(database
            .list_publications()
            .expect("publications")
            .is_empty());

        drop(database);
        fs::remove_dir_all(root).expect("cleanup test directory");
    }

    #[test]
    fn malformed_pdf_returns_diagnostic_without_persisting() {
        let root = test_root("malformed-pdf");
        fs::create_dir_all(&root).expect("test directory");
        let pdf_path = root.join("broken.pdf");
        fs::write(&pdf_path, b"not a pdf document").expect("malformed PDF");
        let database = LibraryDb::open(root.join("app")).expect("database");

        let result = importer::import_paths(&database, &[pdf_path.to_string_lossy().into_owned()])
            .expect("diagnostic result");

        assert!(result.publications.is_empty());
        assert!(result.diagnostics.iter().any(|diagnostic| {
            let diagnostic = diagnostic.to_lowercase();
            diagnostic.contains("pdf") || diagnostic.contains("adapter")
        }));
        assert!(database
            .list_publications()
            .expect("publications")
            .is_empty());

        drop(database);
        fs::remove_dir_all(root).expect("cleanup test directory");
    }
}
