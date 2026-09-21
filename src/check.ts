/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { AnalyzeOptions } from './analyze.ts'
import type {
  AstNode,
  AstNodeUnion,
  BinaryExpression,
  FunctionCall,
  Identifier,
  Lambda,
  Literal
} from './types.ts'

/**
 * How many values a field holds: one, a list of exactly that many when a
 * number, or a list whose length follows the record, as VCF's `Number=A`, `R`,
 * `G` and `.` do.
 */
export type Cardinality =
  | 'one'
  | 'perAlt'
  | 'perAllele'
  | 'perGenotype'
  | 'many'
  | number

/**
 * One field of a row, as a file header declares it. A `record` field's own
 * fields are further entries whose path extends its path, including when the
 * record is a list of them. A path key of `*` stands for every key of a map,
 * such as a VCF record's sample names. An entry with an empty path describes
 * the row itself.
 */
export interface FieldSchema {
  path: readonly string[]
  type: 'number' | 'string' | 'boolean' | 'flag' | 'record'
  cardinality?: Cardinality
  integer?: boolean
  description?: string
  /** Every value the field takes, where the header enumerates them. */
  categories?: readonly string[]
  domain?: readonly [number, number]
  /** For a record: its fields were observed in data rather than declared. */
  open?: boolean
}

interface FromField {
  field?: FieldSchema
}

export type Type =
  | { kind: 'unknown' }
  | { kind: 'undefined' }
  | (FromField & {
      kind: 'number'
      values?: readonly number[]
      domain?: readonly [number, number]
    })
  | (FromField & { kind: 'string'; values?: readonly string[] })
  | (FromField & { kind: 'boolean' })
  | (FromField & {
      kind: 'list'
      of: Type
      cardinality: Exclude<Cardinality, 'one'>
    })
  | (FromField & {
      kind: 'record'
      fields: ReadonlyMap<string, Type>
      each?: Type
      open: boolean
    })
  | { kind: 'union'; of: readonly Type[] }
  | { kind: 'lambda'; returns: Type }

type Kind = Type['kind']
type OfKind<K extends Kind> = Extract<Type, { kind: K }>

export type ParamType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'list'
  | 'record'
  | 'any'
  | 'member'
  | 'lambda'

export interface Signature {
  params: readonly (ParamType | readonly ParamType[])[]
  /** How many trailing params a call may leave out. */
  optional?: number
  /** Whether the last param repeats. */
  variadic?: boolean
  returns?:
    | 'number'
    | 'string'
    | 'boolean'
    | Type
    | ((args: readonly Type[]) => Type)
}

export type Severity = 'error' | 'warning' | 'info'

export type DiagnosticCode =
  | 'unknown-variable'
  | 'unknown-field'
  | 'unknown-function'
  | 'arity'
  | 'argument-type'
  | 'list-operand'
  | 'list-lengths'
  | 'invalid-pattern'
  | 'string-numeric'
  | 'never-equal'
  | 'unknown-category'
  | 'index-scalar'
  | 'index-range'
  | 'dot-through-list'
  | 'dotted-key'

export interface Diagnostic {
  code: DiagnosticCode
  severity: Severity
  message: string
  node: AstNode
  /** Replacements for `node`'s text, best first. */
  suggestions?: string[]
}

export interface CheckOptions {
  schema?: readonly FieldSchema[]
  functions?: Readonly<Record<string, Signature>>
  accessors?: AnalyzeOptions['accessors']
  /** The variable holding the row. Without one, every free name is a field. */
  row?: string
  /**
   * The other variables the host binds, and their types. When given, any name
   * that is neither these, the row nor a field is reported.
   */
  env?: Readonly<Record<string, Type>>
}

export interface CheckResult {
  diagnostics: Diagnostic[]
  type: Type
}

type Node = AstNodeUnion

export const UNKNOWN: Type = { kind: 'unknown' }
const UNDEFINED: Type = { kind: 'undefined' }
const BOOLEAN: Type = { kind: 'boolean' }
const NUMBER: Type = { kind: 'number' }
const STRING: Type = { kind: 'string' }
const MAX_VALUES = 64

