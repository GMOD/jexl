/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { analyze } from './analyze.ts'
import { print } from './print.ts'

import type { PathKey } from './analyze.ts'
import type { AstNode, AstNodeUnion } from './types.ts'

export type Scalar = string | number | boolean | null

/**
 * What a condition tests: a path off the row (`feature.INFO.DP`, or
 * `get(feature, 'score')` through an accessor), or a host function of the row
 * such as `maf(feature)` or `genotypeCount(feature, 'het')`.
 */
export type Subject =
  | { kind: 'path'; path: PathKey[]; node: AstNode }
  | { kind: 'call'; name: string; args: Scalar[]; node: AstNode }

export type Condition =
  | {
      subject: Subject
      op: '==' | '!=' | '<' | '<=' | '>' | '>='
      value: Scalar
    }
  | { subject: Subject; op: '~' | '!~'; value: string }
  | { subject: Subject; op: 'in' | '!in'; value: Scalar[] }
  | { subject: Subject; op: 'has' | '!has'; value: string }
  | { subject: Subject; op: 'set' | '!set' }

export interface ConditionOptions {
  /** The variable holding the record, e.g. `feature`. */
  row: string
  /** Functions that read a path off the row, as {@link analyze} takes them. */
  accessors?: Record<string, readonly PathKey[]>
  /** Host functions of the row, e.g. `maf`, that a condition may test. */
  calls?: readonly string[]
}

const COMPARE = new Set(['==', '!=', '<', '<=', '>', '>='])
const FLIP: Record<string, Condition['op']> = {
  '==': '==',
  '!=': '!=',
  '<': '>',
  '<=': '>=',
  '>': '<',
  '>=': '<='
}

function scalar(ast: AstNode): { value: Scalar } | undefined {
  const node = ast as AstNodeUnion
  if (node.type === 'Literal') {
    return { value: node.value }
  }
  return node.type === 'TemplateLiteral' &&
    node.parts.every((part) => part.type === 'static')
    ? { value: node.parts.map((part) => part.value).join('') }
    : undefined
}

function isRow(ast: AstNode | undefined, row: string) {
  const node = ast as AstNodeUnion | undefined
  return node?.type === 'Identifier' && !node.from && node.value === row
}

function subjectOf(ast: AstNode, opts: ConditionOptions): Subject | undefined {
  const node = ast as AstNodeUnion
  if (
    node.type === 'FunctionCall' &&
    opts.calls?.includes(node.name) &&
    isRow(node.args[0], opts.row)
  ) {
    const rest = node.args.slice(1).map(scalar)
    return rest.every(Boolean)
      ? {
          kind: 'call',
          name: node.name,
          args: rest.map((arg) => arg!.value),
          node
        }
      : undefined
  }
  const accessor =
    node.type === 'FunctionCall' &&
    Object.hasOwn(opts.accessors ?? {}, node.name)
  if (
    node.type !== 'Identifier' &&
    node.type !== 'FilterExpression' &&
    !accessor
  ) {
    return undefined
  }
  const read = analyze(node, { row: opts.row, accessors: opts.accessors })
  const [first] = read.reads
  const literalAccess =
    accessor &&
    read.reads.length === 1 &&
    read.calls.length === 1 &&
    read.calls[0]!.args.slice(1).every((arg) => arg.type === 'literal')
  return (read.bare || literalAccess) &&
    first?.root === opts.row &&
    !first.dynamic &&
    first.path.length > 0
    ? { kind: 'path', path: first.path, node }
    : undefined
}

