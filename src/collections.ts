/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { GrammarFn } from './grammar.ts'
import type { JexlFunction, JexlValue } from './types.ts'

/**
 * A list as these functions read it. A lone value is a list of one and a
 * missing one is empty, so that a field which is sometimes a scalar and
 * sometimes an array, as VCF INFO fields are, needs no special case.
 */
function toList(value: JexlValue): JexlValue[] {
  if (value == null) {
    return []
  }
  return Array.isArray(value) ? value : [value]
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
