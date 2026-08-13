/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { bench, describe } from 'vitest'

import { Jexl } from '../src/index.ts'

// the shape jbrowse evaluates: one expression compiled from config, run once
// per feature over a large set. Compiling per feature is the thing the closure
// lowering exists to avoid, so both paths are measured side by side.
const EXPR =
  'get(feature, "score") > threshold ? `high:${get(feature, "name")}` : "low"'

const inst = new Jexl()
inst.addFunction('get', (feature, key) => feature[key])

const contexts = Array.from({ length: 1000 }, (_, i) => ({
  feature: { score: i % 100, name: `f${i}` },
  threshold: 50
}))

describe('one expression over 1000 contexts', () => {
  bench('compiled once, evaluated per context', () => {
    const expr = inst.compile(EXPR)
    for (const context of contexts) {
      expr.eval(context)
    }
  })

  bench('parsed and compiled per context', () => {
    for (const context of contexts) {
      inst.eval(EXPR, context)
    }
  })
})

describe('single evaluation of a compiled expression', () => {
  const arithmetic = inst.compile('(a + b) * c - d / 2')
  const chain = inst.compile('a.b.c.d')
  const template = inst.compile('`${a}-${b}-${c}`')
  const context = {
    a: 1,
    b: 2,
    c: 3,
    d: 4
  }
  const nested = { a: { b: { c: { d: 1 } } } }

  bench('arithmetic', () => {
    arithmetic.eval(context)
  })
  bench('identifier chain', () => {
    chain.eval(nested)
  })
  bench('template literal', () => {
    template.eval(context)
  })
})