function condition(
  ast: AstNode,
  opts: ConditionOptions
): Condition | undefined {
  const node = ast as AstNodeUnion
  if (node.type === 'UnaryExpression' && node.operator === '!') {
    const inner = condition(node.right!, opts)
    // only forms whose negation reads as a condition of its own; `!(QUAL > 30)`
    // holds where QUAL is missing, which `QUAL <= 30` does not
    return inner?.op === 'in' || inner?.op === 'has' || inner?.op === 'set'
      ? ({ ...inner, op: `!${inner.op}` } as Condition)
      : undefined
  }
  if (node.type !== 'BinaryExpression') {
    const subject = subjectOf(node, opts)
    return subject && { subject, op: 'set' }
  }
  const { operator, left } = node
  const right = node.right!
  if (COMPARE.has(operator)) {
    const subject = subjectOf(left, opts)
    const value = scalar(right)
    if (subject && value) {
      return { subject, op: operator as '==', value: value.value }
    }
    const flipped = subjectOf(right, opts)
    const leftValue = scalar(left)
    return flipped && leftValue
      ? {
          subject: flipped,
          op: FLIP[operator] as '==',
          value: leftValue.value
        }
      : undefined
  }
  if (operator === '~' || operator === '!~') {
    const subject = subjectOf(left, opts)
    const value = scalar(right)
    return subject && typeof value?.value === 'string'
      ? { subject, op: operator, value: value.value }
      : undefined
  }
  if (operator === 'in') {
    const subject = subjectOf(left, opts)
    const list = right as AstNodeUnion
    if (subject && list.type === 'ArrayLiteral') {
      const values = list.value.map(scalar)
      return values.length > 0 && values.every(Boolean)
        ? { subject, op: 'in', value: values.map((value) => value!.value) }
        : undefined
    }
    const key = scalar(left)
    const container = subjectOf(right, opts)
    return container && typeof key?.value === 'string'
      ? { subject: container, op: 'has', value: key.value }
      : undefined
  }
  return undefined
}

/**
 * Reads an expression as conditions all of which must hold — `a && b && …`,
 * each comparing a field of the row with a literal — or answers undefined when
 * any part is something else. A filter editor shows the conditions as rows and
 * keeps anything undefined as text, so a line it cannot read is never
 * misread.
 */
export function conditions(
  ast: AstNode | null,
  opts: ConditionOptions
): Condition[] | undefined {
  const node = ast as AstNodeUnion | null
  if (!node) {
    return undefined
  }
  if (node.type === 'BinaryExpression' && node.operator === '&&') {
    const left = conditions(node.left, opts)
    const right = left && conditions(node.right!, opts)
    return left && right && [...left, ...right]
  }
  const found = condition(node, opts)
  return found && [found]
}

const literal = (value: Scalar) =>
  print({ type: 'Literal', value } as AstNodeUnion)

/** A subject reading `path` off the row, for a condition built from a picker. */
export function pathSubject(row: string, path: PathKey[]): Subject {
  let node: AstNode = { type: 'Identifier', value: row } as AstNodeUnion
  for (const key of path) {
    node =
      typeof key === 'string'
        ? ({ type: 'Identifier', value: key, from: node } as AstNodeUnion)
        : ({
            type: 'FilterExpression',
            subject: node,
            expr: { type: 'Literal', value: key }
          } as AstNodeUnion)
  }
  return { kind: 'path', path, node }
}

/** A subject calling a host function of the row, such as `maf(feature)`. */
export function callSubject(
  row: string,
  name: string,
  args: Scalar[] = []
): Subject {
  const node = {
    type: 'FunctionCall',
    name,
    args: [
      { type: 'Identifier', value: row },
      ...args.map((value) => ({ type: 'Literal', value }))
    ]
  } as AstNodeUnion
  return { kind: 'call', name, args, node }
}

/** Writes one condition as expression text that {@link conditions} reads back. */
export function printCondition(c: Condition) {
  const subject = print(c.subject.node)
  switch (c.op) {
    case 'set': {
      return subject
    }
    case '!set': {
      return `!${subject}`
    }
    case 'has': {
      return `${literal(c.value)} in ${subject}`
    }
    case '!has': {
      return `!(${literal(c.value)} in ${subject})`
    }
    case 'in': {
      return `${subject} in [${c.value.map(literal).join(', ')}]`
    }
    case '!in': {
      return `!(${subject} in [${c.value.map(literal).join(', ')}])`
    }
    default: {
      return `${subject} ${c.op} ${literal(c.value)}`
    }
  }
}

/** Writes conditions as one expression requiring all of them. */
export function fromConditions(list: readonly Condition[]) {
  return list.map(printCondition).join(' && ')
}
