import { MM_PER_INCH } from './units'

/**
 * The formula language behind named parameters.
 *
 * Two decisions here are worth stating up front, because both are conventions
 * rather than consequences of the maths.
 *
 * **A bare number is a millimeter.** The document is millimeter-native and
 * every stored coordinate already is one, so `plate_width / 2 + 3` means the
 * same thing whatever display unit the user happens to be reading in. Display
 * units are a presentation choice and must not silently change what a stored
 * formula evaluates to. Where a user wants to write inches, the literal says so
 * — `1.5in` or `1.5"` — and converts at parse time.
 *
 * **Trigonometry is in degrees.** Every angle the document holds — revolve
 * extent, angle constraints — is degrees, so `sin(30)` returning 0.5 is what
 * makes a formula agree with the number in the field beside it. Radians are
 * available through `rad()` for anyone who wants them.
 *
 * The parser is a small Pratt parser rather than a regex or `new Function`.
 * `new Function` would be shorter and is the usual shortcut, but it would run
 * arbitrary script from a project file — a `.parallax` document is a shareable
 * artifact, so its formulas have to be inert data. Parsing also gives the
 * variable references, which is what the dependency graph in `parameters.ts` is
 * built from.
 */

export type ExpressionNode =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; operator: '-' | '+'; operand: ExpressionNode }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/' | '%' | '^'; left: ExpressionNode; right: ExpressionNode }
  | { kind: 'call'; name: string; arguments: ExpressionNode[] }

export class ExpressionError extends Error {}

type Token =
  | { type: 'number'; value: number; at: number }
  | { type: 'identifier'; value: string; at: number }
  | { type: 'operator'; value: string; at: number }

const OPERATORS = ['+', '-', '*', '/', '%', '^', '(', ')', ','] as const

/** Named constants. Written in lower case; lookup is case-insensitive. */
const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
}

const DEG = Math.PI / 180

type BuiltIn = { arity: number | 'variadic'; apply: (values: number[]) => number }

/**
 * The function library.
 *
 * Deliberately small and total: every entry is a pure numeric function whose
 * domain errors are reported by the evaluator rather than returned as `NaN`,
 * because a `NaN` that reaches the kernel becomes an invalid solid a long way
 * from the formula that caused it.
 */
const FUNCTIONS: Record<string, BuiltIn> = {
  sin: { arity: 1, apply: ([value]) => Math.sin(value * DEG) },
  cos: { arity: 1, apply: ([value]) => Math.cos(value * DEG) },
  tan: { arity: 1, apply: ([value]) => Math.tan(value * DEG) },
  asin: { arity: 1, apply: ([value]) => Math.asin(value) / DEG },
  acos: { arity: 1, apply: ([value]) => Math.acos(value) / DEG },
  atan: { arity: 1, apply: ([value]) => Math.atan(value) / DEG },
  atan2: { arity: 2, apply: ([y, x]) => Math.atan2(y, x) / DEG },
  deg: { arity: 1, apply: ([value]) => value / DEG },
  rad: { arity: 1, apply: ([value]) => value * DEG },
  sqrt: { arity: 1, apply: ([value]) => Math.sqrt(value) },
  abs: { arity: 1, apply: ([value]) => Math.abs(value) },
  sign: { arity: 1, apply: ([value]) => Math.sign(value) },
  floor: { arity: 1, apply: ([value]) => Math.floor(value) },
  ceil: { arity: 1, apply: ([value]) => Math.ceil(value) },
  round: { arity: 1, apply: ([value]) => Math.round(value) },
  min: { arity: 'variadic', apply: (values) => Math.min(...values) },
  max: { arity: 'variadic', apply: (values) => Math.max(...values) },
  hypot: { arity: 'variadic', apply: (values) => Math.hypot(...values) },
  pow: { arity: 2, apply: ([base, exponent]) => base ** exponent },
  log: { arity: 1, apply: ([value]) => Math.log(value) },
  log10: { arity: 1, apply: ([value]) => Math.log10(value) },
  exp: { arity: 1, apply: ([value]) => Math.exp(value) },
}