const ARITHMETIC = new Set(['-', '*', '/', '//', '%', '^'])
const ORDER = new Set(['<', '<=', '>', '>='])
const EQUALITY = new Set(['==', '!='])
const PRECEDENCE: Record<string, number> = {
  '=': 2,
  '||': 10,
  '??': 10,
  '&&': 11,
  '==': 20,
  '!=': 20,
  '~': 20,
  '!~': 20,
  '<': 20,
  '<=': 20,
  '>': 20,
  '>=': 20,
  in: 20,
  '+': 30,
  '-': 30,
  '*': 40,
  '/': 40,
  '//': 40,
  '%': 50,
  '^': 50
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

function key(name: string) {
  return IDENTIFIER.test(name) ? `.${name}` : `[${quote(name)}]`
}

function quote(text: string) {
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", String.raw`\'`)}'`
}

function precedenceOf(node: Node) {
  switch (node.type) {
    case 'BinaryExpression': {
      return PRECEDENCE[node.operator] ?? 0
    }
    case 'ConditionalExpression':
    case 'Lambda': {
      return 1
    }
    case 'AssignmentExpression': {
      return 2
    }
    case 'SequenceExpression': {
      return 0
    }
    default: {
      return Infinity
    }
  }
}

function operand(ast: AstNode, above: number) {
  const text = print(ast)
  return precedenceOf(ast as Node) < above ? `(${text})` : text
}

const LOGICAL = new Set(['||', '&&'])

// `??` shares an expression with `||` or `&&` only inside parentheses
function logical(parent: BinaryExpression, child: AstNode, above: number) {
  const inner = child as Node
  const mixes =
    inner.type === 'BinaryExpression' &&
    ((parent.operator === '??' && LOGICAL.has(inner.operator)) ||
      (inner.operator === '??' && LOGICAL.has(parent.operator)))
  return mixes ? `(${print(child)})` : operand(child, above)
}

/** Renders a tree back to expression text, for messages and suggestions. */
export function print(ast: AstNode): string {
  const node = ast as Node
  switch (node.type) {
    case 'Literal': {
      return typeof node.value === 'string'
        ? quote(node.value)
        : String(node.value)
    }
    case 'Identifier': {
      return node.from
        ? operand(node.from, Infinity) + key(node.value)
        : node.value
    }
    case 'FilterExpression': {
      return `${operand(node.subject, Infinity)}[${print(node.expr)}]`
    }
    case 'BinaryExpression': {
      const own = PRECEDENCE[node.operator] ?? 0
      const [left, right] =
        node.operator === '^' ? [own + 1, own] : [own, own + 1]
      return `${logical(node, node.left, left)} ${node.operator} ${logical(node, node.right!, right)}`
    }
    case 'UnaryExpression': {
      return node.operator + operand(node.right!, Infinity)
    }
    case 'ConditionalExpression': {
      const test = operand(node.test, 2)
      const alternate = node.alternate ? print(node.alternate) : 'undefined'
      return node.consequent
        ? `${test} ? ${print(node.consequent)} : ${alternate}`
        : `${test} ?: ${alternate}`
    }
    case 'FunctionCall': {
      return `${node.name}(${node.args.map(print).join(', ')})`
    }
    case 'ArrayLiteral': {
      return `[${node.value.map(print).join(', ')}]`
    }
    case 'ObjectLiteral': {
      const entries = Object.entries(node.value).map(
        ([name, value]) =>
          `${IDENTIFIER.test(name) ? name : quote(name)}: ${print(value)}`
      )
      return `{${entries.join(', ')}}`
    }
    case 'TemplateLiteral': {
      const parts = node.parts.map((part) =>
        part.type === 'static'
          ? part.value.replaceAll('`', '\\`').replaceAll('${', '\\${')
          : `\${${print(part.value)}}`
      )
      return `\`${parts.join('')}\``
    }
    case 'SequenceExpression': {
      return node.expressions.map(print).join('; ')
    }
    case 'AssignmentExpression': {
      return `${node.left.value} = ${operand(node.right!, 3)}`
    }
    case 'Lambda': {
      const params =
        node.params.length === 1
          ? node.params[0]
          : `(${node.params.join(', ')})`
      return `${params} => ${print(node.body)}`
    }
    default: {
      return '?'
    }
  }
}

function distance(a: string, b: string) {
  let before: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      if (a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j]!, before[j - 2]! + 1)
      }
    }
    before = previous
    previous = current
  }
  return previous[b.length]!
}

function nearest(name: string, candidates: Iterable<string>) {
  const lower = name.toLowerCase()
  const limit = Math.max(1, Math.floor(name.length / 3))
  const scored: [number, string][] = []
  for (const candidate of candidates) {
    const other = candidate.toLowerCase()
    const score =
      other === lower
        ? 0
        : other.startsWith(lower) && /^[^\w$]/.test(other.slice(lower.length))
          ? 1
          : distance(lower, other)
    if (score <= limit) {
      scored.push([score, candidate])
    }
  }
  return scored
    .sort(([a, x], [b, y]) => a - b || x.localeCompare(y))
    .slice(0, 3)
    .map(([, candidate]) => candidate)
}

function itemOf(field: FieldSchema): Type {
  switch (field.type) {
    case 'number': {
      return field.domain
        ? { kind: 'number', field, domain: field.domain }
        : { kind: 'number', field }
    }
    case 'string': {
      return field.categories
        ? { kind: 'string', field, values: field.categories }
        : { kind: 'string', field }
    }
    case 'boolean':
    case 'flag': {
      return { kind: 'boolean', field }
    }
    case 'record': {
      return { kind: 'record', field, fields: new Map(), open: !!field.open }
    }
  }
}

function typeOfField(field: FieldSchema): Type {
  const cardinality = field.cardinality ?? 'one'
  const item = itemOf(field)
  return cardinality === 'one'
    ? item
    : { kind: 'list', of: item, cardinality, field }
}

type MutableRecord = OfKind<'record'> & { fields: Map<string, Type> }

function recordWithin(type: Type): MutableRecord | undefined {
  if (type.kind === 'record') {
    return type as MutableRecord
  }
  return type.kind === 'list' ? recordWithin(type.of) : undefined
}

