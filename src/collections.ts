/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { GrammarFn } from './grammar.ts'
import type { JexlFunction, JexlValue } from './types.ts'

/**
 * A list as these functions read it. A lone value is a list of one and a
 * missing one is empty, so that a field which is sometimes a scalar and
 * sometimes an array, as VCF INFO fields are, needs no special case. A Set,
 * a Map or a plain object, such as samples keyed by name, gives its values.
 */
function toList(value: JexlValue): JexlValue[] {
  if (value == null) {
    return []
  }
  if (Array.isArray(value)) {
    return value
  }
  const held = value as unknown
  if (held instanceof Set || held instanceof Map) {
    return [...(held.values() as Iterable<JexlValue>)]
  }
  return isPlainObject(value) ? Object.values(value) : [value]
}

function isPlainObject(value: JexlValue): value is Record<string, JexlValue> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

const identity = (value: JexlValue) => value

function callback(name: string, fn: JexlValue): JexlFunction {
  if (fn === undefined) {
    return identity
  }
  if (typeof fn !== 'function') {
    throw new TypeError(`${name}() expects a lambda, such as x => x > 1`)
  }
  return fn
}

/**
 * The numbers a list holds, each read through `fn` when there is one. A
 * boolean counts as 1 or 0, so `mean(samples, s => s.GQ > 90)` is the
 * fraction that pass; anything else that is not a number is skipped, as
 * bcftools skips a missing value.
 */
function numbers(name: string, list: JexlValue, fn: JexlValue) {
  const read = callback(name, fn)
  const out: number[] = []
  for (const item of toList(list)) {
    const value = read(item)
    if (typeof value === 'number' && !Number.isNaN(value)) {
      out.push(value)
    } else if (typeof value === 'boolean') {
      out.push(Number(value))
    }
  }
  return out
}

/**
 * The numbers `min` and `max` compare: a list and an optional lambda, as the
 * other aggregates take, or any number of values and lists, as `Math.max`
 * takes.
 */
function extremes(name: string, args: JexlValue[]) {
  const last = args.at(-1)
  if (typeof last !== 'function') {
    return numbers(name, args.flatMap(toList), undefined)
  }
  if (args.length > 2) {
    throw new TypeError(`${name}() takes a list and a lambda, or values`)
  }
  return numbers(name, args[0], last)
}

function sum(values: number[]) {
  let total = 0
  for (const value of values) {
    total += value
  }
  return total
}

function ascending(a: JexlValue, b: JexlValue) {
  return (a as number) < (b as number)
    ? -1
    : (a as number) > (b as number)
      ? 1
      : 0
}

/** The functions every Jexl instance starts with. A host may replace any. */
export const collectionFunctions: Record<string, GrammarFn> = {
  any: (list, fn) => toList(list).some(callback('any', fn)),
  all: (list, fn) => toList(list).every(callback('all', fn)),
  count: (list, fn) =>
    fn === undefined
      ? toList(list).length
      : toList(list).filter(callback('count', fn)).length,
  map: (list, fn) => toList(list).map(callback('map', fn)),
  filter: (list, fn) => toList(list).filter(callback('filter', fn)),
  find: (list, fn) => toList(list).find(callback('find', fn)),
  sort: (list, fn) => {
    const compare = fn === undefined ? ascending : callback('sort', fn)
    return [...toList(list)].sort((a, b) => compare(a, b) as number)
  },
  sum: (list, fn) => sum(numbers('sum', list, fn)),
  mean: (list, fn) => {
    const values = numbers('mean', list, fn)
    return values.length > 0 ? sum(values) / values.length : undefined
  },
  median: (list, fn) => {
    const values = numbers('median', list, fn).sort((a, b) => a - b)
    const mid = values.length >> 1
    return values.length === 0
      ? undefined
      : values.length % 2
        ? values[mid]
        : (values[mid - 1]! + values[mid]!) / 2
  },
  min: (...args) => {
    const values = extremes('min', args)
    return values.length > 0 ? Math.min(...values) : undefined
  },
  max: (...args) => {
    const values = extremes('max', args)
    return values.length > 0 ? Math.max(...values) : undefined
  },
  reduce: (list, fn, ...initial) => {
    const items = toList(list)
    const step = callback('reduce', fn)
    const seeded = initial.length > 0
    let acc = seeded ? initial[0] : items[0]
    for (let i = seeded ? 0 : 1; i < items.length; i++) {
      acc = step(acc, items[i])
    }
    return acc
  }
}
