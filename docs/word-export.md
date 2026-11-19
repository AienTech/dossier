# Word export

The **Download PDF** button's arrow offers **Word (.docx)** for the base
resume, tailored resumes and cover letters. PDF remains the default. Word
documents contain editable text, links and lists, with embedded fonts, so
they can be adjusted manually before sending. Settings → **Document file
name** supplies the same naming pattern for PDF and Word.

The PDF and browser preview remain the layout reference. Word and Chromium
wrap lines and paginate differently; identical page counts are not promised.
Microsoft Word for Windows is the primary target. Do not assume equivalent
rendering in Word for Mac, web/mobile Word, LibreOffice or Google Docs.

## Content and layout

- Base resumes use the current profile, section settings and theme. Tailored
  documents use their saved units, including the content retained after PDF
  trimming, not regenerated text.
- Export respects section order, hidden sections, custom headings,
  certifications, volunteering, custom sections, references and photo rules.
  Sent applications use the same frozen profile, theme, paper and date
  settings as their PDF.
- **Fit to one page shares formatting between PDF and Word.** For the base
  resume, PDF measurement selects the first fitting compression level (or
  the tightest available), and Word uses the same margins, gaps, line height
  and body size. Nothing is removed. With fitting off, Word uses normal theme
  spacing and does not need PDF rendering. Word pages are not measured, so a
  one-page PDF does not guarantee a one-page Word document. The preview is
  labelled PDF preview; the Word export menu explains the pagination caveat.
- Layout tables preserve sidebars, side headings and timeline layouts.
  Long tables may paginate differently from the PDF's independent columns.
- Circle and rounded-square photos are masked locally with `sharp`. If the
  image cannot be processed, export falls back to a rectangular crop. WebP
  photos are converted to PNG for every shape; unconvertible WebP is omitted.
- Downloading Word does not change the document or its history. Email
  attachments, bulk PDF downloads and backups retain their existing formats.

## Implementation and fonts

`src/lib/document-prep.ts` shares plain content preparation between the React
and native TypeScript DOCX renderers. `src/lib/docx/` uses pinned `docx@9.15.1`
(MIT); it does not convert HTML or PDF, upload data, or call an AI service.
`GET /api/docx?doc=base`, `?doc=resume&application={id}` and
`?doc=letter&application={id}` require the existing session and same-origin
checks, with private/no-store download responses. No schema migration is
needed.