/** The type of a row whose fields `schema` declares. */
export function recordOf(schema: readonly FieldSchema[]): Type {
  const own = schema.find((field) => field.path.length === 0)
  const root: MutableRecord = {
    kind: 'record',
    fields: new Map(),
    open: !!own?.open,
    ...(own && { field: own })
  }
  const byDepth = schema
    .filter((field) => field.path.length > 0)
    .toSorted((a, b) => a.path.length - b.path.length)
  for (const field of byDepth) {
    let parent = root
    for (const name of field.path.slice(0, -1)) {
      const next = name === '*' ? parent.each : parent.fields.get(name)
      let record = next && recordWithin(next)
      if (!record) {
        record = { kind: 'record', fields: new Map(), open: true }
        if (name === '*') {
          parent.each = record
        } else {
          parent.fields.set(name, record)
        }
      }
      parent = record
    }
    const name = field.path.at(-1)!
    const type = typeOfField(field)
    if (name === '*') {
      parent.each = type
    } else {
      parent.fields.set(name, type)
    }
  }
  return root
}

function isMulti(type: Type): type is OfKind<'list'> {
  return type.kind === 'list' && type.cardinality !== 1
}

function isBoxed(type: Type): type is OfKind<'list'> {
  return type.kind === 'list' && type.cardinality === 1
}

function isPattern(pattern: string) {
  try {
    new RegExp(pattern.startsWith('(?i)') ? pattern.slice(4) : pattern)
    return true
  } catch {
    return false
  }
}

/**
 * Whether lists of two cardinalities pair value by value everywhere: they do
 * when they are the same, or when either is a single value.
 */
function pairs(a: Cardinality, b: Cardinality) {
  return a === b || a === 1 || b === 1
}

function isNumberish(type: Type): boolean {
  return (
    type.kind === 'number' ||
    type.kind === 'boolean' ||
    type.kind === 'undefined' ||
    (isBoxed(type) && isNumberish(type.of))
  )
}

function domainOf(type: Type): readonly [number, number] | undefined {
  if (type.kind !== 'number') {
    return undefined
  }
  if (type.domain) {
    return type.domain
  }
  return type.values?.length
    ? [Math.min(...type.values), Math.max(...type.values)]
    : undefined
}

function hull(
  a: readonly [number, number] | undefined,
  b: readonly [number, number] | undefined
): readonly [number, number] | undefined {
  return a && b ? [Math.min(a[0], b[0]), Math.max(a[1], b[1])] : undefined
}

function mergeValues<T>(a?: readonly T[], b?: readonly T[]) {
  if (!a || !b) {
    return undefined
  }
  const merged = [...new Set([...a, ...b])]
  return merged.length <= MAX_VALUES ? merged : undefined
}

function sameField(a: FromField, b: FromField) {
  return a.field === b.field ? a.field : undefined
}

function merge(a: Type, b: Type): Type | undefined {
  if (a.kind === 'number' && b.kind === 'number') {
    const values = mergeValues(a.values, b.values)
    const domain = hull(domainOf(a), domainOf(b))
    const field = sameField(a, b)
    return {
      kind: 'number',
      ...(values && { values }),
      ...(domain && !values && { domain }),
      ...(field && { field })
    }
  }
  if (a.kind === 'string' && b.kind === 'string') {
    const values = mergeValues(a.values, b.values)
    const field = sameField(a, b)
    return {
      kind: 'string',
      ...(values && { values }),
      ...(field && { field })
    }
  }
  if (a.kind === 'boolean' && b.kind === 'boolean') {
    return a.field === b.field ? a : BOOLEAN
  }
  if (a.kind === 'list' && b.kind === 'list') {
    return {
      kind: 'list',
      of: union(a.of, b.of),
      cardinality: a.cardinality === b.cardinality ? a.cardinality : 'many'
    }
  }
  if (a.kind === 'record' && b.kind === 'record') {
    return a === b ? a : { kind: 'record', fields: new Map(), open: true }
  }
  return undefined
}

function members(type: Type): readonly Type[] {
  return type.kind === 'union' ? type.of : [type]
}

export function union(a: Type, b: Type): Type {
  if (a.kind === 'undefined') {
    return b
  }
  if (b.kind === 'undefined' || a === b) {
    return a
  }
  if (a.kind === 'unknown' || b.kind === 'unknown') {
    return UNKNOWN
  }
  const out: Type[] = [...members(a)]
  for (const type of members(b)) {
    const index = out.findIndex((existing) => existing.kind === type.kind)
    const merged = index === -1 ? undefined : merge(out[index]!, type)
    if (merged) {
      out[index] = merged
    } else {
      out.push(type)
    }
  }
  return out.length === 1 ? out[0]! : { kind: 'union', of: out }
}

function unionAll(types: Iterable<Type>) {
  let out = UNDEFINED
  for (const type of types) {
    out = union(out, type)
  }
  return out
}

function truthyPart(type: Type): Type {
  switch (type.kind) {
    case 'undefined': {
      return UNDEFINED
    }
    case 'string': {
      return type.values
        ? { ...type, values: type.values.filter(Boolean) }
        : type
    }
    case 'number': {
      return type.values
        ? { ...type, values: type.values.filter(Boolean) }
        : type
    }
    case 'union': {
      return unionAll(type.of.map(truthyPart))
    }
    default: {
      return type
    }
  }
}

function falsyPart(type: Type): Type {
  switch (type.kind) {
    case 'string': {
      return { kind: 'string', values: [''] }
    }
    case 'number': {
      return { kind: 'number', values: [0] }
    }
    case 'boolean':
    case 'unknown': {
      return type
    }
    case 'union': {
      return unionAll(type.of.map(falsyPart))
    }
    default: {
      return UNDEFINED
    }
  }
}

