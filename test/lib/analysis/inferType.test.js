/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import { Jexl } from '../../../src/index.ts'

const jexl = new Jexl()
const env = {
  names: { score: 'number', name: 'string', 'INFO.SVTYPE': 'string' },
  functions: { log10: 'number' },
  dataPronoun: 'feature'
}

const infer = (exp) => {
  const { types, values } = jexl.compile(exp).inferType(env)
  return values ? { types: [...types], values } : { types: [...types] }
}

describe('inferType', () => {
  it('reads a declared function and arithmetic as a number', () => {
    expect(infer('-log10(feature.pvalue)')).toEqual({ types: ['number'] })
    expect(infer('score / 2')).toEqual({ types: ['number'] })
  })

  it('reads a comparison as a boolean with two answers', () => {
    expect(infer('feature.score > 10')).toEqual({
      types: ['boolean'],
      values: [true, false]
    })
  })

  it('lists the literals a conditional chooses between, in order', () => {
    expect(
      infer('strand == 1 ? "fwd" : strand == -1 ? "rev" : "none"')
    ).toEqual({ types: ['string'], values: ['fwd', 'rev', 'none'] })
  })

  it('reads a template as a string', () => {
    expect(infer('`${name}:${score}`')).toEqual({ types: ['string'] })
  })

  it('reads a declared dotted path whole', () => {
    expect(infer('feature.INFO.SVTYPE')).toEqual({ types: ['string'] })
  })

  it('adds numbers and concatenates strings', () => {
    expect(infer('score + 1')).toEqual({ types: ['number'] })
    expect(infer('name + score')).toEqual({ types: ['string'] })
    expect(infer('undeclared + 1')).toEqual({ types: ['number', 'string'] })
  })

  it('unions what && and || can answer', () => {
    expect(infer('name || "anonymous"')).toEqual({
      types: ['string']
    })
    expect(infer('score > 10 && "high"')).toEqual({
      types: ['boolean', 'string'],
      values: [false, 'high']
    })
  })

  it('answers the test itself where the consequent is omitted', () => {
    expect(infer('score ?: "none"')).toEqual({ types: ['number', 'string'] })
  })

  it('answers unknown for an undeclared name or function', () => {
    expect(infer('mystery')).toEqual({ types: ['unknown'] })
    expect(infer('mystery(score)')).toEqual({ types: ['unknown'] })
  })
})
