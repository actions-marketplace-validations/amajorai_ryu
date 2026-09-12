---
name: pdf
description: Create, render, inspect, and transform PDF documents with a Ryu-owned React-first pdfcn/Takumi/Forme path plus reliable pypdf and pdf-lib workflows. Use when a user asks for PDF generation, editing, extraction, merging, forms, OCR, or visual verification.
---

# Ryu PDF

Use this skill for PDF work. Keep the source document and generated output in the
user's requested workspace, preserve the original input, and report the exact
output path. Ryu bundles this skill, so its instructions are available offline.

## Choose the right path

- **Designed React/TypeScript document**: use [pdfcn](https://www.pdfcn.dev/)
  components with Takumi or Forme. This is the preferred path for branded
  invoices, reports, statements, and security reports.
- **Python-only or coordinate-heavy document**: use ReportLab.
- **Existing PDF edits**: use pypdf or pdf-lib for merging, splitting,
  rotation, metadata, encryption, watermarks, and page-level changes.
- **Text or table extraction**: use pypdf for simple text and pdfplumber when
  layout or table boundaries matter.
- **Scanned or image-only PDFs**: render pages and use OCR only when selectable
  text is absent. Say clearly when OCR quality is uncertain.

Do not use a low-level page API to lay out a document that is naturally a
component tree. Do not use a browser screenshot as a substitute for a real PDF
unless the user explicitly wants an image-only result.

## Generate designed PDFs with pdfcn

pdfcn is a shadcn-compatible registry of copy-paste PDF components and blocks.
It is not a single `pdfcn` runtime package. The registry copies components into
the host project and installs the renderer dependencies for the selected base.

Use the package manager already used by the project. In a Bun workspace:

```bash
bunx shadcn@latest add @pdfcn/takumi/invoice-minimal
bunx shadcn@latest add @pdfcn/takumi/theme-minimal
```

Use `@pdfcn/takumi/...` for Takumi or `@pdfcn/forme/...` for Forme. Useful
building blocks include page headers and footers, page numbers, tables, data
tables, graphs, key/value pairs, sections, stacks, page breaks,
keep-together wrappers, QR codes, and signatures. Prefer a matching upstream
block, then customize the copied local source.

Compose the document as JSX:

```tsx
import { Document, Page } from "@/components/pdf/pdf-primitives";
import { Text } from "@/components/pdf/text";
import { PdfcnThemeProvider } from "@/components/pdf/theme-provider";

export function Invoice() {
	return (
		<Document>
			<Page size="A4">
				<PdfcnThemeProvider>
					<Text variant="xl">Invoice</Text>
				</PdfcnThemeProvider>
			</Page>
		</Document>
	);
}
```

The registry docs use the `@/components/pdf/...` paths above, but shadcn can
place primitives or nested component files differently based on `components.json`.
After installation, follow the generated paths and aliases; do not create a
second copy of the renderer primitives just to preserve an import path.

Keep the renderer call at the application boundary. Takumi runs without a
headless browser and returns PDF bytes:

```tsx
import { writeFile } from "node:fs/promises";
import { render } from "takumi-pdf";
import { Invoice } from "./Invoice";

const pdfBytes = await render(<Invoice />, {
	size: "a4",
	margin: { top: 48, right: 40, bottom: 48, left: 40 },
});

await writeFile("invoice.pdf", pdfBytes);
```

When a project already uses Forme, keep its `@formepdf/react` primitives and
call `renderDocument()` from `@formepdf/core`. Do not mix Takumi and Forme
primitives in one document. For IDE-assisted registry discovery, pdfcn points
to the shadcn MCP setup:

```bash
bunx shadcn@latest mcp init
```

### PDF layout rules

- Use hex colors in PDF themes. Do not pass web `oklch` tokens directly into
  PDF styles.
- Register and embed fonts that cover every language in the document. Test
  non-Latin text instead of assuming the default font is sufficient.
- Define page size, margins, repeated header/footer, table-header repetition,
  page-break rules, and keep-together behavior before inserting real data.
- Keep user data in JSX props and text nodes. Do not interpolate untrusted
  values into raw HTML or style strings.

## Inspect and transform existing PDFs

Start with read-only inspection:

```bash
pdfinfo input.pdf
pdftotext -layout input.pdf -
```

For simple extraction with Python:

```python
from pypdf import PdfReader

reader = PdfReader("input.pdf")
print(f"pages: {len(reader.pages)}")
text = "\n".join(page.extract_text() or "" for page in reader.pages)
print(text)
```

Use pypdf or pdf-lib for structural edits. Use pdfplumber when table geometry
or reading order matters. For OCR, first render pages with `pdftoppm` or
`pdf2image`, then run the chosen OCR engine and retain the original PDF.

## Forms and annotations

Before filling a form, determine whether the PDF contains real AcroForm fields.
If it does, inspect field names, types, and allowed values before writing. If it
does not, use extracted label coordinates or a rendered-page inspection to place
annotations. Validate that annotations do not cover labels, lines, or existing
answers, and render the completed output for review.

## Verification is part of completion

For every generated or materially edited PDF:

1. Confirm that the file opens and has the expected page count.
2. Extract important text and confirm it is selectable when selectable text is
   part of the requirement.
3. Rasterize the first, middle, and last pages with `pdftoppm` or an equivalent
   PDF renderer.
4. Inspect those images for clipping, overflow, orphaned headings, footer
   collisions, missing glyphs, incorrect page breaks, and broken tables.
5. Repeat with long strings, empty collections, multiple pages, and non-Latin
   text before calling a template complete.

Never claim visual success from a passing typecheck or a file-exists check. Hand
back the PDF and the rendered proof images when the task includes layout or
design.

## Upstream references

- [pdfcn documentation](https://www.pdfcn.dev/llms.txt)
- [pdfcn installation](https://www.pdfcn.dev/docs/installation)
- [pdfcn theming](https://www.pdfcn.dev/docs/theming/takumi)
- [pdfcn MCP guidance](https://www.pdfcn.dev/docs/mcp)
- [Takumi PDF rendering](https://takumi.kane.tw/docs/pdf)
- [Forme quickstart](https://docs.formepdf.com/quickstart)
