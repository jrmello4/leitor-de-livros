use std::{
    cmp::Ordering,
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{copy, sink, Cursor, Read, Write},
    path::{Component, Path, PathBuf},
};

use image::ImageReader;
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::{
    db::LibraryDb,
    error::{CoreError, CoreResult},
    models::{
        NativeImportProgress, NativeImportResult, NativePublication, NewPage, NewPublication,
        PageSourceRef,
    },
};

pub(crate) const MAX_PAGE_BYTES: u64 = 64 * 1024 * 1024;
pub(crate) const MAX_ARCHIVE_BYTES: u64 = 1024 * 1024 * 1024;
pub(crate) const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const MAX_PAGE_COUNT: usize = 1024;
const MAX_COLLECTION_ITEMS: usize = 2048;
const MAX_COLLECTION_BYTES: u64 = 64 * 1024 * 1024 * 1024;
pub(crate) const MAX_IMAGE_DIMENSION: u32 = 20_000;
pub(crate) const MAX_IMAGE_PIXELS: u64 = 100_000_000;

const IMAGE_EXTENSIONS: &[&str] = &["avif", "gif", "jpeg", "jpg", "png", "webp"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ComicArchiveContainer {
    Zip,
    Rar,
    SevenZip,
    Unknown,
}

fn detect_comic_archive_container(path: &Path) -> CoreResult<ComicArchiveContainer> {
    let mut file = File::open(path)?;
    let mut signature = [0_u8; 8];
    let read = file.read(&mut signature)?;
    let bytes = &signature[..read];
    if bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
    {
        return Ok(ComicArchiveContainer::Zip);
    }
    if bytes.starts_with(b"Rar!\x1a\x07\x00") || bytes.starts_with(b"Rar!\x1a\x07\x01\x00") {
        return Ok(ComicArchiveContainer::Rar);
    }
    if bytes.starts_with(b"7z\xBC\xAF\x27\x1C") {
        return Ok(ComicArchiveContainer::SevenZip);
    }
    Ok(ComicArchiveContainer::Unknown)
}

// Used through the staged cache command API introduced in the next task.
#[allow(dead_code)]
pub(crate) struct RebuiltPage {
    pub extension: String,
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub fn import_paths(db: &LibraryDb, raw_paths: &[String]) -> CoreResult<NativeImportResult> {
    import_paths_with_progress(db, raw_paths, |_| {})
}

pub fn import_paths_with_progress<F>(
    db: &LibraryDb,
    raw_paths: &[String],
    mut on_progress: F,
) -> CoreResult<NativeImportResult>
where
    F: FnMut(NativeImportProgress),
{
    let mut image_paths = Vec::new();
    let mut image_sources = Vec::new();
    let mut archive_paths = Vec::new();
    let mut cbr_paths = Vec::new();
    let mut sevenz_paths = Vec::new();
    let mut pdf_paths = Vec::new();
    let mut collection_paths = Vec::new();
    let mut diagnostics = Vec::new();

    for raw_path in raw_paths {
        let path = match canonicalize_input(raw_path) {
            Ok(path) => path,
            Err(error) => {
                diagnostics.push(format!("{raw_path}: {error}"));
                continue;
            }
        };

        if path.is_dir() {
            let mut files = Vec::new();
            if let Err(error) = collect_publication_files(&path, &path, &mut files) {
                diagnostics.push(format!("{}: {error}", path.display()));
                continue;
            }
            if files.is_empty() {
                diagnostics.push(format!(
                    "{}: no supported comics or raster images were found.",
                    path.display()
                ));
                continue;
            }
            for file in files {
                match extension(&file).as_deref() {
                    Some(extension) if is_image_extension(extension) => {
                        image_sources.push(format!("image:{}", file.display()));
                        image_paths.push(file);
                    }
                    Some("cbz") | Some("cbr") | Some("rar") | Some("7z") => {
                        match detect_comic_archive_container(&file) {
                            Ok(ComicArchiveContainer::Zip) => archive_paths.push(file),
                            Ok(ComicArchiveContainer::Rar) => cbr_paths.push(file),
                            Ok(ComicArchiveContainer::SevenZip) => sevenz_paths.push(file),
                            Ok(ComicArchiveContainer::Unknown) => diagnostics.push(format!(
                                "{}: file contents are not a supported ZIP/CBZ, RAR/CBR, or 7z archive.",
                                file.display()
                            )),
                            Err(error) => diagnostics.push(format!("{}: {error}", file.display())),
                        }
                    }
                    Some("pdf") => pdf_paths.push(file),
                    Some("zip") => collection_paths.push(file),
                    _ => {}
                }
            }
            continue;
        }

        match extension(&path).as_deref() {
            Some(extension) if is_image_extension(extension) => {
                image_sources.push(format!("image:{}", path.display()));
                image_paths.push(path);
            }
            Some("cbz") | Some("cbr") | Some("rar") | Some("7z") => {
                match detect_comic_archive_container(&path) {
                    Ok(ComicArchiveContainer::Zip) => archive_paths.push(path),
                    Ok(ComicArchiveContainer::Rar) => cbr_paths.push(path),
                    Ok(ComicArchiveContainer::SevenZip) => sevenz_paths.push(path),
                    Ok(ComicArchiveContainer::Unknown) => diagnostics.push(format!(
                        "{}: file contents are not a supported ZIP/CBZ, RAR/CBR, or 7z archive.",
                        path.display()
                    )),
                    Err(error) => diagnostics.push(format!("{}: {error}", path.display())),
                }
            }
            Some("pdf") => pdf_paths.push(path),
            Some("zip") => collection_paths.push(path),
            _ => diagnostics.push(format!("{}: unsupported publication file.", path.display())),
        }
    }

    let total = archive_paths.len()
        + cbr_paths.len()
        + pdf_paths.len()
        + sevenz_paths.len()
        + collection_paths.len()
        + if image_paths.is_empty() { 0 } else { 1 };
    let mut processed = 0;
    let mut succeeded = 0;
    let mut failed = 0;
    let mut emit = |name: &Path, ok: bool| {
        processed += 1;
        if ok {
            succeeded += 1;
        } else {
            failed += 1;
        }
        on_progress(NativeImportProgress {
            processed,
            total,
            succeeded,
            failed,
            current_name: name
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("arquivo")
                .to_owned(),
        });
    };
    let mut publications = Vec::new();
    if !image_paths.is_empty() {
        let source_key = source_key("images", &image_sources);
        match import_image_set(db, &source_key, image_paths) {
            Ok(publication) => {
                publications.push(publication);
                emit(Path::new("conjunto de imagens"), true);
            }
            Err(error) => {
                diagnostics.push(format!("image set: {error}"));
                emit(Path::new("conjunto de imagens"), false);
            }
        }
    }

    for path in archive_paths {
        let source_key = format!("archive:{}", path.display());
        match import_cbz(db, &source_key, &path) {
            Ok(publication) => {
                publications.push(publication);
                emit(&path, true);
            }
            Err(error) => {
                diagnostics.push(format!("{}: {error}", path.display()));
                emit(&path, false);
            }
        }
    }

    for path in cbr_paths {
        let source_key = format!("cbr:{}", path.display());
        match crate::adapters::import_cbr(db, &source_key, &path) {
            Ok(publication) => {
                publications.push(publication);
                emit(&path, true);
            }
            Err(error) => {
                diagnostics.push(format!("{}: {error}", path.display()));
                emit(&path, false);
            }
        }
    }

    for path in pdf_paths {
        let source_key = format!("pdf:{}", path.display());
        match crate::adapters::import_pdf(db, &source_key, &path) {
            Ok(publication) => {
                publications.push(publication);
                emit(&path, true);
            }
            Err(error) => {
                diagnostics.push(format!("{}: {error}", path.display()));
                emit(&path, false);
            }
        }
    }

    for path in sevenz_paths {
        let source_key = format!("7z:{}", path.display());
        match import_sevenz(db, &source_key, &path) {
            Ok(publication) => {
                publications.push(publication);
                emit(&path, true);
            }
            Err(error) => {
                diagnostics.push(format!("{}: {error}", path.display()));
                emit(&path, false);
            }
        }
    }

    for path in collection_paths {
        match import_collection_zip(db, &path) {
            Ok(result) => {
                publications.extend(result.publications);
                diagnostics.extend(result.diagnostics);
                emit(&path, true);
            }
            Err(error) => {
                diagnostics.push(format!("{}: {error}", path.display()));
                emit(&path, false);
            }
        }
    }

    Ok(NativeImportResult {
        publications,
        diagnostics,
    })
}

fn import_collection_zip(db: &LibraryDb, path: &Path) -> CoreResult<NativeImportResult> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    if archive.len() > MAX_COLLECTION_ITEMS {
        return Err(CoreError::from(format!(
            "collection exceeds the {MAX_COLLECTION_ITEMS} item safety limit"
        )));
    }
    let collection_id = digest_id("collection", path.to_string_lossy().as_bytes());
    let parent = path
        .parent()
        .ok_or_else(|| CoreError::from("collection archive has no parent directory"))?;
    let target_dir = parent.join(format!("collection-{collection_id}"));
    fs::create_dir_all(&target_dir)?;
    let mut nested_paths = Vec::new();
    let mut total_bytes = 0_u64;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        if entry.is_dir() {
            continue;
        }
        let normalized = validate_archive_name(entry.name())?;
        let nested_extension = extension_from_name(&normalized).unwrap_or_default();
        if !matches!(
            nested_extension.as_str(),
            "cbr" | "rar" | "cbz" | "7z" | "pdf"
        ) {
            continue;
        }
        if entry.encrypted() {
            return Err(CoreError::from(format!(
                "encrypted collection item is not supported: {normalized}"
            )));
        }
        if entry.size() > MAX_ARCHIVE_BYTES {
            return Err(CoreError::from(format!(
                "collection item exceeds the 1 GiB safety limit: {normalized}"
            )));
        }
        total_bytes = total_bytes.saturating_add(entry.size());
        if total_bytes > MAX_COLLECTION_BYTES {
            return Err(CoreError::from(
                "collection exceeds the 64 GiB extracted size safety limit",
            ));
        }
        let file_name = Path::new(&normalized)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("comic.cbr");
        // Keep legacy paths stable on reimport (IDs are derived from them).
        // New entries keep the original basename in an isolated directory.
        let legacy_target = target_dir.join(format!("{index:04}-{file_name}"));
        let target = if legacy_target.is_file() {
            legacy_target
        } else {
            let item_dir = target_dir.join(format!("{index:04}"));
            fs::create_dir_all(&item_dir)?;
            item_dir.join(file_name)
        };
        if !target.is_file() || fs::metadata(&target)?.len() != entry.size() {
            let temporary = target_dir.join(format!(".{index:04}.tmp"));
            let mut output = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&temporary)?;
            std::io::copy(&mut entry, &mut output)?;
            output.sync_all()?;
            drop(output);
            fs::rename(&temporary, &target)?;
        }
        nested_paths.push(target.to_string_lossy().into_owned());
    }

    if nested_paths.is_empty() {
        return Err(CoreError::from(
            "collection ZIP contains no CBR, CBZ, or PDF publications",
        ));
    }
    import_paths(db, &nested_paths)
}

