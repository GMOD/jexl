/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { logicalAnd, logicalOr } from '../grammar.ts'
import { compileAst, readIndex, readMember, stringify } from './compile.ts'

import type { Grammar, GrammarFn } from '../grammar.ts'
import type { Context } from './compile.ts'
import type {
  AstNode,
  AstNodeUnion,
  Identifier,
  JexlValue,
  Literal
} from '../types.ts'

/** Named columns holding one value per row. A typed array is a column. */
export type Columns = Record<string, ArrayLike<unknown>>

/** Somewhere to write one value per row: an array, or a typed-array lane. */
export interface Lane {
  [row: number]: unknown
  readonly length: number
}

export interface ColumnarOptions {
  /**
   * What a bare identifier reads when no column carries it — the environment
   * behind the data mask, as R's `aes()` falls back to the calling frame.
   */
  env?: Context
  /**
   * A root identifier whose members name columns, so `feature.score` reads
   * the `score` column and an expression written against a row object runs
   * unchanged.
   */
  dataPronoun?: string
  /** A root identifier whose members always read `env`, never a column. */
  envPronoun?: string
}

/**
 * An expression evaluated over `n` rows at once. The answer holds one value
 * per row; without `out` it may be one of the input columns, so a caller that
 * writes to it passes `out`.
 */
export type ColumnarFn = (
  columns: Columns,
  n: number,
  out?: Lane
) => ArrayLike<JexlValue>

class Scalar {
  readonly value: JexlValue
  constructor(value: JexlValue) {
    this.value = value
  }
}

type Vec = ArrayLike<JexlValue>
type Val = Vec | Scalar

/**
 * A node over a set of rows: row `rows[k]` at position `k`, or row `k` when
 * `rows` is undefined. Evaluating only the rows a branch takes is what keeps
 * `?:`, `&&` and `||` from evaluating an operand a row never reaches.
 */
type ColumnNode = (
  columns: Columns,
  rows: Uint32Array | undefined,
  n: number
) => Val

const NOTHING = new Scalar(undefined)

function broadcast(value: Val, n: number): Vec {
  return value instanceof Scalar ? new Array(n).fill(value.value) : value
}

function gather(
  column: ArrayLike<unknown>,
  rows: Uint32Array | undefined,
  n: number
): Vec {
  const values = column as Vec
  if (!rows) {
    return values.length === n
      ? values
      : Array.prototype.slice.call(values, 0, n)
  }
  const out: JexlValue[] = new Array(n)
  for (let k = 0; k < n; k++) {
    out[k] = values[rows[k]!]
  }
  return out
}

function map1(value: Val, fn: (v: JexlValue) => JexlValue, n: number): Val {
  if (value instanceof Scalar) {
    return new Scalar(fn(value.value))
  }
  const out: JexlValue[] = new Array(n)
  for (let k = 0; k < n; k++) {
    out[k] = fn(value[k])
  }
  return out
}

function map2(
  left: Val,
  right: Val,
  fn: (l: JexlValue, r: JexlValue) => JexlValue,
  n: number
): Val {
  if (left instanceof Scalar) {
    if (right instanceof Scalar) {
      return new Scalar(fn(left.value, right.value))
    }
    const l = left.value
    const out: JexlValue[] = new Array(n)
    for (let k = 0; k < n; k++) {
      out[k] = fn(l, right[k])
    }
    return out
  }
  const out: JexlValue[] = new Array(n)
  if (right instanceof Scalar) {
    const r = right.value
    for (let k = 0; k < n; k++) {
      out[k] = fn(left[k], r)
    }
  } else {
    for (let k = 0; k < n; k++) {
      out[k] = fn(left[k], right[k])
    }
  }
  return out
}