function arithmetic(
  operator: string,
  left: Type,
  right: Type
): OfKind<'number'> {
  const a = domainOf(left)
  const b = domainOf(right)
  const combine: ((x: number, y: number) => number) | undefined =
    operator === '+'
      ? (x, y) => x + y
      : operator === '-'
        ? (x, y) => x - y
        : operator === '*'
          ? (x, y) => x * y
          : operator === '/' && b && (b[0] > 0 || b[1] < 0)
            ? (x, y) => x / y
            : undefined
  if (!combine) {
    return { kind: 'number' }
  }
  const leftValues = left.kind === 'number' ? left.values : undefined
  const rightValues = right.kind === 'number' ? right.values : undefined
  if (
    leftValues &&
    rightValues &&
    leftValues.length * rightValues.length <= MAX_VALUES
  ) {
    return {
      kind: 'number',
      values: [
        ...new Set(
          leftValues.flatMap((x) => rightValues.map((y) => combine(x, y)))
        )
      ]
    }
  }
  if (!a || !b) {
    return { kind: 'number' }
  }
  const corners = [
    combine(a[0], b[0]),
    combine(a[0], b[1]),
    combine(a[1], b[0]),
    combine(a[1], b[1])
  ]
  return {
    kind: 'number',
    domain: [Math.min(...corners), Math.max(...corners)]
  }
}

function paramName(subject: AstNode, context: AstNode) {
  const node = subject as Node
  const base =
    node.type === 'Identifier'
      ? node.value.toLowerCase().replaceAll(/\W/g, '')
      : ''
  const name = IDENTIFIER.test(base) ? base : 'x'
  const text = print(context)
  let candidate = name
  for (let i = 2; new RegExp(String.raw`\b${candidate}\b`).test(text); i++) {
    candidate = `${name}${i}`
  }
  return candidate
}

function literalValue(node: AstNode) {
  return node.type === 'Literal' ? (node as Literal).value : undefined
}

function describe(type: Type): string {
  switch (type.kind) {
    case 'list': {
      return `a list of ${describe(type.of)}`
    }
    case 'record': {
      return 'a record'
    }
    case 'number': {
      return type.values?.length === 1 ? String(type.values[0]) : 'a number'
    }
    case 'string': {
      return type.values?.length === 1 ? quote(type.values[0]!) : 'text'
    }
    case 'boolean': {
      return type.field?.type === 'flag' ? 'a flag' : 'a boolean'
    }
    default: {
      return type.kind
    }
  }
}

function literalOf(type: Type) {
  if (type.kind === 'string' && type.values?.length === 1) {
    return type.values[0]
  }
  return type.kind === 'number' && type.values?.length === 1
    ? type.values[0]
    : undefined
}

function holding(type: OfKind<'list'>) {
  switch (type.cardinality) {
    case 'perAlt': {
      return 'holds one value per ALT allele'
    }
    case 'perAllele': {
      return 'holds one value per allele, REF first'
    }
    case 'perGenotype': {
      return 'holds one value per possible genotype'
    }
    case 'many': {
      return 'holds any number of values'
    }
    default: {
      return `holds ${type.cardinality} values`
    }
  }
}

function firstAbsentIndex(cardinality: Exclude<Cardinality, 'one'>) {
  switch (cardinality) {
    case 'perAlt': {
      return 1
    }
    case 'perAllele': {
      return 2
    }
    case 'perGenotype': {
      return 3
    }
    case 'many': {
      return Infinity
    }
    default: {
      return cardinality
    }
  }
}

/**
 * Checks an expression against the fields a host's data declares and the
 * functions it registers, without evaluating it, and infers what it answers.
 */