fn import_sevenz(db: &LibraryDb, source_key: &str, path: &Path) -> CoreResult<NativePublication> {
    if let Some(existing) = db.find_by_source_path(source_key)? {
        return Ok(existing);
    }
    if fs::metadata(path)?.len() > MAX_ARCHIVE_BYTES {
        return Err(CoreError::from("7z exceeds the archive size safety limit"));
    }
    let publication_id = digest_id("publication", source_key.as_bytes());
    let parent = path
        .parent()
        .ok_or_else(|| CoreError::from("7z archive has no parent directory"))?;
    let extract_dir = parent.join(format!("7z-{publication_id}"));
    fs::create_dir_all(&extract_dir)?;
    let mut image_paths = Vec::new();
    let mut total_bytes = 0_u64;
    let extraction = sevenz_rust::decompress_file_with_extract_fn(
        path,
        &extract_dir,
        |entry, reader, _destination| {
            if entry.is_directory() {
                return Ok(true);
            }
            let normalized = validate_archive_name(entry.name())
                .map_err(|error| sevenz_rust::Error::other(error.to_string()))?;
            let extension = extension_from_name(&normalized).unwrap_or_default();
            if !is_image_extension(&extension) {
                copy(reader, &mut sink()).map_err(sevenz_rust::Error::io)?;
                return Ok(true);
            }
            if image_paths.len() >= MAX_PAGE_COUNT {
                return Err(sevenz_rust::Error::other(format!(
                    "7z exceeds the {MAX_PAGE_COUNT} page safety limit"
                )));
            }
            if entry.size() > MAX_PAGE_BYTES {
                return Err(sevenz_rust::Error::other(format!(
                    "7z page {normalized} exceeds the {} MiB page limit",
                    MAX_PAGE_BYTES / 1024 / 1024
                )));
            }
            total_bytes = total_bytes.saturating_add(entry.size());
            if total_bytes > MAX_TOTAL_UNCOMPRESSED_BYTES {
                return Err(sevenz_rust::Error::other(
                    "7z exceeds the total uncompressed size safety limit",
                ));
            }
            let file_name = Path::new(&normalized)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("page");
            let target = extract_dir.join(format!("{:04}-{file_name}", image_paths.len()));
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            reader
                .read_to_end(&mut bytes)
                .map_err(sevenz_rust::Error::io)?;
            validate_image(&bytes, &normalized)
                .map_err(|error| sevenz_rust::Error::other(error.to_string()))?;
            fs::write(&target, bytes).map_err(sevenz_rust::Error::io)?;
            image_paths.push(target);
            Ok(true)
        },
    );
    if let Err(error) = extraction {
        let _ = fs::remove_dir_all(&extract_dir);
        return Err(CoreError::from(format!("Unable to read 7z comic: {error}")));
    }
    if image_paths.is_empty() {
        let _ = fs::remove_dir_all(&extract_dir);
        return Err(CoreError::from(
            "7z contains no supported raster image pages",
        ));
    }
    image_paths.sort_by(|left, right| {
        let left_name = left
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let right_name = right
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        natural_compare(left_name, right_name).then_with(|| left.cmp(right))
    });
    let cache_dir = db.cache_dir().join(&publication_id);
    let title = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("Imported 7z")
        .to_owned();
    let source_label = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("7z archive")
        .to_owned();
    let publication = match build_image_publication(
        publication_id,
        source_key.to_owned(),
        title,
        source_label,
        image_paths,
        cache_dir.clone(),
    ) {
        Ok(publication) => publication,
        Err(error) => {
            let _ = fs::remove_dir_all(&extract_dir);
            let _ = fs::remove_dir_all(cache_dir);
            return Err(error);
        }
    };
    persist_publication(db, &publication, &cache_dir)
}