/** The positions whose value's truthiness is `want`, and the rows they are. */
function select(
  values: Vec,
  rows: Uint32Array | undefined,
  n: number,
  want: boolean
) {
  const at = new Uint32Array(n)
  let m = 0
  for (let k = 0; k < n; k++) {
    if (Boolean(values[k]) === want) {
      at[m++] = k
    }
  }
  const positions = at.subarray(0, m)
  if (!rows) {
    return { at: positions, rows: positions }
  }
  const selected = new Uint32Array(m)
  for (let j = 0; j < m; j++) {
    selected[j] = rows[positions[j]!]!
  }
  return { at: positions, rows: selected }
}

function scatter(out: JexlValue[], at: Uint32Array, value: Val) {
  if (value instanceof Scalar) {
    const v = value.value
    for (const k of at) {
      out[k] = v
    }
  } else {
    for (let j = 0; j < at.length; j++) {
      out[at[j]!] = value[j]
    }
  }
}

function copyOf(values: Vec, n: number): JexlValue[] {
  const out: JexlValue[] = new Array(n)
  for (let k = 0; k < n; k++) {
    out[k] = values[k]
  }
  return out
}

/**
 * The row-at-a-time path, for a node with no column form: its closure from
 * {@link compileAst}, evaluated per row against a view whose names read the
 * current row's column values.
 */
function rowwise(
  node: AstNode,
  grammar: Grammar,
  options: ColumnarOptions
): ColumnNode {
  const fn = compileAst(node, grammar)
  const { env = {}, dataPronoun, envPronoun } = options
  return (columns, rows, n) => {
    let row = 0
    const read = (name: string) =>
      Object.hasOwn(columns, name) ? columns[name]![row] : undefined
    const data = new Proxy(
      {},
      { get: (_, name) => (typeof name === 'string' ? read(name) : undefined) }
    )
    const assigned: Context = {}
    const context = new Proxy(assigned, {
      get(target, name) {
        if (typeof name !== 'string') {
          return undefined
        }
        if (Object.hasOwn(target, name)) {
          return target[name]
        }
        if (name === dataPronoun) {
          return data
        }
        if (name === envPronoun) {
          return env
        }
        return Object.hasOwn(columns, name) ? read(name) : env[name]
      }
    })
    const out: JexlValue[] = new Array(n)
    for (let k = 0; k < n; k++) {
      row = rows ? rows[k]! : k
      out[k] = fn(context)
    }
    return out
  }
}

function walk(value: JexlValue, names: readonly string[]) {
  let current = value
  for (const name of names) {
    current = readMember(current, name)
  }
  return current
}

function members(value: Val, names: readonly string[], n: number): Val {
  let current = value
  for (const name of names) {
    current = map1(current, (v) => readMember(v, name), n)
  }
  return current
}

function identifier(
  node: Identifier,
  grammar: Grammar,
  options: ColumnarOptions
): ColumnNode {
  const names: string[] = []
  let subject: AstNode | undefined = node
  while (subject?.type === 'Identifier') {
    names.unshift((subject as Identifier).value)
    subject = (subject as Identifier).from
  }
  if (subject) {
    const from = columnar(subject, grammar, options)
    return (columns, rows, n) => members(from(columns, rows, n), names, n)
  }
  const { env = {}, dataPronoun, envPronoun } = options
  const [root, ...rest] = names as [string, ...string[]]
  if (root === envPronoun) {
    return () => {
      const [name, ...tail] = rest
      return new Scalar(walk(name === undefined ? env : env[name], tail))
    }
  }
  const bare = root !== dataPronoun
  const path = bare ? names : rest
  if (path.length === 0) {
    throw new Error(
      `"${root}" names a whole row, which a columnar evaluation has no value for`
    )
  }
  // the longest prefix naming a column wins, so `INFO.SVTYPE` reads a column
  // of that name where one is flattened out, and walks into `INFO` otherwise
  const keys = path.map((_, i) => path.slice(0, path.length - i).join('.'))
  return (columns, rows, n) => {
    for (const [i, key] of keys.entries()) {
      if (Object.hasOwn(columns, key)) {
        const tail = path.slice(path.length - i)
        return members(gather(columns[key]!, rows, n), tail, n)
      }
    }
    return bare ? new Scalar(walk(env[path[0]!], path.slice(1))) : NOTHING
  }
}

