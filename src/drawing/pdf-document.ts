/**
 * A minimal PDF writer, sufficient for a vector drawing sheet.
 *
 * A drawing needs three things from PDF: stroked and filled paths, text in a
 * standard font, and a page of an exact physical size. All three are in the
 * base format, and using them directly keeps the exported sheet a true vector
 * document — printable at any size, and measurable in a viewer — without adding
 * a rendering dependency to a project whose bundle already carries two
 * WebAssembly kernels.
 *
 * Only the base-14 fonts are used, so no glyph data is embedded and page text
 * stays selectable and searchable.
 */

export const POINTS_PER_MM = 72 / 25.4

/**
 * The one place WinAnsi and Latin-1 disagree: 0x80–0x9F.
 *
 * Latin-1 leaves that range as control codes; WinAnsi fills it with typographic
 * punctuation. Without this an em dash — which is what a title block field
 * shows when it is left unspecified — would encode as '?'.
 */
const WIN_ANSI_HIGH: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

/**
 * Encode a string as WinAnsi bytes.
 *
 * PDF string literals are bytes, not characters. WinAnsi agrees with Latin-1
 * from 0xA0 up, which covers the symbols a drawing needs — Ø, ° and × — so
 * there the mapping is the code point itself. Anything it cannot represent
 * becomes '?' rather than silently shifting every following byte.
 */
export function winAnsiBytes(text: string): number[] {
  const bytes: number[] = []
  for (const character of text) {
    const mapped = WIN_ANSI_HIGH[character]
    if (mapped !== undefined) {
      bytes.push(mapped)
      continue
    }
    const code = character.codePointAt(0) ?? 63
    bytes.push(code <= 0xff ? code : 63)
  }
  return bytes
}

/** Escape the three characters that terminate or nest a PDF string literal. */
export function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function asciiBytes(text: string): number[] {
  return winAnsiBytes(text)
}

export type PdfDocumentInput = {
  /** Page width in millimetres. */
  widthMm: number
  /** Page height in millimetres. */
  heightMm: number
  title: string
  /**
   * Page content stream operators, written in millimetres with the origin at
   * the bottom-left. The document applies the millimetre-to-point transform.
   */
  content: string
  /** Injected so the same drawing produces the same bytes in a test. */
  date: Date
}

function pdfDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

/**
 * Assemble a single-page PDF.
 *
 * Objects are written in order and their byte offsets recorded as they go,
 * because the cross-reference table at the end of a PDF is what makes the file
 * readable at all — a viewer seeks by those offsets rather than parsing forward.
 */
export function createPdfDocument(input: PdfDocumentInput): Uint8Array {
  const widthPt = input.widthMm * POINTS_PER_MM
  const heightPt = input.heightMm * POINTS_PER_MM
  const scale = POINTS_PER_MM.toFixed(6)

  // Everything downstream works in millimetres; this is the only place points
  // are dealt with.
  const contentWithTransform = `q ${scale} 0 0 ${scale} 0 0 cm\n${input.content}\nQ\n`
  const contentBytes = winAnsiBytes(contentWithTransform)

  const objects: number[][] = [
    asciiBytes('<< /Type /Catalog /Pages 2 0 R >>'),
    asciiBytes('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    asciiBytes(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(3)} ${heightPt.toFixed(3)}] ` +
        '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    ),
    [
      ...asciiBytes(`<< /Length ${contentBytes.length} >>\nstream\n`),
      ...contentBytes,
      ...asciiBytes('\nendstream'),
    ],
    asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    [
      ...asciiBytes('<< /Title ('),
      ...winAnsiBytes(escapePdfText(input.title)),
      ...asciiBytes(`) /Producer (Parallax CAD) /Creator (Parallax CAD) /CreationDate (${pdfDate(input.date)}) >>`),
    ],
  ]

  const bytes: number[] = [...asciiBytes('%PDF-1.4\n')]
  // A binary comment marks the file as containing binary data, so tools that
  // sniff content do not mangle it as text.
  bytes.push(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a)

  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(bytes.length)
    bytes.push(...asciiBytes(`${index + 1} 0 obj\n`))
    bytes.push(...body)
    bytes.push(...asciiBytes('\nendobj\n'))
  })

  const xrefOffset = bytes.length
  bytes.push(...asciiBytes(`xref\n0 ${objects.length + 1}\n`))
  bytes.push(...asciiBytes('0000000000 65535 f \n'))
  for (const offset of offsets) {
    bytes.push(...asciiBytes(`${String(offset).padStart(10, '0')} 00000 n \n`))
  }
  bytes.push(
    ...asciiBytes(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`,
    ),
  )

  return Uint8Array.from(bytes)
}