fn import_image_set(
    db: &LibraryDb,
    source_key: &str,
    mut paths: Vec<PathBuf>,
) -> CoreResult<NativePublication> {
    if let Some(existing) = db.find_by_source_path(source_key)? {
        return Ok(existing);
    }

    paths.sort_by(|left, right| {
        let left_name = left
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let right_name = right
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        natural_compare(left_name, right_name).then_with(|| left.cmp(right))
    });
    paths.dedup();
    if paths.len() > MAX_PAGE_COUNT {
        return Err(CoreError::from(format!(
            "image set exceeds the {} page safety limit",
            MAX_PAGE_COUNT
        )));
    }

    let title = paths
        .first()
        .and_then(|path| path.parent().and_then(Path::file_name))
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Imported pages")
        .to_owned();
    let source_label = if paths.len() == 1 {
        paths[0]
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("1 image file")
            .to_owned()
    } else {
        format!("{} raster image files", paths.len())
    };
    let publication_id = digest_id("publication", source_key.as_bytes());
    let cache_dir = db.cache_dir().join(&publication_id);
    let result = build_image_publication(
        publication_id,
        source_key.to_owned(),
        title,
        source_label,
        paths,
        cache_dir.clone(),
    );
    let publication = match result {
        Ok(publication) => publication,
        Err(error) => {
            let _ = fs::remove_dir_all(cache_dir);
            return Err(error);
        }
    };
    persist_publication(db, &publication, &cache_dir)
}

