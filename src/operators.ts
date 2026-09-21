/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { JexlValue } from './types.ts'

type Test = (left: JexlValue, right: JexlValue) => boolean
type Arithmetic = (left: JexlValue, right: JexlValue) => JexlValue

export function isList(left: JexlValue, right: JexlValue) {
  return Array.isArray(left) || Array.isArray(right)
}

/**
 * A comparison over list operands: it holds when it holds for any value, as
 * bcftools compares a multi-valued tag, so `AF > 0.05` is true when any
 * allele's frequency is and `CLNSIG == 'Pathogenic'` when any significance is.
 * Each operator calls this only once {@link isList} says it must, so the
 * comparison of two single values stays a direct call V8 can inline.
 */
export function anyPair(
  test: Test,
  left: JexlValue,
  right: JexlValue
): boolean {
  return Array.isArray(left)
    ? left.some((l) => anyPair(test, l, right))
    : Array.isArray(right)
      ? right.some((r) => test(left, r))
      : test(left, right)
}

/**
 * Arithmetic over list operands, value by value, as bcftools and R apply it:
 * `AC / AN` divides each count, and a list of one, or a lone value, pairs with
 * every value of the other side. Lists of two other lengths have no pairing
 * and yield undefined.
 */
export function pairwise(
  fn: Arithmetic,
  left: JexlValue,
  right: JexlValue
): JexlValue {
  const ls = Array.isArray(left) ? left : [left]
  const rs = Array.isArray(right) ? right : [right]
  if (ls.length !== rs.length && ls.length !== 1 && rs.length !== 1) {
    return undefined
  }
  const length = ls.length === 1 ? rs.length : ls.length
  const out: JexlValue[] = new Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = fn(
      ls.length === 1 ? ls[0] : ls[i],
      rs.length === 1 ? rs[0] : rs[i]
    )
  }
  return out
}

const patterns = new Map<string, RegExp>()
const MAX_PATTERNS = 1000

/**
 * The regular expression a pattern string stands for. A leading `(?i)`, the
 * inline flag PCRE, Python and Go read, makes it case-insensitive.
 */
function regex(pattern: string) {
  let re = patterns.get(pattern)
  if (!re) {
    re = pattern.startsWith('(?i)')
      ? new RegExp(pattern.slice(4), 'i')
      : new RegExp(pattern)
    if (patterns.size >= MAX_PATTERNS) {
      patterns.clear()
    }
    patterns.set(pattern, re)
  }
  return re
}

/** Whether a value, or any value of a list, matches a pattern string. */
export function matches(value: JexlValue, pattern: JexlValue): boolean {
  if (typeof pattern !== 'string') {
    return false
  }
  const re = regex(pattern)
  const test = (v: JexlValue) =>
    (typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean') &&
    re.test(String(v))
  return Array.isArray(value) ? value.some(test) : test(value)
}

/**
 * Whether a value is in a container: a substring of a string, a member of a
 * list or Set, or a key of a Map or plain object. A list on the left is in
 * the container when any of its values is.
 */
export function isIn(left: JexlValue, right: JexlValue): boolean {
  if (Array.isArray(left)) {
    return left.some((l) => isIn(l, right))
  }
  if (typeof right === 'string') {
    // only a primitive has a meaningful substring form. An absent or
    // structured left operand is not "in" a string, and must not be coerced
    // to '' — every string contains the empty string
    return typeof left === 'string' ||
      typeof left === 'number' ||
      typeof left === 'boolean'
      ? right.includes(String(left))
      : false
  }
  if (Array.isArray(right)) {
    return right.includes(left)
  }
  if (right instanceof Set || right instanceof Map) {
    return right.has(left)
  }
  if (
    typeof right === 'object' &&
    right !== null &&
    (typeof left === 'string' || typeof left === 'number')
  ) {
    return Object.hasOwn(right, left)
  }
  return false
}
