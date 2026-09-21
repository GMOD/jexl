/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'

class Feature {
  private readonly data: Record<string, unknown>
  private readonly children: Feature[]

  constructor(data: Record<string, unknown>, children: Feature[] = []) {
    this.data = data
    this.children = children
  }

  get(name: string) {
    return name === 'subfeatures' ? this.children : this.data[name]
  }
}

const getMember = (subject: NonNullable<unknown>, key: string | number) =>
  subject instanceof Feature
    ? subject.get(String(key))
    : (subject as Record<string | number, unknown>)[key]

const exon = new Feature({ type: 'exon' })
const feature = new Feature({ type: 'gene', score: 12, INFO: { DP: [30] } }, [
  exon
])

describe('getMember', () => {
  const inst = new Jexl({ getMember })
  const ev = (exp: string) => inst.eval(exp, { feature, key: 'score' })

  it('resolves a dotted member', () => {
    expect(ev('feature.score')).toBe(12)
    expect(ev('feature.missing')).toBeUndefined()
  })

  it('resolves every hop of a chain', () => {
    expect(ev('feature.INFO.DP[0]')).toBe(30)
  })

  it('resolves a bracket member, constant or computed', () => {
    expect(ev("feature['type']")).toBe('gene')
    expect(ev('feature[key]')).toBe(12)
  })

  it('sees the element a dotted member reads through an array to', () => {
    expect(ev('feature.subfeatures.type')).toBe('exon')
    expect(ev('feature.subfeatures[0].type')).toBe('exon')
  })

  it('reaches a host object anywhere, not only at the root', () => {
    expect(ev("{gene: 'blue'}[feature.type] || 'gray'")).toBe('blue')
    expect(inst.eval('list[1].type', { list: [feature, exon] })).toBe('exon')
  })

  it('is handed the string form of an array index', () => {
    const seen: (string | number)[] = []
    const spy = new Jexl({
      getMember: (subject, key) => {
        seen.push(key)
        return getMember(subject, key)
      }
    })
    expect(spy.eval("lut[['a']]", { lut: { a: 1 } })).toBe(1)
    expect(seen).toEqual(['a'])
  })

  it('is not asked about a nullish subject or a root variable', () => {
    const seen: unknown[] = []
    const spy = new Jexl({
      getMember: (subject, key) => {
        seen.push(subject)
        return getMember(subject, key)
      }
    })
    expect(spy.eval('a.b', { a: null })).toBeUndefined()
    expect(spy.eval('missing.b')).toBeUndefined()
    expect(spy.eval('x', { x: 1 })).toBe(1)
    expect(seen).toEqual([])
  })

  it('leaves an instance without one reading plain properties', () => {
    expect(new Jexl().eval('feature.score', { feature })).toBeUndefined()
  })
})

describe('variableReader as a data mask', () => {
  const contextNames = new Set(['feature', 'threshold'])
  const asked: string[] = []
  const inst = new Jexl({
    getMember,
    variableReader: (name) => {
      asked.push(name)
      return contextNames.has(name)
        ? undefined
        : (context) => (context.feature as Feature).get(name) ?? context[name]
    }
  })
  inst.addFunction('log10', Math.log10)
  const row = new Feature({ pvalue: 0.001, type: 'gene' })

  it('reads a bare name off the row, then the context', () => {
    const ctx = { feature: row, threshold: 2, fallback: 'ctx' }
    expect(inst.eval('-log10(pvalue) > threshold', ctx)).toBe(true)
    expect(inst.eval('type == feature.type', ctx)).toBe(true)
    expect(inst.eval('fallback', ctx)).toBe('ctx')
  })

  it('asks once per name at compile time, and never about a function', () => {
    asked.length = 0
    const expr = inst.compile('-log10(pvalue) + pvalue')
    expr.eval({ feature: row })
    expr.eval({ feature: row })
    expect(asked).toEqual(['pvalue', 'pvalue'])
  })

  it('reads an assignment once it has run, and the row before', () => {
    const expr = inst.compile('pvalue = -log10(pvalue); pvalue')
    expect(expr.eval({ feature: row })).toBeCloseTo(3)
    const branch = inst.compile('type == "exon" ? (type = "x") : 0; type')
    expect(branch.eval({ feature: row })).toBe('gene')
  })
})

describe('one context reused across rows', () => {
  const inst = new Jexl({ getMember })
  const colour = inst.compile(
    "s = feature.INFO.CLNSIG; ({Benign: 'blue'})[s] || 'purple'"
  )
  const rows = [
    new Feature({ INFO: { CLNSIG: ['Benign'] } }),
    new Feature({ INFO: {} })
  ]

  it('carries nothing from one row to the next', () => {
    const ctx: Record<string, unknown> = { feature: undefined }
    const out = rows.map((row) => {
      ctx.feature = row
      return colour.eval(ctx)
    })
    expect(out).toEqual(['blue', 'purple'])
    expect(Object.keys(ctx)).toEqual(['feature'])
  })
})