fn import_cbz(db: &LibraryDb, source_key: &str, path: &Path) -> CoreResult<NativePublication> {
    if let Some(existing) = db.find_by_source_path(source_key)? {
        return Ok(existing);
    }

    let publication_id = digest_id("publication", source_key.as_bytes());
    let cache_dir = db.cache_dir().join(&publication_id);
    let result = build_cbz_publication(
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
    persist_publication(db, &publication, &cache_dir)
}

pub(crate) fn persist_publication(
    db: &LibraryDb,
    publication: &NewPublication,
    cache_dir: &Path,
) -> CoreResult<NativePublication> {
    match db.insert_publication(publication) {
        Ok(publication) => Ok(publication),
        Err(error) => {
            let _ = fs::remove_dir_all(cache_dir);
            Err(error)
        }
    }
}

fn build_image_publication(
    publication_id: String,
    source_key: String,
    title: String,
    source_label: String,
    paths: Vec<PathBuf>,
    _cache_dir: PathBuf,
) -> CoreResult<NewPublication> {
    let mut pages = Vec::with_capacity(paths.len());
    let mut total_bytes = 0_u64;
    for (index, path) in paths.iter().enumerate() {
        let metadata = fs::metadata(path)?;
        if metadata.len() > MAX_PAGE_BYTES {
            return Err(CoreError::from(format!(
                "{} exceeds the {} MiB page limit",
                path.display(),
                MAX_PAGE_BYTES / 1024 / 1024
            )));
        }
        total_bytes = total_bytes.saturating_add(metadata.len());
        if total_bytes > MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(CoreError::from(
                "image set exceeds the total size safety limit",
            ));
        }
        let bytes = fs::read(path)?;
        let (width, height) = validate_image(&bytes, path.to_string_lossy().as_ref())?;
        let page_id = format!("{publication_id}-page-{index:04}");
        pages.push(NewPage {
            id: page_id,
            index,
            name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("page")
                .to_owned(),
            // The reader reconstructs the current working set on demand. Do
            // not duplicate an entire image directory during indexing.
            cache_path: PathBuf::new(),
            source_ref: PageSourceRef::Image {
                path: path.to_string_lossy().into_owned(),
            },
            width,
            height,
        });
    }

    new_publication(
        publication_id,
        title,
        source_label,
        source_key,
        "images".to_owned(),
        pages,
    )
}

fn build_cbz_publication(
    publication_id: String,
    source_key: String,
    path: &Path,
    _cache_dir: PathBuf,
) -> CoreResult<NewPublication> {
    let archive_size = fs::metadata(path)?.len();
    if archive_size > MAX_ARCHIVE_BYTES {
        return Err(CoreError::from("CBZ exceeds the archive size safety limit"));
    }
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut pages = Vec::new();
    let mut total_bytes = 0_u64;
    let mut seen_names = HashSet::new();

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let raw_name = entry.name().to_owned();
        let normalized_name = validate_archive_name(&raw_name)?;
        if entry.is_dir() {
            continue;
        }
        if entry.encrypted() {
            return Err(CoreError::from("encrypted CBZ entries are not supported"));
        }
        if !is_image_extension(&extension_from_name(&normalized_name).unwrap_or_default()) {
            continue;
        }
        if !seen_names.insert(normalized_name.to_lowercase()) {
            return Err(CoreError::from("CBZ contains duplicate page names"));
        }
        if pages.len() >= MAX_PAGE_COUNT {
            return Err(CoreError::from(format!(
                "CBZ exceeds the {} page safety limit",
                MAX_PAGE_COUNT
            )));
        }
        let entry_size = entry.size();
        if entry_size > MAX_PAGE_BYTES {
            return Err(CoreError::from(format!(
                "CBZ page {} exceeds the {} MiB page limit",
                normalized_name,
                MAX_PAGE_BYTES / 1024 / 1024
            )));
        }
        total_bytes = total_bytes.saturating_add(entry_size);
        if total_bytes > MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(CoreError::from(
                "CBZ exceeds the total uncompressed size safety limit",
            ));
        }
        let mut bytes = Vec::with_capacity(entry_size.min(MAX_PAGE_BYTES) as usize);
        entry.read_to_end(&mut bytes)?;
        let (width, height) = validate_image(&bytes, &normalized_name)?;
        let page_id = format!("{publication_id}-page-{:04}", pages.len());
        pages.push(NewPage {
            id: page_id,
            index: pages.len(),
            name: Path::new(&normalized_name)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&normalized_name)
                .to_owned(),
            // Indexing validates the archive but keeps no derived image
            // bytes. `ensure_page_cache` extracts only pages the reader uses.
            cache_path: PathBuf::new(),
            source_ref: PageSourceRef::Archive {
                path: path.to_string_lossy().into_owned(),
                member: normalized_name,
            },
            width,
            height,
        });
    }

    pages.sort_by(|left, right| natural_compare(&left.name, &right.name));
    for (index, page) in pages.iter_mut().enumerate() {
        page.index = index;
    }
    if pages.is_empty() {
        return Err(CoreError::from(
            "CBZ contains no supported raster image pages",
        ));
    }

    let title = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("Imported CBZ")
        .to_owned();
    let source_label = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("CBZ archive")
        .to_owned();
    new_publication(
        publication_id,
        title,
        source_label,
        source_key,
        "cbz".to_owned(),
        pages,
    )
}

pub(crate) fn new_publication(
    id: String,
    title: String,
    source_label: String,
    source_path: String,
    format: String,
    pages: Vec<NewPage>,
) -> CoreResult<NewPublication> {
    if pages.is_empty() {
        return Err(CoreError::from("publication contains no pages"));
    }
    let now = timestamp();
    let cover_page_id = pages[0].id.clone();
    Ok(NewPublication {
        id,
        title,
        source_label,
        source_path,
        format,
        pages,
        cover_page_id,
        current_page: 0,
        direction: "ltr".to_owned(),
        added_at: now.clone(),
        updated_at: now,
        diagnostic: None,
    })
}