function logical(
  left: ColumnNode,
  right: ColumnNode,
  evaluatesRightWhen: boolean
): ColumnNode {
  return (columns, rows, n) => {
    const l = left(columns, rows, n)
    if (l instanceof Scalar) {
      return Boolean(l.value) === evaluatesRightWhen
        ? right(columns, rows, n)
        : l
    }
    const taken = select(l, rows, n, evaluatesRightWhen)
    if (taken.at.length === 0) {
      return l
    }
    const out = copyOf(l, n)
    scatter(out, taken.at, right(columns, taken.rows, taken.at.length))
    return out
  }
}

function call(
  grammar: Grammar,
  name: string,
  args: readonly ColumnNode[]
): ColumnNode {
  const lookup = (): GrammarFn => {
    const { functions } = grammar
    if (!Object.hasOwn(functions, name)) {
      throw new Error(`Jexl Function ${name} is not defined.`)
    }
    return functions[name]!
  }
  return (columns, rows, n) => {
    const values = args.map((arg) => arg(columns, rows, n))
    const fn = lookup()
    if (values.every((v): v is Scalar => v instanceof Scalar)) {
      return new Scalar(fn(...values.map((v) => v.value)))
    }
    if (values.length === 1) {
      return map1(values[0]!, fn, n)
    }
    if (values.length === 2) {
      return map2(values[0]!, values[1]!, fn, n)
    }
    const vecs = values.map((v) => broadcast(v, n))
    const out: JexlValue[] = new Array(n)
    const argv: JexlValue[] = new Array(vecs.length)
    for (let k = 0; k < n; k++) {
      for (let a = 0; a < vecs.length; a++) {
        argv[a] = vecs[a]![k]
      }
      out[k] = fn(...argv)
    }
    return out
  }
}

function template(parts: readonly (string | ColumnNode)[]): ColumnNode {
  const rendered = (value: Val) =>
    value instanceof Scalar ? stringify(value.value) : value
  return (columns, rows, n) => {
    const values = parts.map((part) =>
      typeof part === 'string' ? part : rendered(part(columns, rows, n))
    )
    if (values.every((v) => typeof v === 'string')) {
      return new Scalar(values.join(''))
    }
    const out: string[] = new Array(n).fill('')
    for (const value of values) {
      if (typeof value === 'string') {
        for (let k = 0; k < n; k++) {
          out[k] = out[k]! + value
        }
      } else {
        for (let k = 0; k < n; k++) {
          out[k] = out[k]! + stringify(value[k])
        }
      }
    }
    return out
  }
}

// `test ? 'red' : 'blue'`, the usual colour rule: neither branch has anything
// to evaluate, so one pass picks between the two values
function choose(test: ColumnNode, yes: JexlValue, no: JexlValue): ColumnNode {
  return (columns, rows, n) => {
    const t = test(columns, rows, n)
    if (t instanceof Scalar) {
      return new Scalar(t.value ? yes : no)
    }
    const out: JexlValue[] = new Array(n)
    for (let k = 0; k < n; k++) {
      out[k] = t[k] ? yes : no
    }
    return out
  }
}

function conditional(
  test: ColumnNode,
  consequent: ColumnNode | undefined,
  alternate: ColumnNode | undefined
): ColumnNode {
  return (columns, rows, n) => {
    const t = test(columns, rows, n)
    if (t instanceof Scalar) {
      return t.value
        ? consequent
          ? consequent(columns, rows, n)
          : t
        : alternate
          ? alternate(columns, rows, n)
          : NOTHING
    }
    const out: JexlValue[] = new Array(n)
    const yes = select(t, rows, n, true)
    const no = select(t, rows, n, false)
    if (yes.at.length > 0) {
      scatter(
        out,
        yes.at,
        consequent
          ? consequent(columns, yes.rows, yes.at.length)
          : gather(t, yes.at, yes.at.length)
      )
    }
    if (no.at.length > 0) {
      scatter(
        out,
        no.at,
        alternate ? alternate(columns, no.rows, no.at.length) : NOTHING
      )
    }
    return out
  }
}