export function check(
  ast: AstNode | null,
  { schema, functions, accessors = {}, row, env }: CheckOptions = {}
): CheckResult {
  const diagnostics: Diagnostic[] = []
  const root = schema ? recordOf(schema) : UNKNOWN
  const scope = new Map<string, Type>()

  function report(
    code: DiagnosticCode,
    severity: Severity,
    node: AstNode,
    message: string,
    suggestions?: string[]
  ) {
    diagnostics.push({
      code,
      severity,
      message,
      node,
      ...(suggestions?.length ? { suggestions } : {})
    })
  }

  function text(node: AstNode | undefined, name: string) {
    return node ? print(node) + key(name) : name
  }

  function field(
    subject: Type,
    name: string,
    node: AstNode,
    subjectNode: AstNode | undefined,
    spell = (candidate: string) => text(subjectNode, candidate)
  ): Type {
    const where = subjectNode ? print(subjectNode) : 'the row'
    switch (subject.kind) {
      case 'record': {
        const found = subject.fields.get(name) ?? subject.each
        if (found) {
          return found
        }
        if (!subject.open) {
          const near = nearest(name, subject.fields.keys())
          report(
            'unknown-field',
            'warning',
            node,
            `${where} has no field ${name}` +
              (near.length ? `; did you mean ${near.join(', ')}?` : ''),
            near.map(spell)
          )
        }
        return UNKNOWN
      }
      case 'list': {
        if (name === 'length') {
          return { kind: 'number', domain: [0, Infinity] }
        }
        if (subject.of.kind !== 'record') {
          break
        }
        const item = field(subject.of, name, node, subjectNode, spell)
        if (isMulti(subject)) {
          report(
            'dot-through-list',
            'warning',
            node,
            `${where} ${holding(subject)}; ${key(name)} reads only the first one's` +
              (functions?.any ? ', where any() would test each' : '')
          )
        }
        return item
      }
      case 'string': {
        if (name === 'length') {
          return { kind: 'number', domain: [0, Infinity] }
        }
        break
      }
      case 'number':
      case 'boolean': {
        break
      }
      default: {
        return UNKNOWN
      }
    }
    report(
      'unknown-field',
      'warning',
      node,
      `${where} is ${describe(subject)}, which has no field ${name}`
    )
    return UNKNOWN
  }

  function index(
    subject: Type,
    at: number,
    node: AstNode,
    subjectNode: AstNode
  ): Type {
    const where = print(subjectNode)
    switch (subject.kind) {
      case 'list': {
        const absent = firstAbsentIndex(subject.cardinality)
        if (at >= absent) {
          const fixed = typeof subject.cardinality === 'number'
          report(
            'index-range',
            'warning',
            node,
            fixed
              ? `${where} ${holding(subject)}, so [${at}] is always undefined`
              : `${where} ${holding(subject)}, so [${at}] is undefined on every biallelic record`,
            subject.cardinality === 'perAlt' ? [`${where}[0]`] : []
          )
        }
        return subject.of
      }
      case 'record': {
        return field(subject, String(at), node, subjectNode)
      }
      case 'string': {
        report(
          'index-scalar',
          'warning',
          node,
          `${where} holds one string, so [${at}] reads a single character`,
          [where]
        )
        return STRING
      }
      case 'number':
      case 'boolean': {
        report(
          'index-scalar',
          'warning',
          node,
          `${where} holds one value, so [${at}] reads nothing`,
          [where]
        )
        return UNDEFINED
      }
      default: {
        return UNKNOWN
      }
    }
  }

  function chain(node: Identifier): { base: AstNode; names: string[] } {
    const names = [node.value]
    let base: AstNode = node
    while (base.type === 'Identifier' && (base as Identifier).from) {
      base = (base as Identifier).from!
      if (base.type === 'Identifier') {
        names.unshift((base as Identifier).value)
      }
    }
    return { base, names }
  }

  function dottedKey(node: Identifier): Type | undefined {
    if (!node.from) {
      return undefined
    }
    const { base, names } = chain(node)
    if ((base as Identifier).from) {
      return undefined
    }
    let type = variable(base as Identifier, false)
    let subjectNode: AstNode = base
    for (let i = 1; i < names.length; i++) {
      const record = type.kind === 'record' ? type : undefined
      if (!record) {
        return undefined
      }
      for (let j = names.length; j > i + 1; j--) {
        const whole = names.slice(i, j).join('.')
        const step = record.fields.get(names[i]!)
        const stepReaches =
          step?.kind === 'record' &&
          (step.fields.has(names[i + 1]!) || !!step.each)
        if (record.fields.has(whole) && !stepReaches) {
          const fixed = print(subjectNode) + key(whole)
          report(
            'dotted-key',
            'warning',
            node,
            `${whole} is one field of ${print(subjectNode)}; jexl reads ${names.slice(i, j).join(' then ')}`,
            [[fixed, ...names.slice(j).map((name) => key(name))].join('')]
          )
          let resolved = record.fields.get(whole)!
          for (const name of names.slice(j)) {
            resolved = field(resolved, name, node, undefined)
          }
          return resolved
        }
      }
      const next = record.fields.get(names[i]!)
      if (!next) {
        return undefined
      }
      type = next
      subjectNode = {
        type: 'Identifier',
        value: names[i]!,
        from: subjectNode
      } as Identifier
    }
    return undefined
  }

  function variable(node: Identifier, diagnose = true): Type {
    const name = node.value
    const local = scope.get(name)
    if (local) {
      return local
    }
    if (name === row) {
      return root
    }
    if (env && Object.hasOwn(env, name)) {
      return env[name]!
    }
    if (name === 'undefined') {
      return UNDEFINED
    }
    if (row === undefined && root.kind === 'record') {
      return diagnose
        ? field(root, name, node, undefined)
        : (root.fields.get(name) ?? UNKNOWN)
    }
    if (env && diagnose) {
      const known = [
        ...(row ? [row] : []),
        ...Object.keys(env),
        ...scope.keys()
      ]
      const near = nearest(name, known)
      report(
        'unknown-variable',
        'error',
        node,
        `${name} is not defined here` +
          (near.length ? `; did you mean ${near.join(', ')}?` : ''),
        near
      )
    }
    return UNKNOWN
  }

  function hyphenated(node: AstNodeUnion): Type | undefined {
    if (
      node.type !== 'BinaryExpression' ||
      node.operator !== '-' ||
      node.left.type !== 'Identifier' ||
      node.right?.type !== 'Identifier' ||
      (node.right as Identifier).from
    ) {
      return undefined
    }
    const left = node.left as Identifier
    const reported = diagnostics.length
    const subject = left.from ? infer(left.from) : root
    diagnostics.length = reported
    if (subject.kind !== 'record' || subject.fields.has(left.value)) {
      return undefined
    }
    const whole = `${left.value}-${(node.right as Identifier).value}`
    const found = subject.fields.get(whole)
    if (!found) {
      return undefined
    }
    report(
      'unknown-field',
      'warning',
      node,
      `${print(node)} subtracts; ${whole} is one field`,
      [text(left.from, whole)]
    )
    return found
  }

  function memberFor(
    element: Type,
    value: Type,
    valueNode: AstNode,
    listNode: AstNode,
    node: AstNode
  ) {
    const literal = literalOf(value)
    if (literal === undefined) {
      return
    }
    if (element.kind === 'record' && typeof literal === 'string') {
      const holder = [...element.fields].find(([, type]) => {
        const scalar = type.kind === 'list' ? type.of : type
        return scalar.kind === 'string' && scalar.values?.includes(literal)
      })
      report(
        'never-equal',
        'warning',
        node,
        `${print(listNode)} holds records, so no entry equals ${quote(literal)}` +
          (holder ? `; it is a value of their ${holder[0]} field` : ''),
        holder && functions?.any
          ? [
              `any(${print(listNode)}, ${paramName(listNode, node)} => ${print(valueNode)} in ${paramName(listNode, node)}${key(holder[0])})`
            ]
          : []
      )
      return
    }
    compareLiteral(element, literal, node)
  }

  function compareLiteral(type: Type, literal: string | number, node: AstNode) {
    if (
      type.kind === 'number' &&
      typeof literal === 'string' &&
      Number.isNaN(Number(literal))
    ) {
      report(
        'never-equal',
        'warning',
        node,
        `${quote(literal)} is not a number, so it never equals ${describe(type)}`
      )
    } else if (type.kind === 'boolean' && typeof literal === 'string') {
      report(
        'never-equal',
        'warning',
        node,
        `${describe(type)} never equals the text ${quote(literal)}`,
        literal === 'true' || literal === 'false' ? [literal] : []
      )
    } else if (
      type.kind === 'string' &&
      type.field?.categories &&
      typeof literal === 'string' &&
      !type.field.categories.includes(literal)
    ) {
      const near = nearest(literal, type.field.categories)
      report(
        'unknown-category',
        'warning',
        node,
        `${quote(literal)} is not one of the values the header declares for ${type.field.path.join('.')}` +
          (near.length ? `; did you mean ${near.map(quote).join(', ')}?` : ''),
        near.map(quote)
      )
    } else if (type.kind === 'record') {
      report(
        'never-equal',
        'warning',
        node,
        `a record never equals ${quote(String(literal))}`
      )
    }
  }

  function binary(
    node: Extract<AstNodeUnion, { type: 'BinaryExpression' }>
  ): Type {
    const { operator } = node
    const rightNode = node.right!
    if (operator === '&&' || operator === '||' || operator === '??') {
      const left = infer(node.left)
      const right = infer(rightNode)
      if (operator === '&&') {
        return union(falsyPart(left), right)
      }
      return union(operator === '||' ? truthyPart(left) : left, right)
    }
    const hyphen = hyphenated(node)
    if (hyphen) {
      return hyphen
    }
    const left = infer(node.left)
    const right = infer(rightNode)

    if (operator === '~' || operator === '!~') {
      const pattern = literalOf(right)
      if (typeof pattern === 'string' && !isPattern(pattern)) {
        report(
          'invalid-pattern',
          'error',
          node,
          `${quote(pattern)} is not a valid regular expression`
        )
      }
      return BOOLEAN
    }

    const lists = [left, right].filter(
      (type): type is OfKind<'list'> => type.kind === 'list'
    )
    const [first, second] = lists
    if (
      first &&
      second &&
      (ARITHMETIC.has(operator) || operator === '+') &&
      !pairs(first.cardinality, second.cardinality)
    ) {
      report(
        'list-lengths',
        'warning',
        node,
        `${print(node.left)} ${holding(first)} and ${print(rightNode)} ${holding(second)}, so ${operator} pairs them only where both hold one value`
      )
    }
    const leftItem = left.kind === 'list' ? left.of : left
    const rightItem = right.kind === 'list' ? right.of : right
    const eachOf = (item: Type): Type =>
      first ? { kind: 'list', of: item, cardinality: first.cardinality } : item

    if (operator === '+') {
      if (leftItem.kind === 'string' || rightItem.kind === 'string') {
        const values =
          leftItem.kind === 'string' &&
          rightItem.kind === 'string' &&
          leftItem.values &&
          rightItem.values &&
          leftItem.values.length * rightItem.values.length <= MAX_VALUES
            ? leftItem.values.flatMap((a) =>
                rightItem.values!.map((b) => a + b)
              )
            : undefined
        return eachOf(values ? { kind: 'string', values } : STRING)
      }
      return isNumberish(leftItem) && isNumberish(rightItem)
        ? eachOf(arithmetic('+', leftItem, rightItem))
        : UNKNOWN
    }

    if (ARITHMETIC.has(operator) || ORDER.has(operator)) {
      for (const [type, typeNode, other] of [
        [leftItem, node.left, rightItem],
        [rightItem, rightNode, leftItem]
      ] as const) {
        const numericOther = ARITHMETIC.has(operator) || isNumberish(other)
        if (type.kind === 'string' && type.field && numericOther) {
          report(
            'string-numeric',
            'warning',
            node,
            `${print(typeNode)} is text, so ${operator} converts it to a number, ${ORDER.has(operator) ? 'answering false' : 'giving NaN'} wherever it is not one`,
            functions?.parseFloat
              ? [
                  print(node).replace(
                    print(typeNode),
                    `parseFloat(${print(typeNode)})`
                  )
                ]
              : []
          )
        }
      }
      return ORDER.has(operator)
        ? BOOLEAN
        : eachOf(arithmetic(operator, leftItem, rightItem))
    }

    if (EQUALITY.has(operator)) {
      const leftLiteral = literalOf(leftItem)
      const rightLiteral = literalOf(rightItem)
      if (rightLiteral !== undefined && node.right?.type === 'Literal') {
        compareLiteral(leftItem, rightLiteral, node)
      } else if (leftLiteral !== undefined && node.left.type === 'Literal') {
        compareLiteral(rightItem, leftLiteral, node)
      }
      return BOOLEAN
    }

    if (operator === 'in') {
      if (right.kind === 'list') {
        memberFor(right.of, leftItem, node.left, rightNode, node)
      } else if (right.kind === 'number' || right.kind === 'boolean') {
        report(
          'never-equal',
          'warning',
          node,
          `in tests a list, text or an object's keys, and ${print(rightNode)} is ${describe(right)}`
        )
      }
      return BOOLEAN
    }
    return UNKNOWN
  }

  function argumentProblem(param: ParamType, type: Type): string | undefined {
    switch (param) {
      case 'any':
      case 'boolean':
      case 'member':
      case 'lambda': {
        return undefined
      }
      case 'number': {
        if (type.kind === 'string' && type.field) {
          return 'is text'
        }
        return isMulti(type) || type.kind === 'record'
          ? `is ${describe(type)}`
          : undefined
      }
      case 'string': {
        return isMulti(type) || type.kind === 'record'
          ? `is ${describe(type)}`
          : undefined
      }
      case 'list': {
        return ['number', 'string', 'boolean', 'record'].includes(type.kind)
          ? `is ${describe(type)}`
          : undefined
      }
      case 'record': {
        return ['number', 'string', 'boolean', 'list'].includes(type.kind)
          ? `is ${describe(type)}`
          : undefined
      }
    }
  }

  function lambda(node: Lambda, item: Type): Type {
    const saved = node.params.map((name) => [name, scope.get(name)] as const)
    node.params.forEach((name, i) => {
      scope.set(name, i === 0 ? item : NUMBER)
    })
    const returns = infer(node.body)
    for (const [name, previous] of saved) {
      if (previous) {
        scope.set(name, previous)
      } else {
        scope.delete(name)
      }
    }
    return { kind: 'lambda', returns }
  }

  function call(node: FunctionCall): Type {
    const { name, args } = node
    const prefix = Object.hasOwn(accessors, name) ? accessors[name] : undefined
    if (prefix && args[0]) {
      const [subjectArg, ...keyArgs] = args as [AstNode, ...AstNode[]]
      let type = infer(subjectArg)
      let subjectNode = subjectArg
      const step = (name: string, at: AstNode, spell?: typeof quote) => {
        type = field(type, name, at, subjectNode, spell)
        subjectNode = {
          type: 'Identifier',
          value: name,
          from: subjectNode
        } as Identifier
      }
      for (const name of prefix) {
        step(String(name), node)
      }
      for (const arg of keyArgs) {
        const name = literalValue(arg)
        if (typeof name !== 'string' && typeof name !== 'number') {
          keyArgs.forEach(infer)
          return UNKNOWN
        }
        step(String(name), arg, quote)
      }
      return type
    }
    const signature =
      functions && Object.hasOwn(functions, name) ? functions[name] : undefined
    if (!signature) {
      for (const arg of args) {
        if ((arg as Node).type !== 'Lambda') {
          infer(arg)
        }
      }
      if (functions) {
        const near = nearest(name, Object.keys(functions))
        report(
          'unknown-function',
          'error',
          node,
          `no function ${name}` +
            (near.length ? `; did you mean ${near.join(', ')}?` : ''),
          near.map((candidate) =>
            print({ ...node, name: candidate } as FunctionCall)
          )
        )
      }
      return UNKNOWN
    }
    const { params, optional = 0, variadic = false } = signature
    const least = params.length - optional - (variadic ? 1 : 0)
    const most = variadic ? Infinity : params.length
    if (args.length < least || args.length > most) {
      report(
        'arity',
        'error',
        node,
        `${name} takes ${least === most ? least : most === Infinity ? `at least ${least}` : `${least} to ${most}`} argument${most === 1 ? '' : 's'}, not ${args.length}`
      )
    }
    const types: Type[] = []
    let lastCollection: Type | undefined
    let lastCollectionNode: AstNode | undefined
    for (const [i, arg] of args.entries()) {
      const declared = params[Math.min(i, params.length - 1)]
      if (declared === undefined || (!variadic && i >= params.length)) {
        types.push(infer(arg))
        continue
      }
      const accepted: readonly ParamType[] =
        typeof declared === 'string' ? [declared] : declared
      if ((arg as Node).type === 'Lambda') {
        const item =
          lastCollection?.kind === 'list' ? lastCollection.of : UNKNOWN
        types.push(lambda(arg as Lambda, item))
        continue
      }
      const type = infer(arg)
      types.push(type)
      if (accepted.includes('lambda')) {
        report(
          'argument-type',
          'error',
          arg,
          `${name} expects a function such as x => …, not ${print(arg)}`
        )
        continue
      }
      if (accepted.includes('member') && lastCollection && lastCollectionNode) {
        if (lastCollection.kind === 'list') {
          memberFor(lastCollection.of, type, arg, lastCollectionNode, node)
        }
        continue
      }
      const problems = accepted.map((param) => argumentProblem(param, type))
      if (problems.every(Boolean)) {
        report(
          isMulti(type)
            ? 'list-operand'
            : type.kind === 'string'
              ? 'string-numeric'
              : 'argument-type',
          'warning',
          arg,
          `${name} expects ${accepted.join(' or ')} as argument ${i + 1}, but ${print(arg)} ${problems[0]}`
        )
      }
      if (accepted.includes('list')) {
        lastCollection = type
        lastCollectionNode = arg
      }
    }
    const { returns } = signature
    if (typeof returns === 'function') {
      return returns(types)
    }
    if (typeof returns === 'string') {
      return { kind: returns }
    }
    return returns ?? UNKNOWN
  }

  function infer(ast: AstNode): Type {
    const node = ast as Node
    switch (node.type) {
      case 'Literal': {
        const { value } = node
        return typeof value === 'number'
          ? { kind: 'number', values: [value] }
          : typeof value === 'string'
            ? { kind: 'string', values: [value] }
            : BOOLEAN
      }
      case 'Identifier': {
        if (!node.from) {
          return variable(node)
        }
        const dotted = dottedKey(node)
        if (dotted) {
          return dotted
        }
        return field(infer(node.from), node.value, node, node.from)
      }
      case 'FilterExpression': {
        const subject = infer(node.subject)
        const at = literalValue(node.expr)
        if (typeof at === 'number') {
          return index(subject, at, node, node.subject)
        }
        if (typeof at === 'string') {
          if (subject.kind === 'list') {
            report(
              'unknown-field',
              'warning',
              node,
              `${print(node.subject)} is ${describe(subject)}, so [${quote(at)}] reads nothing`
            )
            return UNDEFINED
          }
          return field(subject, at, node, node.subject)
        }
        const by = infer(node.expr)
        if (isMulti(by)) {
          report(
            'list-operand',
            'warning',
            node,
            `${print(node.expr)} ${holding(by)}, so indexing by it finds an entry only when there is exactly one`
          )
        }
        if (subject.kind === 'record') {
          return unionAll([
            ...subject.fields.values(),
            subject.each ?? UNDEFINED
          ])
        }
        return subject.kind === 'list' ? subject.of : UNKNOWN
      }
      case 'BinaryExpression': {
        return binary(node)
      }
      case 'UnaryExpression': {
        const right = infer(node.right!)
        if (node.operator === '!') {
          return BOOLEAN
        }
        if (node.operator === '-') {
          if (isMulti(right)) {
            report(
              'list-operand',
              'warning',
              node,
              `${print(node.right!)} ${holding(right)}, so - negates only a lone value`
            )
          }
          const domain = domainOf(right)
          if (right.kind === 'number' && right.values) {
            return { kind: 'number', values: right.values.map((v) => -v) }
          }
          return domain
            ? { kind: 'number', domain: [-domain[1], -domain[0]] }
            : NUMBER
        }
        return UNKNOWN
      }
      case 'ConditionalExpression': {
        const test = infer(node.test)
        const consequent = node.consequent
          ? infer(node.consequent)
          : truthyPart(test)
        const alternate = node.alternate ? infer(node.alternate) : UNDEFINED
        return union(consequent, alternate)
      }
      case 'FunctionCall': {
        return call(node)
      }
      case 'ArrayLiteral': {
        const items = node.value.map(infer)
        return {
          kind: 'list',
          of: unionAll(items),
          cardinality: items.length
        }
      }
      case 'ObjectLiteral': {
        return {
          kind: 'record',
          fields: new Map(
            Object.entries(node.value).map(([name, value]) => [
              name,
              infer(value)
            ])
          ),
          open: false
        }
      }
      case 'TemplateLiteral': {
        let values: string[] | undefined = ['']
        for (const part of node.parts) {
          if (part.type === 'static') {
            values = values?.map((value) => value + part.value)
          } else {
            const type = infer(part.value)
            const options =
              type.kind === 'string' || type.kind === 'number'
                ? type.values?.map(String)
                : undefined
            values =
              values && options && values.length * options.length <= MAX_VALUES
                ? values.flatMap((value) =>
                    options.map((option) => value + option)
                  )
                : undefined
          }
        }
        return values ? { kind: 'string', values } : STRING
      }
      case 'SequenceExpression': {
        let last: Type = UNDEFINED
        for (const expr of node.expressions) {
          last = infer(expr)
        }
        return last
      }
      case 'AssignmentExpression': {
        const value = infer(node.right!)
        scope.set(node.left.value, value)
        return value
      }
      case 'Lambda': {
        return lambda(node, UNKNOWN)
      }
      default: {
        throw new Error(`Corrupt AST: unknown node type '${ast.type}'`)
      }
    }
  }

  const type = ast ? infer(ast) : UNDEFINED
  return { diagnostics, type }
}
