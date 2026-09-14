//! Desktop PDF backend (pdfium) plugged into the portable core.
//!
//! `tactile-core` owns the library/import pipeline but never links a PDF
//! runtime; this module registers pdfium as its PDF backend at startup. The
//! future native Android app registers its own backend (or none) instead.

use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use image::{DynamicImage, ImageFormat};
use pdfium_render::prelude::{PdfPageRenderRotation, PdfRenderConfig, Pdfium};
use tactile_core::{
    archive,
    db::LibraryDb,
    error::{CoreError, CoreResult},
    importer,
    models::{NativePublication, NewPage, NewPublication, PageSourceRef},
};

const PDF_RENDER_WIDTH: i32 = 1600;
const PDF_RENDER_MAX_HEIGHT: i32 = 2400;

static PDFIUM_BINDINGS: OnceLock<Result<(), String>> = OnceLock::new();
static PDFIUM_RESOURCE_PATH: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn configure_pdfium_resource_path(path: PathBuf) {
    let _ = PDFIUM_RESOURCE_PATH.set(path);
}

/// Plugs pdfium into the core import pipeline. Idempotent.
pub(crate) fn register_backend() {
    archive::set_pdf_backend(import_pdf, rebuild_pdf_page);
}

fn import_pdf(db: &LibraryDb, source_key: &str, path: &Path) -> CoreResult<NativePublication> {
    if let Some(existing) = db.find_by_source_path(source_key)? {
        return Ok(existing);
    }
    archive::validate_document_size(path, "PDF")?;

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
    pdfium_library_candidates_for(cfg!(debug_assertions))
}

/// `CARGO_MANIFEST_DIR` is baked in when the crate is compiled, so the
/// source-tree copy is only a sensible candidate while developing. Shipping it
/// would put the build machine's absolute path in the released binary and let a
/// developer machine silently satisfy an import that a reader's machine could
/// not, which is exactly the failure the installer smoke test has to observe.
fn pdfium_library_candidates_for(include_source_tree: bool) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = PDFIUM_RESOURCE_PATH.get() {
        candidates.push(path.clone());
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            candidates.push(Pdfium::pdfium_platform_library_name_at_path(directory));
        }
    }
    if include_source_tree {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("pdfium")
                .join(Pdfium::pdfium_platform_library_name()),
        );
    }
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

// Called by the staged cache command API introduced after this persistence task.
#[allow(dead_code)]
fn rebuild_pdf_page(path: &Path, page_index: usize) -> CoreResult<importer::RebuiltPage> {
    archive::validate_document_size(path, "PDF")?;
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

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    #[test]
    fn a_released_build_never_looks_for_pdfium_in_the_build_machine_source_tree() {
        let source_tree = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");

        let development = pdfium_library_candidates_for(true);
        assert!(
            development
                .iter()
                .any(|candidate| candidate.starts_with(&source_tree)),
            "a development build should still find the checked-in runtime"
        );

        let released = pdfium_library_candidates_for(false);
        assert!(
            !released
                .iter()
                .any(|candidate| candidate.starts_with(&source_tree)),
            "a released build must not depend on the machine that built it"
        );
        assert!(
            !released.is_empty(),
            "a released build still resolves the bundled and side-by-side runtimes"
        );
    }

    fn test_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("tactile-reader-{label}-{suffix}"))
    }

    #[test]
    fn bundled_pdfium_imports_real_pdf_fixture() {
        register_backend();
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
            Some(tactile_core::models::PageSourceRef::Pdf {
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
