/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { LAMBDA } from '../collections.ts'

import type { Context } from './context.ts'
import type { Lambda } from '../collections.ts'
import type { AstNode, JexlValue } from '../types.ts'

/**
 * Writes a key that a plain assignment would mishandle. Storing to
 * "__proto__" invokes the prototype setter rather than creating a property, so
 * an object literal or assignment using that key silently lost its value (and
 * re-pointed the target's prototype). Defining the property instead matches
 * what `JSON.parse('{"__proto__":1}')` produces: an ordinary own property.
 */
export function defineOwn(target: Context, key: string, value: JexlValue) {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  })
}

export function assignOwn(target: Context, key: string, value: JexlValue) {
  target[key] = value
}

// inherited, these lead from any value to `Function` and `Object.prototype`
export const isUnsafeKey = (key: string | number) =>
  key === 'constructor' || key === '__proto__'

/**
 * The value, unless it is a function other than a lambda. A read reaches host
 * functions — `[].map`, `{}.__lookupGetter__`, a method of a context object —
 * and JavaScript calls them on its own: `{valueOf: f} + 1` runs `f`, as does
 * the `toJSON` a template renders, and a registered function may call what
 * it is handed.
 */
export function sandboxed(value: unknown): JexlValue {
  return typeof value === 'function' && !(value as Lambda)[LAMBDA]
    ? undefined
    : (value as JexlValue)
}

export function member(target: Context, key: string | number) {
  return isUnsafeKey(key) && !Object.hasOwn(target, key)
    ? undefined
    : sandboxed(target[key])
}

/** The key `subject[index]` reads under, or undefined when it reads nothing. */
export function memberKey(index: JexlValue) {
  return typeof index === 'string' || typeof index === 'number'
    ? index
    : indexKey(index)
}

/**
 * The key a bracket index that is neither a string nor a number reads under:
 * its string form, when it has one worth using.
 *
 * A boolean and an array of primitives do — `['a']` is the key `'a'`, exactly
 * as JS would index by it, and how a `@gmod/vcf` INFO value (always a list,
 * `Number=1` included) indexes a lookup table. A multi-valued list is the key
 * `'a,b'`, and misses rather than guess which value was meant. A plain object
 * does not, since '[object Object]' is not a key anything is stored under, so
 * it and an array holding one answer `undefined` instead. null and undefined
 * are the same case.
 */
function indexKey(value: JexlValue): string | undefined {
  if (typeof value === 'boolean') {
    return String(value)
  }
  return Array.isArray(value) && value.every(isKeyPart)
    ? value.join(',')
    : undefined
}

function isKeyPart(
  value: JexlValue
): value is string | number | boolean | null | undefined {
  return (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

/**
 * The value of an object or array literal holding only primitives, built once.
 * Indexing such a table, as in `{CDS: 'red', exon: 'blue'}[feature.type]`,
 * can only yield a primitive, so the table never escapes and one frozen copy
 * serves every evaluation.
 */
export function literalTable(node: AstNode) {
  if (node.type === 'ArrayLiteral') {
    return node.value.every((item) => item.type === 'Literal')
      ? Object.freeze(node.value.map((item) => item.value))
      : undefined
  }
  if (node.type !== 'ObjectLiteral') {
    return undefined
  }
  const table: Context = {}
  for (const [key, value] of Object.entries(node.value)) {
    if (value.type !== 'Literal') {
      return undefined
    }
    defineOwn(table, key, value.value)
  }
  return Object.freeze(table)
}
