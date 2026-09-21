/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import { Jexl } from '../../../src/index.ts'

const jexl = new Jexl()
jexl.addFunctions({
  log10: Math.log10,
  upper: (s) => (typeof s === 'string' ? s.toUpperCase() : s),
  clamp3: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  boom: () => {
    throw new Error('evaluated a branch no row takes')
  }
})

function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648
    return s / 2_147_483_648
  }
}

const rand = seeded(7)
const pick = (xs) => xs[Math.floor(rand() * xs.length)]
const n = 400

const columns = {
  pvalue: Float64Array.from({ length: n }, () => rand()),
  score: Float64Array.from({ length: n }, () => Math.floor(rand() * 20)),
  name: Array.from({ length: n }, (_, i) =>
    pick([`f${i}`, undefined, null, ''])
  ),
  strand: Array.from({ length: n }, () => pick([1, -1, 0, undefined])),
  INFO: Array.from({ length: n }, () =>
    pick([
      { SVTYPE: ['DEL'], AF: [0.1] },
      { SVTYPE: 'INS' },
      {},
      undefined,
      [{ SVTYPE: 'DUP' }]
    ])
  ),
  'INFO.END': Array.from({ length: n }, () => pick([100, undefined]))
}
const env = { threshold: 10, palette: { DEL: 'red', INS: 'blue' } }

const rowAt = (i) =>
  Object.fromEntries(Object.entries(columns).map(([k, col]) => [k, col[i]]))

const EXPRESSIONS = [
  '-log10(pvalue)',
  'score > 10 ? "red" : "blue"',
  '`${name}:${score}`',
  'score > threshold',
  'score + threshold * 2',
  'name || "anonymous"',
  'name && upper(name)',
  'strand == 1 ? "fwd" : strand == -1 ? "rev" : "none"',
  'score ?: "zero"',
  'INFO.SVTYPE',
  'INFO.SVTYPE[0]',
  'palette[INFO.SVTYPE] || "grey"',
  'clamp3(score, 2, threshold)',
  'score > 100 ? boom() : score',
  'score > 100 && boom()',
  'score >= 0 || boom()',
  '[score, strand][1]',
  '{ a: score }.a',
  'missing',
  'missing.deeper',
  '"k" + 1',
  '!strand'
]

describe('compileColumnar', () => {
  for (const exp of EXPRESSIONS) {
    it(`answers every row as eval does: ${exp}`, () => {
      const expr = jexl.compile(exp)
      const expected = Array.from({ length: n }, (_, i) =>
        expr.eval({ ...env, ...rowAt(i) })
      )
      const actual = expr.compileColumnar({ env })(columns, n)
      expect(Array.from(actual)).toEqual(expected)
    })
  }

  it('reads columns through a data pronoun and env through its own', () => {
    const expr = jexl.compile(
      'feature.score > env.threshold ? feature.INFO.SVTYPE : feature.name'
    )
    const expected = Array.from({ length: n }, (_, i) =>
      expr.eval({ feature: rowAt(i), env })
    )
    const actual = expr.compileColumnar({
      env,
      dataPronoun: 'feature',
      envPronoun: 'env'
    })(columns, n)
    expect(Array.from(actual)).toEqual(expected)
  })

  it('prefers a column to the environment under the mask', () => {
    const fn = jexl.compile('threshold').compileColumnar({ env })
    expect(fn({ threshold: [1, 2] }, 2)).toEqual([1, 2])
    expect(fn({}, 2)).toEqual([10, 10])
  })

  it('reads a column named by a whole dotted path before walking into one', () => {
    const fn = jexl.compile('INFO.END').compileColumnar()
    expect(fn(columns, n)).toEqual(columns['INFO.END'])
    expect(fn({ INFO: [{ END: 5 }, undefined] }, 2)).toEqual([5, undefined])
  })

  it('writes into a typed lane', () => {
    const out = new Float32Array(n)
    jexl.compile('-log10(pvalue)').compileColumnar()(columns, n, out)
    expect(out[3]).toBeCloseTo(-Math.log10(columns.pvalue[3]), 5)
  })

  it('refuses the data pronoun as a whole row', () => {
    expect(() =>
      jexl.compile('upper(feature)').compileColumnar({ dataPronoun: 'feature' })
    ).toThrow(/whole row/)
  })

  it('answers no rows without calling anything', () => {
    expect(jexl.compile('boom()').compileColumnar()({}, 0)).toEqual([])
  })
})