pub(crate) fn validate_image(bytes: &[u8], label: &str) -> CoreResult<(u32, u32)> {
    if bytes.is_empty() {
        return Err(CoreError::from(format!("{label}: empty image")));
    }
    let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let (width, height) = reader.into_dimensions()?;
    if width == 0 || height == 0 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION {
        return Err(CoreError::from(format!(
            "{label}: image dimensions exceed the safety limit"
        )));
    }
    if u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err(CoreError::from(format!(
            "{label}: image pixel count exceeds the safety limit"
        )));
    }
    Ok((width, height))
}

pub(crate) fn cache_page(
    cache_dir: &Path,
    page_id: &str,
    extension: &str,
    bytes: &[u8],
) -> CoreResult<PathBuf> {
    if !is_single_path_component(page_id) || !is_image_extension(extension) {
        return Err(CoreError::from("invalid derived cache file name"));
    }
    fs::create_dir_all(cache_dir)?;
    let target = cache_dir.join(format!("{page_id}.{extension}"));
    let temporary = cache_dir.join(format!(
        ".{page_id}.{}.{}.tmp",
        std::process::id(),
        timestamp()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    let backup = cache_dir.join(format!(
        ".{page_id}.{}.{}.backup",
        std::process::id(),
        timestamp()
    ));
    if target.exists() {
        fs::rename(&target, &backup)?;
    }
    if let Err(error) = fs::rename(&temporary, &target) {
        let _ = fs::remove_file(&temporary);
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        return Err(error.into());
    }
    if backup.exists() {
        fs::remove_file(backup)?;
    }
    Ok(target)
}

#[allow(dead_code)]
pub(crate) fn rebuild_page(format: &str, source_ref: &PageSourceRef) -> CoreResult<RebuiltPage> {
    match (format, source_ref) {
        ("images", PageSourceRef::Image { path }) => rebuild_image_page(Path::new(path)),
        ("cbz", PageSourceRef::Archive { path, member }) => {
            rebuild_cbz_page(Path::new(path), member)
        }
        ("cbr", PageSourceRef::Archive { path, member }) => {
            crate::adapters::rebuild_cbr_page(Path::new(path), member)
        }
        ("pdf", PageSourceRef::Pdf { path, page_index }) => {
            crate::adapters::rebuild_pdf_page(Path::new(path), *page_index)
        }
        _ => Err(CoreError::from(
            "page source reference does not match the publication format",
        )),
    }
}

#[allow(dead_code)]
fn rebuild_image_page(path: &Path) -> CoreResult<RebuiltPage> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_PAGE_BYTES {
        return Err(CoreError::from(format!(
            "{} exceeds the {} MiB page limit",
            path.display(),
            MAX_PAGE_BYTES / 1024 / 1024
        )));
    }
    let bytes = fs::read(path)?;
    let (width, height) = validate_image(&bytes, path.to_string_lossy().as_ref())?;
    let extension = extension(path).ok_or_else(|| CoreError::from("image extension missing"))?;
    Ok(RebuiltPage {
        extension,
        bytes,
        width,
        height,
    })
}

#[allow(dead_code)]
fn rebuild_cbz_page(path: &Path, member: &str) -> CoreResult<RebuiltPage> {
    if fs::metadata(path)?.len() > MAX_ARCHIVE_BYTES {
        return Err(CoreError::from("CBZ exceeds the archive size safety limit"));
    }
    let normalized_member = validate_archive_name(member)?;
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        if entry.is_dir() || validate_archive_name(entry.name())? != normalized_member {
            continue;
        }
        if entry.encrypted() {
            return Err(CoreError::from("encrypted CBZ entries are not supported"));
        }
        if entry.size() > MAX_PAGE_BYTES {
            return Err(CoreError::from(format!(
                "CBZ page {normalized_member} exceeds the {} MiB page limit",
                MAX_PAGE_BYTES / 1024 / 1024
            )));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes)?;
        let (width, height) = validate_image(&bytes, &normalized_member)?;
        let extension = extension_from_name(&normalized_member)
            .ok_or_else(|| CoreError::from("CBZ image extension missing"))?;
        return Ok(RebuiltPage {
            extension,
            bytes,
            width,
            height,
        });
    }
    Err(CoreError::from(format!(
        "CBZ page source is missing: {normalized_member}"
    )))
}

fn is_single_path_component(value: &str) -> bool {
    let mut components = Path::new(value).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

fn canonicalize_input(raw_path: &str) -> CoreResult<PathBuf> {
    let path = PathBuf::from(raw_path);
    if !path.exists() {
        return Err(CoreError::from("path does not exist"));
    }
    Ok(path.canonicalize()?)
}

fn collect_publication_files(
    root: &Path,
    current: &Path,
    output: &mut Vec<PathBuf>,
) -> CoreResult<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let path = entry.path();
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_publication_files(root, &path, output)?;
            continue;
        }
        let file_extension = extension(&path).unwrap_or_default();
        if !file_type.is_file()
            || (!is_image_extension(&file_extension)
                && !matches!(
                    file_extension.as_str(),
                    "cbz" | "cbr" | "rar" | "7z" | "pdf" | "zip"
                ))
        {
            continue;
        }
        let canonical = path.canonicalize()?;
        if !canonical.starts_with(root) {
            return Err(CoreError::from(
                "publication path escaped the selected folder",
            ));
        }
        output.push(canonical);
    }
    Ok(())
}