/** The functions a formula may call, for documentation and UI hints. */
export const EXPRESSION_FUNCTION_NAMES = Object.keys(FUNCTIONS).sort()
export const EXPRESSION_CONSTANT_NAMES = Object.keys(CONSTANTS).sort()

/**
 * Whether a name can be used for a parameter.
 *
 * Identifier-shaped so a formula can never be ambiguous, and never one of the
 * reserved words, so `pi = 3` cannot quietly change what every other formula in
 * the document means.
 */
export function isValidParameterName(name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false
  const lower = name.toLowerCase()
  return !(lower in CONSTANTS) && !(lower in FUNCTIONS)
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (/\s/.test(character)) {
      index += 1
      continue
    }
    if (/[0-9.]/.test(character)) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(index))
      if (!match) throw new ExpressionError(`"${source.slice(index)}" is not a number.`)
      const magnitude = Number(match[0])
      if (!Number.isFinite(magnitude)) throw new ExpressionError(`"${match[0]}" is not a number.`)
      const at = index
      index += match[0].length
      // A unit suffix binds tighter than any operator, so it is read here
      // rather than as a trailing identifier — otherwise `2in*3` would parse as
      // a multiplication by an unknown parameter called `in`.
      const suffix = /^(mm|in(?:ch(?:es)?)?|["″])/.exec(source.slice(index))
      let value = magnitude
      if (suffix) {
        index += suffix[0].length
        if (suffix[0] !== 'mm') value = magnitude * MM_PER_INCH
      }
      tokens.push({ type: 'number', value, at })
      continue
    }
    if (/[A-Za-z_]/.test(character)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index))!
      tokens.push({ type: 'identifier', value: match[0], at: index })
      index += match[0].length
      continue
    }
    if ((OPERATORS as readonly string[]).includes(character)) {
      tokens.push({ type: 'operator', value: character, at: index })
      index += 1
      continue
    }
    throw new ExpressionError(`"${character}" cannot be used in a formula.`)
  }
  return tokens
}

const BINARY_PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 }

/**
 * Parse a formula into an AST, throwing `ExpressionError` on anything malformed.
 *
 * `^` is right-associative, so `2^3^2` is 512 as it is in mathematical notation
 * rather than 64.
 */
export function parseExpression(source: string): ExpressionNode {
  const tokens = tokenize(source)
  if (!tokens.length) throw new ExpressionError('The formula is empty.')
  let position = 0

  const peek = () => tokens[position]

  function expect(value: string) {
    const token = peek()
    if (!token || token.type !== 'operator' || token.value !== value) throw new ExpressionError(`Expected "${value}".`)
    position += 1
  }

  function parsePrimary(): ExpressionNode {
    const token = peek()
    if (!token) throw new ExpressionError('The formula ends before it is finished.')
    if (token.type === 'number') {
      position += 1
      return { kind: 'number', value: token.value }
    }
    if (token.type === 'identifier') {
      position += 1
      const next = peek()
      if (next?.type === 'operator' && next.value === '(') {
        position += 1
        const parameters: ExpressionNode[] = []
        if (!(peek()?.type === 'operator' && peek()?.value === ')')) {
          parameters.push(parseBinary(0))
          while (peek()?.type === 'operator' && peek()?.value === ',') {
            position += 1
            parameters.push(parseBinary(0))
          }
        }
        expect(')')
        return { kind: 'call', name: token.value, arguments: parameters }
      }
      return { kind: 'variable', name: token.value }
    }
    if (token.value === '(') {
      position += 1
      const inner = parseBinary(0)
      expect(')')
      return inner
    }
    if (token.value === '-' || token.value === '+') {
      position += 1
      // Unary binds tighter than the binary operators but looser than `^`, so
      // `-2^2` is -4.
      return { kind: 'unary', operator: token.value, operand: parseBinary(3) }
    }
    throw new ExpressionError(`"${token.value}" cannot start a value.`)
  }

  function parseBinary(minimumPrecedence: number): ExpressionNode {
    let left = parsePrimary()
    for (;;) {
      const token = peek()
      if (!token || token.type !== 'operator') break
      const precedence = BINARY_PRECEDENCE[token.value]
      if (precedence === undefined || precedence < minimumPrecedence) break
      position += 1
      const rightAssociative = token.value === '^'
      const right = parseBinary(rightAssociative ? precedence : precedence + 1)
      left = { kind: 'binary', operator: token.value as '+' | '-' | '*' | '/' | '%' | '^', left, right }
    }
    return left
  }

  const node = parseBinary(0)
  if (position < tokens.length) {
    const token = tokens[position]
    throw new ExpressionError(`"${token.type === 'number' ? token.value : token.value}" is unexpected here.`)
  }
  return node
}

