package com.jrmello4.tactilereader.core

import android.os.ParcelFileDescriptor
import com.jrmello4.tactilereader.pdf.PdfImporter
import java.io.File

/** Indexes PDF page metadata and renders each page only when requested. */
internal object PdfPublicationImporter {
    fun importPublication(db: LibraryDb, source: ImportSource): Pub {
        val opener = db.opener
        val size = opener.sizeBytes(source.reference)
        if (size > MAX_ARCHIVE_BYTES) error("PDF exceeds the supported source size")
        val sourceKey = pdfSourceKey(
            source.reference,
            size,
            opener.lastModifiedMillis(source.reference),
        )
        db.publications.findBySourcePath(sourceKey)?.let { return it }

        val pageDimensions = withDescriptor(db, source.reference) { PdfImporter.inspect(it) }
        if (pageDimensions.isEmpty() || pageDimensions.size > MAX_PAGE_COUNT) {
            error("PDF exceeds the $MAX_PAGE_COUNT page safety limit")
        }
        val publicationId = digestId("publication", sourceKey.toByteArray())
        val pages = pageDimensions.mapIndexed { index, dimensions ->
            PublicationRepository.NewPage(
                id = "$publicationId-page-%04d".format(index),
                index = index,
                name = "page-%04d.pdf".format(index + 1),
                cachePath = File(""),
                sourceRef = PageSourceRef.Pdf(source.reference, index),
                width = dimensions.width,
                height = dimensions.height,
            )
        }
        return Importer.persist(
            db,
            PublicationRepository.NewPublication(
                id = publicationId,
                title = Importer.stemOf(source.name(opener)).ifBlank { "Imported PDF" },
                sourceLabel = source.name(opener),
                sourcePath = sourceKey,
                format = "pdf",
                pages = pages,
                coverPageId = pages.first().id,
                addedAt = timestampMillis(),
                updatedAt = timestampMillis(),
            ),
        )
    }

    fun rebuildPage(db: LibraryDb, reference: String, pageIndex: Int): Importer.RebuiltPage {
        val opener = db.opener
        if (!opener.isAvailable(reference)) error("PDF source is missing: $reference")
        if (opener.sizeBytes(reference) > MAX_ARCHIVE_BYTES) error("PDF exceeds the supported source size")
        val bitmap = withDescriptor(db, reference) { PdfImporter.renderPage(it, pageIndex) }
        try {
            val bytes = java.io.ByteArrayOutputStream().use { output ->
                if (!bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)) {
                    error("Unable to encode rendered PDF page")
                }
                output.toByteArray()
            }
            return Importer.RebuiltPage("png", bytes, bitmap.width, bitmap.height)
        } finally {
            bitmap.recycle()
        }
    }

    private inline fun <T> withDescriptor(
        db: LibraryDb,
        reference: String,
        block: (ParcelFileDescriptor) -> T,
    ): T {
        val descriptor = db.opener.openFileDescriptor(reference)
        if (descriptor != null) return descriptor.use(block)
        val temp = spoolSourceToTemp(db, reference, "pdf")
        return try {
            ParcelFileDescriptor.open(temp, ParcelFileDescriptor.MODE_READ_ONLY).use(block)
        } finally {
            temp.delete()
        }
    }
}
