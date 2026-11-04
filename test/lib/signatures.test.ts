/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'
import { check } from '../../src/check/index.ts'

import type { FieldSchema, Type } from '../../src/check/index.ts'

const schema: FieldSchema[] = [
  { path: [], type: 'record' },
  { path: ['AF'], type: 'number', cardinality: 'perAlt' },
  { path: ['name'], type: 'string' }
]

let inst: Jexl

function diagnose(expr: string) {
  return check(inst.parse(expr), {
    schema,
    row: 'feature',
    functions: inst.signatures()
  }).diagnostics.map(({ code, message }) => `${code}: ${message}`)
}

function typeOf(expr: string): Type {
  return check(inst.parse(expr), {
    schema,
    row: 'feature',
    functions: inst.signatures()
  }).type
}

describe('signatures', () => {
  beforeEach(() => {
    inst = new Jexl()
  })

  it('has one for every function an expression can call', () => {
    inst.addFunction('upper', (s: string) => s.toUpperCase())
    expect(Object.keys(inst.signatures())).toEqual(inst.functionNames())
  })

  describe('of the built-in functions', () => {
    it.each([
      'any(feature.AF, af => af > 0.05)',
      'any(feature.AF)',
      'count(feature.AF)',
      'mean(feature.AF, af => af > 0.05)',
      'min(1, 2, [0, 5])',
      'max(feature.AF)',
      'sort(feature.AF, (a, b) => b - a)',
      'reduce(feature.AF, (a, b) => a + b, 0)'
    ])('accept %s', (expr) => {
      expect(diagnose(expr)).toEqual([])
    })
    it('count arguments', () => {
      expect(diagnose('any(feature.AF, af => af > 0.05, 1)')).toEqual([
        'arity: any takes 1 to 2 arguments, not 3'
      ])
      expect(diagnose('map()')).toEqual(['arity: map takes 2 arguments, not 0'])
    })
    it('want a lambda where they call one', () => {
      expect(diagnose('filter(feature.AF, 0.05)')).toEqual([
        'argument-type: filter expects a function such as x => …, not 0.05'
      ])
    })
    it('check a value where a param takes a value or a lambda', () => {
      expect(diagnose('max(1, feature.name)')).toEqual([
        'string-numeric: max expects number or list as argument 2, but feature.name is text'
      ])
    })
    it('say what they return', () => {
      expect(typeOf('count(feature.AF, af => af > 0.05)').kind).toBe('number')
      expect(typeOf('any(feature.AF, af => af > 0.05)').kind).toBe('boolean')
      expect(typeOf('map(feature.AF, af => af > 0.05)')).toMatchObject({
        kind: 'list',
        of: { kind: 'boolean' },
        cardinality: 'perAlt'
      })
      expect(typeOf('filter(feature.AF, af => af > 0.05)')).toMatchObject({
        kind: 'list',
        of: { kind: 'number' },
        cardinality: 'many'
      })
      expect(typeOf('find(feature.AF, af => af > 0.05)').kind).toBe('number')
    })
  })

  describe('of a registered function', () => {
    it('is the one it was registered with', () => {
      inst.addFunction('upper', (s: string) => s.toUpperCase(), {
        params: ['string'],
        returns: 'string'
      })
      expect(diagnose('upper(feature.name, 1)')).toEqual([
        'arity: upper takes 1 argument, not 2'
      ])
      expect(typeOf('upper(feature.name)').kind).toBe('string')
    })
    it('takes any arguments when it declared none', () => {
      inst.addFunction('log', () => undefined)
      expect(diagnose('log(1, feature.AF, "x")')).toEqual([])
      expect(diagnose('lg(1)')).toEqual([
        'unknown-function: no function lg; did you mean log?'
      ])
    })
    it('is dropped by a replacement that declares none', () => {
      inst.addFunction('upper', (s: string) => s.toUpperCase(), {
        params: ['string'],
        returns: 'string'
      })
      inst.addFunction('upper', (s: string) => s.toUpperCase())
      expect(diagnose('upper(1, 2)')).toEqual([])
      inst.addFunction('any', () => true)
      expect(diagnose('any(1, 2, 3)')).toEqual([])
    })
    it('is dropped by addFunctions', () => {
      inst.addFunctions({ count: () => 0 })
      expect(diagnose('count(1, 2, 3)')).toEqual([])
    })
  })
})