/** Every parameter name a formula reads, in first-reference order. */
export function expressionDependencies(node: ExpressionNode): string[] {
  const names: string[] = []
  const walk = (current: ExpressionNode) => {
    switch (current.kind) {
      case 'variable':
        if (!(current.name.toLowerCase() in CONSTANTS) && !names.includes(current.name)) names.push(current.name)
        break
      case 'unary':
        walk(current.operand)
        break
      case 'binary':
        walk(current.left)
        walk(current.right)
        break
      case 'call':
        current.arguments.forEach(walk)
        break
      case 'number':
        break
    }
  }
  walk(node)
  return names
}

export type ExpressionScope = Readonly<Record<string, number>>

/** Evaluate a parsed formula, throwing `ExpressionError` on anything it cannot resolve. */
export function evaluateExpression(node: ExpressionNode, scope: ExpressionScope = {}): number {
  switch (node.kind) {
    case 'number':
      return node.value
    case 'variable': {
      if (node.name in scope) return scope[node.name]
      const constant = CONSTANTS[node.name.toLowerCase()]
      if (constant !== undefined) return constant
      throw new ExpressionError(`There is no parameter named "${node.name}".`)
    }
    case 'unary': {
      const value = evaluateExpression(node.operand, scope)
      return node.operator === '-' ? -value : value
    }
    case 'binary': {
      const left = evaluateExpression(node.left, scope)
      const right = evaluateExpression(node.right, scope)
      switch (node.operator) {
        case '+': return left + right
        case '-': return left - right
        case '*': return left * right
        case '/':
          if (right === 0) throw new ExpressionError('This formula divides by zero.')
          return left / right
        case '%':
          if (right === 0) throw new ExpressionError('This formula takes a remainder by zero.')
          return left % right
        case '^': {
          const result = left ** right
          if (!Number.isFinite(result)) throw new ExpressionError(`${left} to the power of ${right} is not a real number.`)
          return result
        }
      }
    }
    // eslint-disable-next-line no-fallthrough -- every operator above returns.
    case 'call': {
      const builtIn = FUNCTIONS[node.name.toLowerCase()]
      if (!builtIn) throw new ExpressionError(`There is no function named "${node.name}".`)
      if (builtIn.arity === 'variadic') {
        if (!node.arguments.length) throw new ExpressionError(`${node.name}() needs at least one value.`)
      } else if (node.arguments.length !== builtIn.arity) {
        throw new ExpressionError(`${node.name}() takes ${builtIn.arity} value${builtIn.arity === 1 ? '' : 's'}, not ${node.arguments.length}.`)
      }
      const values = node.arguments.map((argument) => evaluateExpression(argument, scope))
      const result = builtIn.apply(values)
      if (!Number.isFinite(result)) throw new ExpressionError(`${node.name}() is undefined for ${values.join(', ')}.`)
      return result
    }
  }
}

export type ExpressionResult = { ok: true; value: number } | { ok: false; error: string }

/** Parse and evaluate in one step, reporting failure rather than throwing. */
export function tryEvaluateExpression(source: string, scope: ExpressionScope = {}): ExpressionResult {
  try {
    const value = evaluateExpression(parseExpression(source), scope)
    if (!Number.isFinite(value)) return { ok: false, error: 'The formula does not evaluate to a number.' }
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error: error instanceof ExpressionError ? error.message : 'The formula could not be read.' }
  }
}

/**
 * The names a formula reads, or an empty list if it cannot be parsed.
 *
 * Used where an unparseable formula is reported separately and the caller only
 * wants the graph edges it can see.
 */
export function readDependencies(source: string): string[] {
  try {
    return expressionDependencies(parseExpression(source))
  } catch {
    return []
  }
}
