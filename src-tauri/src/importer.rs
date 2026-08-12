use std::{
    cmp::Ordering,
    collections::HashSet,
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
};

use image::ImageReader;
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::{
    db::LibraryDb,
    error::{CoreError, CoreResult},
    models::{NativeImportResult, NativePublication, NewPage, NewPublication},
};

pub(crate) const MAX_PAGE_BYTES: u64 = 64 * 1024 * 1024;
pub(crate) const MAX_ARCHIVE_BYTES: u64 = 1024 * 1024 * 1024;
pub(crate) const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const MAX_PAGE_COUNT: usize = 1024;
pub(crate) const MAX_IMAGE_DIMENSION: u32 = 20_000;
pub(crate) const MAX_IMAGE_PIXELS: u64 = 100_000_000;

const IMAGE_EXTENSIONS: &[&str] = &["avif", "gif", "jpeg", "jpg", "png", "webp"];

pub fn import_paths(db: &LibraryDb, raw_paths: &[String]) -> CoreResult<NativeImportResult> {
    let mut image_paths = Vec::new();
    let mut image_sources = Vec::new();
    let mut archive_paths = Vec::new();
    let mut cbr_paths = Vec::new();
    let mut pdf_paths = Vec::new();
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
            if let Err(error) = collect_image_files(&path, &path, &mut files) {
                diagnostics.push(format!("{}: {error}", path.display()));
                continue;
            }
            if files.is_empty() {
                diagnostics.push(format!(
                    "{}: no supported raster images were found.",
                    path.display()
                ));
                continue;
            }
            image_sources.push(format!("directory:{}", path.display()));
            image_paths.extend(files);
            continue;
        }

        match extension(&path).as_deref() {
            Some(extension) if is_image_extension(extension) => {
                image_sources.push(format!("image:{}", path.display()));
                image_paths.push(path);
            }
            Some("cbz") => archive_paths.push(path),
            Some("cbr") => cbr_paths.push(path),
            Some("pdf") => pdf_paths.push(path),
            _ => diagnostics.push(format!("{}: unsupported publication file.", path.display())),
        }
    }

    let mut publications = Vec::new();
    if !image_paths.is_empty() {
        let source_key = source_key("images", &image_sources);
        match import_image_set(db, &source_key, image_paths) {
            Ok(publication) => publications.push(publication),
            Err(error) => diagnostics.push(format!("image set: {error}")),
        }
    }

    for path in archive_paths {
        let source_key = format!("archive:{}", path.display());
        match import_cbz(db, &source_key, &path) {
            Ok(publication) => publications.push(publication),
            Err(error) => diagnostics.push(format!("{}: {error}", path.display())),
        }
    }

    for path in cbr_paths {
        let source_key = format!("cbr:{}", path.display());
        match crate::adapters::import_cbr(db, &source_key, &path) {
            Ok(publication) => publications.push(publication),
            Err(error) => diagnostics.push(format!("{}: {error}", path.display())),
        }
    }

    for path in pdf_paths {
        let source_key = format!("pdf:{}", path.display());
        match crate::adapters::import_pdf(db, &source_key, &path) {
            Ok(publication) => publications.push(publication),
            Err(error) => diagnostics.push(format!("{}: {error}", path.display())),
        }
    }

    Ok(NativeImportResult {
        publications,
        diagnostics,
    })
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
    cache_dir: PathBuf,
) -> CoreResult<NewPublication> {
    fs::create_dir_all(&cache_dir)?;
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
        let extension =
            extension(path).ok_or_else(|| CoreError::from("image extension missing"))?;
        let page_id = format!("{publication_id}-page-{index:04}");
        let cache_path = cache_page(&cache_dir, &page_id, &extension, &bytes)?;
        pages.push(NewPage {
            id: page_id,
            index,
            name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("page")
                .to_owned(),
            cache_path,
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
    cache_dir: PathBuf,
) -> CoreResult<NewPublication> {
    let archive_size = fs::metadata(path)?.len();
    if archive_size > MAX_ARCHIVE_BYTES {
        return Err(CoreError::from("CBZ exceeds the archive size safety limit"));
    }
    fs::create_dir_all(&cache_dir)?;

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
        let extension = extension_from_name(&normalized_name)
            .ok_or_else(|| CoreError::from("CBZ image extension missing"))?;
        let page_id = format!("{publication_id}-page-{:04}", pages.len());
        let cache_path = cache_page(&cache_dir, &page_id, &extension, &bytes)?;
        pages.push(NewPage {
            id: page_id,
            index: pages.len(),
            name: Path::new(&normalized_name)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&normalized_name)
                .to_owned(),
            cache_path,
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
    fs::create_dir_all(cache_dir)?;
    let target = cache_dir.join(format!("{page_id}.{extension}"));
    let temporary = cache_dir.join(format!(".{page_id}.tmp"));
    let mut file = File::create(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(&temporary, &target)?;
    Ok(target)
}

fn canonicalize_input(raw_path: &str) -> CoreResult<PathBuf> {
    let path = PathBuf::from(raw_path);
    if !path.exists() {
        return Err(CoreError::from("path does not exist"));
    }
    Ok(path.canonicalize()?)
}

fn collect_image_files(root: &Path, current: &Path, output: &mut Vec<PathBuf>) -> CoreResult<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let path = entry.path();
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_image_files(root, &path, output)?;
            continue;
        }
        if !file_type.is_file() || !is_image_extension(&extension(&path).unwrap_or_default()) {
            continue;
        }
        let canonical = path.canonicalize()?;
        if !canonical.starts_with(root) {
            return Err(CoreError::from("image path escaped the selected folder"));
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
        assert!(Path::new(&first_publication.pages[0].cache_path).exists());

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
        drop(reopened);
        fs::remove_dir_all(root).expect("cleanup test directory");
    }

    #[test]
    fn cbz_import_is_natural_ordered_and_rejects_traversal() {
        let root = std::env::temp_dir().join(format!("tactile-reader-cbz-{}", timestamp()));
        fs::create_dir_all(&root).expect("test directory");
        let mut image_bytes = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(3, 3)
            .write_to(&mut image_bytes, ImageFormat::Png)
            .expect("png");
        let image_bytes = image_bytes.into_inner();

        let archive_path = root.join("ordered.cbz");
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
            .expect("CBZ import")
            .publications;
        assert_eq!(imported[0].format, "cbz");
        assert_eq!(imported[0].pages[0].name, "page2.png");
        assert_eq!(imported[0].pages[1].name, "page10.png");

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
