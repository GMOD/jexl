/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { toRegExp } from '../operators.ts'
import { isName, print, quote } from '../print.ts'

import type { AstNode } from '../types.ts'
import type { Cardinality, OfKind, Type } from './types.ts'

export function distance(a: string, b: string) {
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

export function nearest(name: string, candidates: Iterable<string>) {
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

export function isPattern(pattern: string) {
  try {
    toRegExp(pattern)
    return true
  } catch {
    return false
  }
}

export function paramName(subject: AstNode, context: AstNode) {
  const base =
    subject.type === 'Identifier'
      ? subject.value.toLowerCase().replaceAll(/\W/g, '')
      : ''
  const name = isName(base) ? base : 'x'
  const text = print(context)
  let candidate = name
  for (let i = 2; new RegExp(String.raw`\b${candidate}\b`).test(text); i++) {
    candidate = `${name}${i}`
  }
  return candidate
}

export function describe(type: Type): string {
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

export function literalOf(type: Type) {
  if (type.kind === 'string' && type.values?.length === 1) {
    return type.values[0]
  }
  return type.kind === 'number' && type.values?.length === 1
    ? type.values[0]
    : undefined
}

export function holding(type: OfKind<'list'>) {
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

export function firstAbsentIndex(cardinality: Exclude<Cardinality, 'one'>) {
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
