use std::{
    collections::HashSet,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use image::{DynamicImage, ImageFormat};
use pdfium_render::prelude::{PdfPageRenderRotation, PdfRenderConfig, Pdfium};
use unrar::Archive;

use crate::{
    db::LibraryDb,
    error::{CoreError, CoreResult},
    importer,
    models::{NativePublication, NewPage, NewPublication, PageSourceRef},
};

const PDF_RENDER_WIDTH: i32 = 1600;
const PDF_RENDER_MAX_HEIGHT: i32 = 2400;
const MAX_DOCUMENT_BYTES: u64 = 1024 * 1024 * 1024;

static PDFIUM_BINDINGS: OnceLock<Result<(), String>> = OnceLock::new();
static PDFIUM_RESOURCE_PATH: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn configure_pdfium_resource_path(path: PathBuf) {
    let _ = PDFIUM_RESOURCE_PATH.set(path);
}

pub(crate) fn import_pdf(
    db: &LibraryDb,
    source_key: &str,
    path: &Path,
) -> CoreResult<NativePublication> {
    if let Some(existing) = db.find_by_source_path(source_key)? {
        return Ok(existing);
    }
    validate_document_size(path, "PDF")?;

    let publication_id = importer::digest_id("publication", source_key.as_bytes());
    let cache_dir = db.cache_dir().join(&publication_id);
    let result = build_pdf_publication(
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

fn validate_document_size(path: &Path, format: &str) -> CoreResult<()> {
    let size = fs::metadata(path)?.len();
    if size > MAX_DOCUMENT_BYTES {
        return Err(CoreError::from(format!(
            "{format} exceeds the {} GiB document size safety limit",
            MAX_DOCUMENT_BYTES / 1024 / 1024 / 1024
        )));
    }
    Ok(())
}

fn ensure_pdfium() -> CoreResult<()> {
    let result = PDFIUM_BINDINGS.get_or_init(|| {
        let mut errors = Vec::new();
        for candidate in pdfium_library_candidates() {
            if !candidate.is_file() {
                errors.push(format!("{}: file not found", candidate.display()));
                continue;
            }
            match Pdfium::bind_to_library(&candidate) {
                Ok(bindings) => {
                    let _ = Pdfium::new(bindings);
                    return Ok(());
                }
                Err(error) => errors.push(format!("{}: {error:?}", candidate.display())),
            }
        }

        match Pdfium::bind_to_system_library() {
            Ok(bindings) => {
                let _ = Pdfium::new(bindings);
                Ok(())
            }
            Err(error) => {
                errors.push(format!("system library: {error:?}"));
                Err(errors.join("; "))
            }
        }
    });

    result.as_ref().map(|_| ()).map_err(|detail| {
        CoreError::AdapterUnavailable(format!(
            "PDFium runtime not found. Place pdfium.dll beside the application or install a system PDFium library. {detail}"
        ))
    })
}

fn pdfium_library_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = PDFIUM_RESOURCE_PATH.get() {
        candidates.push(path.clone());
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            candidates.push(Pdfium::pdfium_platform_library_name_at_path(directory));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("pdfium")
            .join(Pdfium::pdfium_platform_library_name()),
    );
    candidates.dedup();
    candidates
}

fn build_pdf_publication(
    publication_id: String,
    source_key: String,
    path: &Path,
    cache_dir: PathBuf,
) -> CoreResult<NewPublication> {
    ensure_pdfium()?;
    fs::create_dir_all(&cache_dir)?;

    let pdfium = Pdfium::default();
    let document = pdfium
        .load_pdf_from_file(path, None)
        .map_err(|error| CoreError::Pdfium(format!("{error:?}")))?;
    let page_count = document.pages().len() as usize;
    if page_count == 0 {
        return Err(CoreError::from("PDF contains no pages"));
    }
    if page_count > importer::MAX_PAGE_COUNT {
        return Err(CoreError::from(format!(
            "PDF exceeds the {} page safety limit",
            importer::MAX_PAGE_COUNT
        )));
    }

    let render_config = PdfRenderConfig::new()
        .set_target_width(PDF_RENDER_WIDTH)
        .set_maximum_height(PDF_RENDER_MAX_HEIGHT)
        .rotate_if_landscape(PdfPageRenderRotation::Degrees90, true);
    let mut pages = Vec::with_capacity(page_count);
    let mut total_bytes = 0_u64;

    for (index, page) in document.pages().iter().enumerate() {
        let rendered = page
            .render_with_config(&render_config)
            .map_err(|error| CoreError::Pdfium(format!("{error:?}")))?
            .as_image()
            .map_err(|error| CoreError::Pdfium(format!("{error:?}")))?;
        let width = rendered.width();
        let height = rendered.height();
        let bytes = encode_png(rendered)?;
        if bytes.len() as u64 > importer::MAX_PAGE_BYTES {
            return Err(CoreError::from(format!(
                "PDF page {} exceeds the {} MiB page limit",
                index + 1,
                importer::MAX_PAGE_BYTES / 1024 / 1024
            )));
        }
        total_bytes = total_bytes.saturating_add(bytes.len() as u64);
        if total_bytes > importer::MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(CoreError::from(
                "PDF exceeds the total rendered page size safety limit",
            ));
        }
        let (validated_width, validated_height) =
            importer::validate_image(&bytes, &format!("PDF page {}", index + 1))?;
        if validated_width != width || validated_height != height {
            return Err(CoreError::from(
                "PDF renderer returned inconsistent page dimensions",
            ));
        }

        let page_id = format!("{publication_id}-page-{index:04}");
        let cache_path = importer::cache_page(&cache_dir, &page_id, "png", &bytes)?;
        pages.push(NewPage {
            id: page_id,
            index,
            name: format!("page-{index:04}.png"),
            cache_path,
            source_ref: PageSourceRef::Pdf {
                path: path.to_string_lossy().into_owned(),
                page_index: index,
            },
            width,
            height,
        });
    }

    let title = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("Imported PDF")
        .to_owned();
    let source_label = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("PDF document")
        .to_owned();
    importer::new_publication(
        publication_id,
        title,
        source_label,
        source_key,
        "pdf".to_owned(),
        pages,
    )
}

fn encode_png(image: DynamicImage) -> CoreResult<Vec<u8>> {
    let mut cursor = Cursor::new(Vec::new());
    image.write_to(&mut cursor, ImageFormat::Png)?;
    Ok(cursor.into_inner())
}

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

// Called by the staged cache command API introduced after this persistence task.
#[allow(dead_code)]
pub(crate) fn rebuild_pdf_page(
    path: &Path,
    page_index: usize,
) -> CoreResult<importer::RebuiltPage> {
    validate_document_size(path, "PDF")?;
    ensure_pdfium()?;
    let pdfium = Pdfium::default();
    let document = pdfium
        .load_pdf_from_file(path, None)
        .map_err(|error| CoreError::Pdfium(format!("{error:?}")))?;
    let pdf_page_index =
        i32::try_from(page_index).map_err(|_| CoreError::from("PDF page index is out of range"))?;
    let page = document
        .pages()
        .get(pdf_page_index)
        .map_err(|_| CoreError::from("PDF page source is missing"))?;
    let rendered = page
        .render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(PDF_RENDER_WIDTH)
                .set_maximum_height(PDF_RENDER_MAX_HEIGHT)
                .rotate_if_landscape(PdfPageRenderRotation::Degrees90, true),
        )
        .map_err(|error| CoreError::Pdfium(format!("{error:?}")))?
        .as_image()
        .map_err(|error| CoreError::Pdfium(format!("{error:?}")))?;
    let bytes = encode_png(rendered)?;
    if bytes.len() as u64 > importer::MAX_PAGE_BYTES {
        return Err(CoreError::from(format!(
            "PDF page {} exceeds the {} MiB page limit",
            page_index + 1,
            importer::MAX_PAGE_BYTES / 1024 / 1024
        )));
    }
    let (width, height) = importer::validate_image(&bytes, "rebuilt PDF page")?;
    Ok(importer::RebuiltPage {
        extension: "png".to_owned(),
        bytes,
        width,
        height,
    })
}

