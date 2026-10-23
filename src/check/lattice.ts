/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import {
  BOOLEAN,
  MAX_VALUES,
  NUMBER,
  STRING,
  UNDEFINED,
  UNKNOWN
} from './types.ts'

import type { Cardinality, FromField, OfKind, Type } from './types.ts'

export function isMulti(type: Type): type is OfKind<'list'> {
  return type.kind === 'list' && type.cardinality !== 1
}

export function isBoxed(type: Type): type is OfKind<'list'> {
  return type.kind === 'list' && type.cardinality === 1
}

/**
 * Whether lists of two cardinalities pair value by value everywhere: they do
 * when they are the same, or when either is a single value.
 */
export function pairs(a: Cardinality, b: Cardinality) {
  return a === b || a === 1 || b === 1
}

export function isNumberish(type: Type): boolean {
  return (
    type.kind === 'number' ||
    type.kind === 'boolean' ||
    type.kind === 'undefined' ||
    (isBoxed(type) && isNumberish(type.of))
  )
}

export function domainOf(type: Type): readonly [number, number] | undefined {
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

export function hull(
  a: readonly [number, number] | undefined,
  b: readonly [number, number] | undefined
): readonly [number, number] | undefined {
  return a && b ? [Math.min(a[0], b[0]), Math.max(a[1], b[1])] : undefined
}

export function mergeValues<T>(a?: readonly T[], b?: readonly T[]) {
  if (!a || !b) {
    return undefined
  }
  const merged = [...new Set([...a, ...b])]
  return merged.length <= MAX_VALUES ? merged : undefined
}

export function sameField(a: FromField, b: FromField) {
  return a.field === b.field ? a.field : undefined
}

export function merge(a: Type, b: Type): Type | undefined {
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

export function members(type: Type): readonly Type[] {
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

export function unionAll(types: Iterable<Type>) {
  let out = UNDEFINED
  for (const type of types) {
    out = union(out, type)
  }
  return out
}

export function truthyPart(type: Type): Type {
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

export function falsyPart(type: Type): Type {
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

export function arithmetic(
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

export function textValues(type: Type) {
  return type.kind === 'string' || type.kind === 'number'
    ? type.values?.map(String)
    : undefined
}

/**
 * `+` with text on either side joins as JavaScript joins, rather than pairing
 * list values, so `REF + '>' + ALT` is one string.
 */
export function joined(left: Type, right: Type): Type {
  const a = textValues(left)
  const b = textValues(right)
  return a && b && a.length * b.length <= MAX_VALUES
    ? { kind: 'string', values: a.flatMap((x) => b.map((y) => x + y)) }
    : STRING
}

export function negate(type: Type): Type {
  switch (type.kind) {
    case 'list': {
      return {
        kind: 'list',
        of: negate(type.of),
        cardinality: type.cardinality
      }
    }
    case 'union': {
      return unionAll(type.of.map(negate))
    }
    case 'unknown': {
      return UNKNOWN
    }
    case 'number': {
      if (type.values) {
        return { kind: 'number', values: type.values.map((v) => -v) }
      }
      return type.domain
        ? { kind: 'number', domain: [-type.domain[1], -type.domain[0]] }
        : NUMBER
    }
    default: {
      return NUMBER
    }
  }
}