function columnar(
  ast: AstNode,
  grammar: Grammar,
  options: ColumnarOptions
): ColumnNode {
  const node = ast as AstNodeUnion
  const sub = (child: AstNode) => columnar(child, grammar, options)
  switch (node.type) {
    case 'Literal': {
      const value = new Scalar(node.value)
      return () => value
    }

    case 'Identifier': {
      return identifier(node, grammar, options)
    }

    case 'UnaryExpression': {
      const right = sub(node.right!)
      const elem = grammar.elements[node.operator]
      const fn =
        elem?.type === 'unaryOp'
          ? elem.eval
          : elem?.type === 'binaryOp'
            ? elem.unaryEval
            : undefined
      if (!fn) {
        return (columns, rows, n) => {
          right(columns, rows, n)
          return NOTHING
        }
      }
      return (columns, rows, n) => map1(right(columns, rows, n), fn, n)
    }

    case 'BinaryExpression': {
      const op = grammar.elements[node.operator]
      if (op?.type !== 'binaryOp') {
        return () => NOTHING
      }
      if (op.evalOnDemand === logicalAnd || op.evalOnDemand === logicalOr) {
        return logical(
          sub(node.left),
          sub(node.right!),
          op.evalOnDemand === logicalAnd
        )
      }
      if (op.evalOnDemand) {
        return rowwise(node, grammar, options)
      }
      const left = sub(node.left)
      const right = sub(node.right!)
      const fn = op.eval
      if (!fn) {
        return (columns, rows, n) => {
          left(columns, rows, n)
          right(columns, rows, n)
          return NOTHING
        }
      }
      return (columns, rows, n) =>
        map2(left(columns, rows, n), right(columns, rows, n), fn, n)
    }

    case 'ConditionalExpression': {
      const { consequent, alternate } = node
      if (
        consequent?.type === 'Literal' &&
        (alternate === undefined || alternate.type === 'Literal')
      ) {
        return choose(
          sub(node.test),
          (consequent as Literal).value,
          (alternate as Literal | undefined)?.value
        )
      }
      return conditional(
        sub(node.test),
        node.consequent && sub(node.consequent),
        node.alternate && sub(node.alternate)
      )
    }

    case 'FilterExpression': {
      const subject = sub(node.subject)
      const index = sub(node.expr)
      return (columns, rows, n) =>
        map2(subject(columns, rows, n), index(columns, rows, n), readIndex, n)
    }

    case 'TemplateLiteral': {
      return template(
        node.parts.map((part) =>
          part.type === 'static' ? part.value : sub(part.value)
        )
      )
    }

    case 'FunctionCall': {
      return call(grammar, node.name, node.args.map(sub))
    }

    default: {
      return rowwise(node, grammar, options)
    }
  }
}

/**
 * Lowers an expression to one evaluation over whole columns, the way R
 * evaluates `aes(y = -log10(pvalue))`: a bare name is a column where the
 * columns carry it and `options.env` where they do not, and each node runs
 * once per call over every row rather than once per row.
 *
 * A row's answer is what {@link compileAst} gives for that row's values, with
 * one exception: a function called with no per-row argument is called once,
 * not once per row, so the functions are assumed to be pure.
 */
export function compileColumnar(
  ast: AstNode | null,
  grammar: Grammar,
  options: ColumnarOptions = {}
): ColumnarFn {
  const root = ast ? columnar(ast, grammar, options) : () => NOTHING
  return (columns, n, out) => {
    const value = n === 0 ? NOTHING : root(columns, undefined, n)
    if (!out) {
      return broadcast(value, n)
    }
    const target = out as JexlValue[]
    if (value instanceof Scalar) {
      for (let k = 0; k < n; k++) {
        target[k] = value.value
      }
    } else {
      for (let k = 0; k < n; k++) {
        target[k] = value[k]
      }
    }
    return target
  }
}
