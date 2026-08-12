# PDFium runtime provenance

This directory contains the Windows x64 runtime used by the native PDF importer.

- Upstream distribution: `bblanchon/pdfium-binaries`
- Release: `chromium/7881` (`PDFium 151.0.7881.0`)
- Asset: `pdfium-win-x64.tgz`
- Archive SHA-256: `73cc0de638ac2095e7445bf56a38200a5b7c7ca0e9f4ba144598f2457377ac08`
- Extracted DLL SHA-256: `79d4676b656cfb1abcea88f9ade3b4b0826c5200382db5f4ec72a636c598c118`

The pinned release matches the `pdfium_7881` ABI feature configured in `Cargo.toml`.
License notices from the distribution are retained in `../licenses/pdfium/`.