pub(crate) fn validate_archive_name(raw_name: &str) -> CoreResult<String> {
    let normalized = raw_name.replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.as_bytes().get(1) == Some(&b':')
    {
        return Err(CoreError::from("archive contains an absolute page path"));
    }
    for component in Path::new(&normalized).components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(CoreError::from("archive contains a path traversal entry"));
            }
            Component::CurDir | Component::Normal(_) => {}
        }
    }
    Ok(normalized)
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_lowercase)
}

pub(crate) fn extension_from_name(name: &str) -> Option<String> {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_lowercase)
}

pub(crate) fn is_image_extension(extension: &str) -> bool {
    IMAGE_EXTENSIONS.contains(&extension)
}

fn source_key(prefix: &str, values: &[String]) -> String {
    let mut sorted = values.to_vec();
    sorted.sort();
    let joined = sorted.join("\n");
    format!("{prefix}:{}", digest_id("source", joined.as_bytes()))
}

pub(crate) fn digest_id(prefix: &str, bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{prefix}-{}", hex_encode(&digest[..12]))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

pub(crate) fn natural_compare(left: &str, right: &str) -> Ordering {
    let left = left.to_lowercase();
    let right = right.to_lowercase();
    let left_bytes = left.as_bytes();
    let right_bytes = right.as_bytes();
    let mut left_index = 0;
    let mut right_index = 0;

    while left_index < left_bytes.len() && right_index < right_bytes.len() {
        let left_digit = left_bytes[left_index].is_ascii_digit();
        let right_digit = right_bytes[right_index].is_ascii_digit();
        if left_digit && right_digit {
            let left_start = left_index;
            let right_start = right_index;
            while left_index < left_bytes.len() && left_bytes[left_index].is_ascii_digit() {
                left_index += 1;
            }
            while right_index < right_bytes.len() && right_bytes[right_index].is_ascii_digit() {
                right_index += 1;
            }
            let left_number = &left[left_start..left_index];
            let right_number = &right[right_start..right_index];
            let left_trimmed = left_number.trim_start_matches('0');
            let right_trimmed = right_number.trim_start_matches('0');
            let left_trimmed = if left_trimmed.is_empty() {
                "0"
            } else {
                left_trimmed
            };
            let right_trimmed = if right_trimmed.is_empty() {
                "0"
            } else {
                right_trimmed
            };
            let ordering = left_trimmed
                .len()
                .cmp(&right_trimmed.len())
                .then_with(|| left_trimmed.cmp(right_trimmed));
            if ordering != Ordering::Equal {
                return ordering;
            }
            continue;
        }

        let ordering = left_bytes[left_index].cmp(&right_bytes[right_index]);
        if ordering != Ordering::Equal {
            return ordering;
        }
        left_index += 1;
        right_index += 1;
    }

    left_bytes.len().cmp(&right_bytes.len())
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Cursor};

    use image::{DynamicImage, ImageFormat};
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    use super::*;

    fn test_comic_bytes() -> Vec<u8> {
        let mut png = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(3, 3).write_to(&mut png, ImageFormat::Png).expect("png");
        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for name in ["01.png", "02.png"] {
            archive.start_file(name, SimpleFileOptions::default()).expect("page entry");
            archive.write_all(png.get_ref()).expect("page bytes");
        }
        archive.finish().expect("comic").into_inner()
    }

    #[test]
    fn legacy_import_names_are_repaired_without_changing_sources_or_reading_data() {
        let root = std::env::temp_dir().join(format!("tactile-reader-legacy-names-{}", timestamp()));
        let app_dir = root.join("app");
        let database = LibraryDb::open(app_dir.clone()).expect("database");
        let original = test_comic_bytes();
        let paths: Vec<String> = [
            "imports/batch-1788979885761-684528334738766/0-Arqueiro Verde Absoluto #00.cbr",
            "imports/collection-collection-0123456789abcdef01234567/0000-Arqueiro Verde Absoluto #01.cbr",
            "imports/collection-collection-0123456789abcdef01234567/0001-Arqueiro Verde Absoluto #02.cbr",
            "imports/1788956256851-0-Batman Absoluto #01.cbz",
            "imports/batch-123-456/0/2000 AD #01.cbr",
        ].iter().map(|name| {
            let path = app_dir.join(name);
            fs::create_dir_all(path.parent().expect("parent")).expect("source directory");
            fs::write(&path, &original).expect("source");
            path.to_string_lossy().into_owned()
        }).collect();
        let imported = import_paths(&database, &paths).expect("import");
        assert!(imported.diagnostics.is_empty());
        let expected = ["Arqueiro Verde Absoluto #00", "Arqueiro Verde Absoluto #01", "Arqueiro Verde Absoluto #02", "Batman Absoluto #01", "2000 AD #01"];
        for (publication, title) in imported.publications.iter().zip(expected) {
            assert_eq!(publication.title, title);
            assert_eq!(Path::new(&publication.source_label).file_stem().unwrap().to_str(), Some(title));
            database.save_progress(&publication.id, 1).expect("progress");
            database.upsert_bookmark(&publication.id, &crate::models::NativeBookmark {
                page_id: publication.pages[1].id.clone(), label: "Minha página".into(), created_at: "1".into(), updated_at: "1".into(),
            }).expect("bookmark");
        }
        drop(database);
        let reopened = LibraryDb::open(app_dir).expect("reopen");
        let summaries = reopened.list_publications().expect("existing library");
        assert_eq!(summaries.len(), expected.len());
        let reimported = import_paths(&reopened, &paths).expect("reimport");
        for (before, after) in imported.publications.iter().zip(&reimported.publications) {
            assert_eq!(before.id, after.id);
            assert_eq!(before.title, after.title);
            assert_eq!(after.current_page, 1);
            assert_eq!(reopened.list_bookmarks(&after.id).expect("bookmarks")[0].page_id, before.pages[1].id);
            let summary = summaries.iter().find(|book| book.id == after.id).expect("summary");
            assert_eq!(summary.title, after.title);
            assert_eq!(summary.current_page, 1);
            assert_eq!(summary.source_label, after.source_label);
        }
        for path in paths { assert_eq!(fs::read(path).expect("unchanged source"), original); }
        drop(reopened);
        fs::remove_dir_all(root).expect("cleanup fixture");
    }

    #[test]
    fn collection_keeps_original_names_and_reuses_legacy_paths_on_reimport() {
        let root = std::env::temp_dir().join(format!("tactile-reader-collection-names-{}", timestamp()));
        fs::create_dir_all(&root).expect("root");
        let path = root.join("HQ.zip");
        let comic = test_comic_bytes();
        let mut archive = ZipWriter::new(File::create(&path).expect("collection"));
        for name in ["A/Arqueiro Verde Absoluto #01.cbr", "B/Arqueiro Verde Absoluto #01.cbr", "Batman Absoluto #00.cbz"] {
            archive.start_file(name, SimpleFileOptions::default()).expect("comic entry");
            archive.write_all(&comic).expect("comic bytes");
        }
        archive.finish().expect("finish collection");
        let path = path.canonicalize().expect("canonical source");
        let collection_id = digest_id("collection", path.to_string_lossy().as_bytes());
        let extracted = path.parent().unwrap().join(format!("collection-{collection_id}"));
        fs::create_dir_all(&extracted).expect("legacy directory");
        let legacy = extracted.join("0000-Arqueiro Verde Absoluto #01.cbr");
        fs::write(&legacy, &comic).expect("legacy entry");
        let database = LibraryDb::open(root.join("app")).expect("database");
        let existing = import_paths(&database, &[legacy.to_string_lossy().into_owned()]).expect("legacy import");
        let imported = import_paths(&database, &[path.to_string_lossy().into_owned()]).expect("collection import");
        assert!(imported.diagnostics.is_empty());
        assert_eq!(imported.publications.len(), 3);
        assert_eq!(imported.publications[0].id, existing.publications[0].id);
        assert_ne!(imported.publications[0].id, imported.publications[1].id);
        assert_eq!(imported.publications[0].title, "Arqueiro Verde Absoluto #01");
        assert_eq!(imported.publications[1].title, "Arqueiro Verde Absoluto #01");
        assert_eq!(imported.publications[2].title, "Batman Absoluto #00");
        assert!(extracted.join("0001/Arqueiro Verde Absoluto #01.cbr").is_file());
        assert!(extracted.join("0002/Batman Absoluto #00.cbz").is_file());
        assert_eq!(fs::read(legacy).expect("legacy source"), comic);
        assert_eq!(database.list_publications().expect("library").len(), 3);
        drop(database);
        fs::remove_dir_all(root).expect("cleanup fixture");
    }

    #[test]
    fn natural_order_keeps_page_two_before_page_ten() {
        let mut names = vec!["page10.png", "page2.png", "page1.png"];
        names.sort_by(|left, right| natural_compare(left, right));
        assert_eq!(names, vec!["page1.png", "page2.png", "page10.png"]);
    }

    #[test]
    fn archive_traversal_is_rejected() {
        assert!(validate_archive_name("../page.png").is_err());
        assert!(validate_archive_name("C:/page.png").is_err());
        assert!(validate_archive_name("pages/page.png").is_ok());
    }

    #[test]
    fn comic_archive_detection_uses_bytes_instead_of_the_extension() {
        let root = std::env::temp_dir().join(format!("tactile-reader-signature-{}", timestamp()));
        fs::create_dir_all(&root).expect("test directory");
        let zip_named_cbr = root.join("actually-a-zip.cbr");
        let rar_named_cbz = root.join("actually-a-rar.cbz");
        let sevenz_named_cbr = root.join("actually-a-7z.cbr");
        let invalid = root.join("invalid.cbr");
        fs::write(&zip_named_cbr, b"PK\x03\x04payload").expect("zip signature");
        fs::write(&rar_named_cbz, b"Rar!\x1a\x07\x01\x00payload").expect("rar signature");
        fs::write(&sevenz_named_cbr, b"7z\xBC\xAF\x27\x1C\x00\x00").expect("7z signature");
        fs::write(&invalid, b"not an archive").expect("invalid signature");

        assert_eq!(
            detect_comic_archive_container(&zip_named_cbr).expect("detect zip"),
            ComicArchiveContainer::Zip
        );
        assert_eq!(
            detect_comic_archive_container(&rar_named_cbz).expect("detect rar"),
            ComicArchiveContainer::Rar
        );
        assert_eq!(
            detect_comic_archive_container(&sevenz_named_cbr).expect("detect 7z"),
            ComicArchiveContainer::SevenZip
        );
        assert_eq!(
            detect_comic_archive_container(&invalid).expect("detect unknown"),
            ComicArchiveContainer::Unknown
        );
        fs::remove_dir_all(root).expect("cleanup test directory");
    }

    #[test]
    fn image_set_is_read_only_and_deduplicated() {
        let root = std::env::temp_dir().join(format!("tactile-reader-import-{}", timestamp()));
        let source_dir = root.join("source");
        let app_dir = root.join("app");
        fs::create_dir_all(&source_dir).expect("source directory");

        let mut first_bytes = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(2, 3)
            .write_to(&mut first_bytes, ImageFormat::Png)
            .expect("first png");
        let mut second_bytes = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(4, 5)
            .write_to(&mut second_bytes, ImageFormat::Png)
            .expect("second png");
        let first_path = source_dir.join("page10.png");
        let second_path = source_dir.join("page2.png");
        fs::write(&first_path, first_bytes.into_inner()).expect("write first png");
        fs::write(&second_path, second_bytes.into_inner()).expect("write second png");
        let original = fs::read(&first_path).expect("read original");

        let database = LibraryDb::open(app_dir.clone()).expect("database");
        let selected = vec![source_dir.to_string_lossy().into_owned()];
        let first_import = import_paths(&database, &selected).expect("first import");
        let first_publication = &first_import.publications[0];
        assert_eq!(first_publication.pages[0].name, "page2.png");
        assert_eq!(first_publication.pages[1].name, "page10.png");
        assert_eq!(
            first_publication.source_names,
            vec!["page2.png".to_owned(), "page10.png".to_owned()]
        );
        assert_eq!(
            first_publication.pages[0].source_ref,
            Some(crate::models::PageSourceRef::Image {
                path: second_path
                    .canonicalize()
                    .expect("canonical second page")
                    .to_string_lossy()
                    .into_owned(),
            })
        );
        assert!(first_publication
            .pages
            .iter()
            .all(|page| page.cache_path.is_empty()));
        assert_eq!(
            database.cache_info().expect("empty cache info").entry_count,
            0
        );
        let rebuilt = database
            .ensure_page_cache(&first_publication.id, &first_publication.pages[0].id)
            .expect("rebuild image page");
        assert!(Path::new(&rebuilt.cache_path).is_file());
        assert_eq!(
            database
                .cache_info()
                .expect("cache info after rebuild")
                .entry_count,
            1
        );

        database
            .save_progress(&first_publication.id, 1)
            .expect("save progress");
        let second_import = import_paths(&database, &selected).expect("deduplicated import");
        assert_eq!(second_import.publications[0].id, first_publication.id);
        assert_eq!(
            database.list_publications().expect("list")[0].current_page,
            1
        );
        assert_eq!(
            fs::read(&first_path).expect("read source after import"),
            original
        );

        drop(database);
        let reopened = LibraryDb::open(app_dir).expect("reopened database");
        assert_eq!(
            reopened.list_publications().expect("reopened list")[0].current_page,
            1
        );
        let after_restart = import_paths(&reopened, &selected).expect("reopened deduplication");
        assert_eq!(after_restart.publications[0].id, first_publication.id);
        assert_eq!(
            after_restart.publications[0].source_names,
            vec!["page2.png".to_owned(), "page10.png".to_owned()]
        );
        drop(reopened);
        fs::remove_dir_all(root).expect("cleanup test directory");
    }

    #[test]
    fn zip_comic_with_cbr_extension_imports_and_is_natural_ordered() {
        let root = std::env::temp_dir().join(format!("tactile-reader-cbz-{}", timestamp()));
        fs::create_dir_all(&root).expect("test directory");
        let mut image_bytes = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(3, 3)
            .write_to(&mut image_bytes, ImageFormat::Png)
            .expect("png");
        let image_bytes = image_bytes.into_inner();

        let archive_path = root.join("ordered.cbr");
        let archive_file = fs::File::create(&archive_path).expect("archive file");
        let mut archive = ZipWriter::new(archive_file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        archive.start_file("page10.png", options).expect("page ten");
        std::io::Write::write_all(&mut archive, &image_bytes).expect("page ten bytes");
        archive.start_file("page2.png", options).expect("page two");
        std::io::Write::write_all(&mut archive, &image_bytes).expect("page two bytes");
        archive.finish().expect("finish archive");

        let database = LibraryDb::open(root.join("app")).expect("database");
        let imported = import_paths(&database, &[archive_path.to_string_lossy().into_owned()])
            .expect("ZIP-backed CBR import")
            .publications;
        assert_eq!(imported[0].format, "cbz");
        assert_eq!(imported[0].pages[0].name, "page2.png");
        assert_eq!(imported[0].pages[1].name, "page10.png");
        assert_eq!(
            imported[0].pages[0].source_ref,
            Some(crate::models::PageSourceRef::Archive {
                path: archive_path
                    .canonicalize()
                    .expect("canonical archive")
                    .to_string_lossy()
                    .into_owned(),
                member: "page2.png".to_owned(),
            })
        );
        assert!(imported[0]
            .pages
            .iter()
            .all(|page| page.cache_path.is_empty()));
        assert_eq!(
            database.cache_info().expect("empty cache info").entry_count,
            0
        );
        let rebuilt = database
            .ensure_page_cache(&imported[0].id, &imported[0].pages[0].id)
            .expect("rebuild CBZ page");
        assert_eq!(
            fs::read(rebuilt.cache_path).expect("rebuilt CBZ page"),
            image_bytes
        );

        let malicious_path = root.join("malicious.cbz");
        let malicious_file = fs::File::create(&malicious_path).expect("malicious archive file");
        let mut malicious = ZipWriter::new(malicious_file);
        malicious
            .start_file("../escape.png", options)
            .expect("traversal entry");
        std::io::Write::write_all(&mut malicious, &image_bytes).expect("traversal bytes");
        malicious.finish().expect("finish malicious archive");
        let result = import_paths(&database, &[malicious_path.to_string_lossy().into_owned()])
            .expect("diagnostic result");
        assert!(result.publications.is_empty());
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.contains("traversal")));

        drop(database);
        fs::remove_dir_all(root).expect("cleanup test directory");
    }
}
