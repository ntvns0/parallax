/**
 * Helvetica character widths, from the Adobe AFM metrics for the base-14 fonts.
 *
 * A PDF that uses a base-14 font embeds no glyph data, so the viewer supplies
 * the font and the writer has to know its widths in order to centre or
 * right-align anything. Keeping the same table for the SVG renderer is what
 * makes the on-screen preview and the printed sheet lay text out identically.
 *
 * Widths are in 1/1000 em.
 */

const REGULAR: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
  '°': 400, '±': 584, '×': 584, 'Ø': 778, 'ø': 611, '·': 278,
}

const BOLD: Record<string, number> = {
  ' ': 278, '!': 333, '"': 474, '#': 556, $: 556, '%': 889, '&': 722, "'": 238,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611, '@': 975,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 333, '\\': 278, ']': 333, '^': 584, _: 556, '`': 333,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278,
  j: 278, k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389,
  s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  '{': 389, '|': 280, '}': 389, '~': 584,
  '°': 400, '±': 584, '×': 584, 'Ø': 778, 'ø': 611, '·': 278,
}

/** Digits and capitals dominate a drawing, so an unknown glyph is sized like one. */
const FALLBACK_WIDTH = 556

/**
 * Cap height as a fraction of font size.
 *
 * Drafting standards specify lettering by its capital height, while both PDF
 * and SVG size text by the em. Every text size in this module means cap height;
 * this is where the two meet.
 */
export const HELVETICA_CAP_HEIGHT = 0.717

export function fontSizeForCapHeight(capHeight: number): number {
  return capHeight / HELVETICA_CAP_HEIGHT
}

/** Width of a string at the given cap height, in the same units. */
export function textWidth(text: string, capHeight: number, bold = false): number {
  const table = bold ? BOLD : REGULAR
  const em = fontSizeForCapHeight(capHeight)
  let total = 0
  for (const character of text) total += table[character] ?? FALLBACK_WIDTH
  return (total / 1000) * em
}

/**
 * The largest cap height at or below `preferred` that keeps the text inside
 * `maxWidth`.
 *
 * Title block fields hold whatever the user typed, and a part name overflowing
 * into the next cell is worse than the same name set a point smaller. Below
 * `minimum` the text is left to overflow rather than shrunk into illegibility.
 */
export function fitCapHeight(text: string, maxWidth: number, preferred: number, minimum = 1.7): number {
  const width = textWidth(text, preferred, true)
  if (width <= maxWidth || width === 0) return preferred
  return Math.max(minimum, preferred * (maxWidth / width))
}