#[allow(dead_code)]
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

    #[test]
    fn bundled_pdfium_imports_real_pdf_fixture() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("tactile-reader-sample.pdf");
        assert!(fixture.is_file(), "test PDF fixture must be present");

        let root = test_root("pdfium-fixture");
        let database = LibraryDb::open(root.join("app")).expect("database");
        let result = importer::import_paths(&database, &[fixture.to_string_lossy().into_owned()])
            .expect("PDF import result");

        assert!(result.diagnostics.is_empty(), "{:#?}", result.diagnostics);
        let publication = result
            .publications
            .first()
            .expect("imported PDF publication");
        assert_eq!(publication.format, "pdf");
        assert_eq!(publication.pages.len(), 2);
        assert_eq!(
            publication.pages[0].source_ref,
            Some(crate::models::PageSourceRef::Pdf {
                path: fixture
                    .canonicalize()
                    .expect("canonical PDF")
                    .to_string_lossy()
                    .into_owned(),
                page_index: 0,
            })
        );
        assert!(publication.pages.iter().all(|page| {
            Path::new(&page.cache_path).is_file() && page.width > 0 && page.height > 0
        }));
        let cached_path = publication.pages[0].cache_path.clone();
        fs::remove_file(&cached_path).expect("remove derived PDF page");
        let rebuilt = database
            .ensure_page_cache(&publication.id, &publication.pages[0].id)
            .expect("rebuild PDF page");
        assert!(Path::new(&rebuilt.cache_path).is_file());
        assert_eq!(
            (rebuilt.width, rebuilt.height),
            (publication.pages[0].width, publication.pages[0].height)
        );

        drop(database);
        fs::remove_dir_all(root).expect("cleanup test directory");
    }
}