Generated TrueType faces in `src/fonts/word/` are production assets, not test
artifacts. They come from the same static WOFF2 faces as the browser/PDF,
retain their licence metadata, and use renamed derived families where OFL
Reserved Font Names require it. See [font provenance and rebuild
instructions](../src/fonts/README.md#word-export-fonts). Production tracing
and desktop packaging include them for offline use. No fonts are downloaded
at runtime.

Only the faces a document uses are embedded. Multilingual documents can be
several megabytes, especially when they need multiple CJK faces. Embedded
fonts keep their bundled glyph coverage: characters outside that coverage
use Word's machine-dependent fallback. In particular, the bundled Chinese
face is a GB 2312 subset, not full Chinese coverage.

## Reproducing visual checks

In development, while signed in, `/dev/documents` links to
`/api/dev/word-samples`. It downloads a ZIP containing a Word export and
Chromium PDF for each built-in theme using the current profile and section
settings. Two synthetic cover letters and a references-enabled Studio resume
exercise letter framing and nested sidebar tables. Samples use normal theme
spacing, without PDF's automatic fit-to-one-page adjustment.

To compare a particular profile, use
`/api/dev/word-samples?profile={profileId}`. The archive records the resolved
profile ID and passes it to every Chromium reference, so both formats use the
same profile's section and language settings. Without it, the first profile
is used, not whichever profile was last opened in another tab.

**The ZIP contains profile text. Keep it local; do not commit or attach it to
a public issue.** Generated comparisons and machine-specific verification
tooling do not belong in source control.

On a Windows machine with desktop Word, extract the ZIP to a local disk,
close Word, and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\docx-to-pdf.ps1 -In .\docx -Out .\word
```

Compare `word/*.pdf` with `chromium/*.pdf`. The script requires an interactive
desktop session; use `-Visible` to investigate Word dialogs. Network shares
can stall Word's PDF conversion.

Automated tests inspect the DOCX package's content, styles, geometry,
numbering, relationships and embedded fonts; they are not visual acceptance:

```bash
docker/bin/yarn test
docker/bin/yarn typecheck
docker/bin/yarn lint
```

After changing fonts or layout, repeat comparisons in real Word on a machine
without the bundled fonts installed. Include A4 and Letter, all layout
types, new/custom and hidden sections, long multi-page content, references,
photos, mixed scripts, and edit/save/reopen. Validate both standalone and
desktop packaging offline. Comparisons of the earlier pre-1.12 prototype do
not establish visual parity for the updated font assets or new sections.

`e2e/word-export.spec.ts` checks real downloads on the production standalone
server: cross-tab profile isolation, base fitting, tailored documents, and
sent copies after the source profile changes. Run it with the resume and
profile regressions:

```bash
docker/bin/yarn test:e2e e2e/word-export.spec.ts e2e/resume.spec.ts e2e/profiles.spec.ts
```

For local Word verification, setting `WORD_PARITY_OUTPUT` inside the test
container saves
the actual DOCX downloads and corresponding PDFs under `docx/` and `chromium/`.
Use a private output directory; the normal test run writes no comparison bundle.

### Validation against 1.15.0 (18 November 2026)

- Full Vitest run, including PostgreSQL: 2,873 passed, 28 opt-in/platform
  tests skipped. Production build, typecheck and full lint passed.
- Separate SQLite database run: 803 passed, 3 skipped, across 88 test files.
  This completed on an isolated tmpfs database; an earlier disk-backed run
  exceeded the command timeout and was not counted as a pass.
- The three browser specs above: 12 passed, including sign-in setup.
- Windows 11 / Word 2024, version 16.0.20527.20150: all 37 DOCX files opened
  and converted successfully. This includes all twelve themes on A4 with
  custom/hidden/reordered/renamed sections and photos; a long Letter profile
  with volunteering and mixed scripts; letter/reference fixtures; and seven
  actual production exports covering fitting and draft/sent documents.
- Page counts matched for all 37 pairs. Whitespace-normalized character
  coverage was 100% for the production exports and A4 fixtures, and about
  99.95% for the long mixed-script resumes. The latter difference is two
  Devanagari vowel signs in extracted Word PDF text; it is not a byte-for-byte
  text-equivalence guarantee. Spacing and wrapping differences remain.
- Edit/save/reopen succeeded for three documents spanning single-column,
  sidebar and mixed-script layouts; the saved files retained the edits and
  embedded fonts. None of the 77 embedded family names
  appeared in Windows' installed-font collection.
- Standalone and prepared Linux desktop server exports passed with external
  networking disabled, including all 77 font hashes and transparent photo
  masks. The prepared Windows desktop server also exported both fixture
  profiles on the VM with its bundled Node 24.22.3 and target native modules;
  the exported fonts and photo masks were checked. Windows networking was
  left enabled to avoid disrupting other VM work. These are server-runtime
  checks, not full Electron installer tests.

Generated documents, comparison images, VM automation and machine-specific
logs stay outside version control. This run does not certify other Word
versions, every glyph in every script, or pixel-identical pagination.

### Column headings and pagination

A column's first heading has no visible section gap above it, but must not
be its cell's first paragraph. When both cells started with keep-with-next
headings, real Word moved some columns tables to page 2, leaving only the
resume header on page 1. A non-keeping, 1-twip (0.05 pt) boundary paragraph
prevents that without restoring the old visible gap. Headings still keep
with their first item. Regression tests check the boundary in Modern,
Technical, Ledger, Studio and Console without photos, and preserve Modern's
photo-to-contact gap.

Real Word verification repeated all 45 fixtures after this fix: all 10
header-only first pages were eliminated, all page counts matched Chromium,
and none exceeded the pre-spacing-change baseline. Modern and Studio with
sidebar photos retained their tighter heading positions within 0.12 pt.
The DOCX text and Chromium reference renders were unchanged.
