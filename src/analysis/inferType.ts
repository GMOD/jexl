/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { AstNode, AstNodeUnion, Identifier, JexlValue } from '../types.ts'

/** What a value can be, as far as the expression's text can tell. */
export type JexlType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'array'
  | 'object'
  | 'unknown'

export interface TypeEnv {
  /**
   * The declared type of each name an expression may read — a VCF header's
   * `Type=`, or a type a host read off a sample of the data. A dotted path is
   * looked up whole.
   */
  names?: Record<string, JexlType>
  /** What each function returns. */
  functions?: Record<string, JexlType>
  /** A root identifier whose members are the names, as `feature.score` is. */
  dataPronoun?: string
}

export interface InferredType {
  /** Every type the expression can answer; `unknown` where a part is. */
  types: ReadonlySet<JexlType>
  /**
   * The answers themselves, where every one is a literal in the expression
   * — `a ? 'red' : 'blue'` answers one of two — in the order written.
   */
  values?: readonly JexlValue[]
}

const MAX_VALUES = 64

const NUMERIC = new Set(['-', '*', '/', '//', '%', '^'])
const BOOLEAN = new Set(['==', '!=', '>', '>=', '<', '<=', 'in'])

function typeOf(value: JexlValue): JexlType {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value as JexlType
}

function of(...types: JexlType[]): InferredType {
  return { types: new Set(types) }
}

function literal(value: JexlValue): InferredType {
  return { types: new Set([typeOf(value)]), values: [value] }
}

const UNKNOWN = of('unknown')

function union(a: InferredType, b: InferredType): InferredType {
  const types = new Set([...a.types, ...b.types])
  const values =
    a.values && b.values ? [...new Set([...a.values, ...b.values])] : undefined
  return values && values.length <= MAX_VALUES ? { types, values } : { types }
}

// the part of a value set a truthiness test lets through
function truthy(t: InferredType, want: boolean): InferredType {
  if (t.values) {
    const values = t.values.filter((v) => Boolean(v) === want)
    return { types: new Set(values.map(typeOf)), values }
  }
  return t
}

function pathOf(node: Identifier): string[] | undefined {
  const names: string[] = []
  let current: AstNode | undefined = node
  while (current?.type === 'Identifier') {
    names.unshift((current as Identifier).value)
    current = (current as Identifier).from
  }
  return current ? undefined : names
}

function identifier(node: Identifier, env: TypeEnv): InferredType {
  const path = pathOf(node)
  if (!path) {
    return UNKNOWN
  }
  const names = path[0] === env.dataPronoun ? path.slice(1) : path
  const declared = env.names?.[names.join('.')]
  return declared ? of(declared) : UNKNOWN
}

const NUMERIC_PRIMITIVES = new Set<JexlType>([
  'number',
  'boolean',
  'null',
  'undefined'
])
const STRINGY = new Set<JexlType>(['string', 'array', 'object'])

function only(t: InferredType, types: ReadonlySet<JexlType>) {
  return [...t.types].every((type) => types.has(type))
}

// `+` adds numeric primitives and concatenates once either side is a string
// or turns into one
function plus(left: InferredType, right: InferredType): InferredType {
  if (only(left, NUMERIC_PRIMITIVES) && only(right, NUMERIC_PRIMITIVES)) {
    return of('number')
  }
  return only(left, STRINGY) || only(right, STRINGY)
    ? of('string')
    : of('number', 'string')
}

function booleans(values: readonly boolean[]): InferredType {
  return { types: new Set(['boolean']), values }
}

/**
 * The types an expression can answer, read off its tree, and the answers
 * themselves where they are a finite set of literals. Operators follow the
 * built-in grammar: arithmetic answers a number, a comparison a boolean, a
 * template a string, `?:`, `&&` and `||` the union of their branches. A name
 * or a function answers what `env` declares for it, and `unknown` otherwise.
 */
export function inferType(
  ast: AstNode | null,
  env: TypeEnv = {}
): InferredType {
  if (!ast) {
    return literal(undefined)
  }
  const node = ast as AstNodeUnion
  const infer = (child: AstNode) => inferType(child, env)
  switch (node.type) {
    case 'Literal': {
      return literal(node.value)
    }
    case 'Identifier': {
      return identifier(node, env)
    }
    case 'UnaryExpression': {
      if (node.operator === '!') {
        const { values } = infer(node.right!)
        return booleans(
          values ? [...new Set(values.map((v) => !v))] : [true, false]
        )
      }
      return node.operator === '-' ? of('number') : UNKNOWN
    }
    case 'BinaryExpression': {
      const { operator } = node
      if (NUMERIC.has(operator)) {
        return of('number')
      }
      if (BOOLEAN.has(operator)) {
        return booleans([true, false])
      }
      const left = infer(node.left)
      const right = infer(node.right!)
      if (operator === '+') {
        return plus(left, right)
      }
      if (operator === '&&') {
        return union(truthy(left, false), right)
      }
      if (operator === '||') {
        return union(truthy(left, true), right)
      }
      return UNKNOWN
    }
    case 'ConditionalExpression': {
      const test = infer(node.test)
      const yes = node.consequent ? infer(node.consequent) : truthy(test, true)
      const no = node.alternate ? infer(node.alternate) : literal(undefined)
      return union(yes, no)
    }
    case 'TemplateLiteral': {
      return of('string')
    }
    case 'FunctionCall': {
      const declared = env.functions?.[node.name]
      return declared ? of(declared) : UNKNOWN
    }
    case 'ArrayLiteral': {
      return of('array')
    }
    case 'ObjectLiteral': {
      return of('object')
    }
    case 'SequenceExpression': {
      const last = node.expressions.at(-1)
      return last ? infer(last) : literal(undefined)
    }
    case 'AssignmentExpression': {
      return infer(node.right!)
    }
    default: {
      return UNKNOWN
    }
  }
}
