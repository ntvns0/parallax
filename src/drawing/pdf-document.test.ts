import { describe, expect, it } from 'vitest'
import { POINTS_PER_MM, createPdfDocument, escapePdfText, winAnsiBytes } from './pdf-document'

const FIXED_DATE = new Date('2026-08-02T09:30:00Z')

function build(overrides: Partial<Parameters<typeof createPdfDocument>[0]> = {}) {
  return createPdfDocument({
    widthMm: 297,
    heightMm: 210,
    title: 'Bracket',
    content: '0 0 m 10 10 l S',
    date: FIXED_DATE,
    ...overrides,
  })
}

function asLatin1(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
}

describe('winAnsiBytes', () => {
  it('encodes the drafting symbols a drawing needs as single bytes', () => {
    expect(winAnsiBytes('Ø')).toEqual([0xd8])
    expect(winAnsiBytes('°')).toEqual([0xb0])
    expect(winAnsiBytes('×')).toEqual([0xd7])
  })

  it('encodes the punctuation WinAnsi puts where Latin-1 has control codes', () => {
    expect(winAnsiBytes('—')).toEqual([0x97])
    expect(winAnsiBytes('’')).toEqual([0x92])
  })

  it('substitutes rather than shifting every byte after an unsupported glyph', () => {
    expect(winAnsiBytes('a漢b')).toEqual([0x61, 0x3f, 0x62])
  })
})

describe('escapePdfText', () => {
  it('escapes the characters that would otherwise end the string literal', () => {
    expect(escapePdfText('R3 (typ.) \\ 2')).toBe('R3 \\(typ.\\) \\\\ 2')
  })
})

describe('createPdfDocument', () => {
  it('writes a PDF header and terminator', () => {
    const text = asLatin1(build())
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('records cross-reference offsets that actually point at their objects', () => {
    // A viewer seeks by these offsets. If they are wrong by even one byte the
    // file will not open, and nothing else in the document can reveal that.
    const bytes = build()
    const text = asLatin1(bytes)
    const xrefStart = Number(text.slice(text.lastIndexOf('startxref')).split('\n')[1])
    const table = text.slice(xrefStart).split('\n')

    expect(table[0]).toBe('xref')
    const [, count] = table[1].split(' ')
    for (let object = 1; object < Number(count); object += 1) {
      const offset = Number(table[2 + object].slice(0, 10))
      expect(text.slice(offset, offset + `${object} 0 obj`.length)).toBe(`${object} 0 obj`)
    }
  })

  it('sizes the page in points, from millimetres', () => {
    const text = asLatin1(build({ widthMm: 297, heightMm: 210 }))
    expect(text).toContain(`/MediaBox [0 0 ${(297 * POINTS_PER_MM).toFixed(3)} ${(210 * POINTS_PER_MM).toFixed(3)}]`)
  })

  it('declares a content length matching the bytes actually written', () => {
    const text = asLatin1(build())
    const declared = Number(/\/Length (\d+) >>\nstream/.exec(text)![1])
    const stream = text.slice(text.indexOf('stream\n') + 'stream\n'.length, text.indexOf('\nendstream'))
    expect(stream.length).toBe(declared)
  })

  it('applies the millimetre transform once, around the caller content', () => {
    const text = asLatin1(build({ content: 'MARKER' }))
    expect(text).toContain(`q ${POINTS_PER_MM.toFixed(6)} 0 0 ${POINTS_PER_MM.toFixed(6)} 0 0 cm\nMARKER\nQ`)
  })

  it('embeds no font programs, so a base-14 sheet stays small and selectable', () => {
    const text = asLatin1(build())
    expect(text).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding')
    expect(text).not.toContain('/FontFile')
  })

  it('is byte-for-byte reproducible for the same input', () => {
    expect(build()).toEqual(build())
  })
})
