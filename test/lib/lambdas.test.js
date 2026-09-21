/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'

let inst

const variant = (AF) => ({ feature: { INFO: { AF } } })

describe('lambdas', () => {
  beforeEach(() => {
    inst = new Jexl()
  })
  describe('with the collection functions', () => {
    it('tests any value of a multi-valued VCF field', () => {
      const expr = inst.compile('any(feature.INFO.AF, af => af > 0.05)')
      expect(expr.eval(variant([0.01, 0.2]))).toBe(true)
      expect(expr.eval(variant([0.01, 0.02]))).toBe(false)
      // the comparison it replaces is false for any multi-valued field
      expect(inst.eval('feature.INFO.AF > 0.05', variant([0.01, 0.2]))).toBe(
        false
      )
    })
    it('reads a lone value as a list of one and a missing one as empty', () => {
      const expr = inst.compile('any(feature.INFO.AF, af => af > 0.05)')
      expect(expr.eval(variant(0.2))).toBe(true)
      expect(expr.eval(variant(undefined))).toBe(false)
      expect(inst.eval('count(feature.ALT)', { feature: {} })).toBe(0)
    })
    it('maps a list', () => {
      expect(inst.eval('map(xs, (x) => x * 2)', { xs: [1, 2, 3] })).toEqual([
        2, 4, 6
      ])
      expect(inst.eval('map(xs, (x, i) => x * i)', { xs: [5, 5] })).toEqual([
        0, 5
      ])
    })
    it('is callable against a value, like any function', () => {
      expect(inst.eval('xs.map(x => x + 1)', { xs: [1, 2] })).toEqual([2, 3])
      expect(inst.eval('xs.all(x => x > 0)', { xs: [1, 2] })).toBe(true)
    })
    it('filters, finds, counts and reduces', () => {
      const context = { xs: [3, 1, 4, 1, 5] }
      expect(inst.eval('filter(xs, x => x > 2)', context)).toEqual([3, 4, 5])
      expect(inst.eval('find(xs, x => x > 3)', context)).toBe(4)
      expect(inst.eval('count(xs, x => x == 1)', context)).toBe(2)
      expect(inst.eval('count(xs)', context)).toBe(5)
      expect(inst.eval('reduce(xs, (sum, x) => sum + x)', context)).toBe(14)
      expect(inst.eval('reduce(xs, (sum, x) => sum + x, 10)', context)).toBe(24)
      expect(inst.eval('reduce([], (sum, x) => sum + x)')).toBeUndefined()
    })
    it('sorts ascending by default, numbers as numbers, without mutating', () => {
      const context = { xs: [10, 9, 1] }
      expect(inst.eval('sort(xs)', context)).toEqual([1, 9, 10])
      expect(inst.eval('sort(xs, (a, b) => b - a)', context)).toEqual([
        10, 9, 1
      ])
      expect(context.xs).toEqual([10, 9, 1])
    })
    it('rejects a callback that is not a lambda', () => {
      expect(() => inst.eval('any(xs, 5)', { xs: [1] })).toThrow(
        /any\(\) expects a lambda/
      )
    })
    it('yields to a host function of the same name', () => {
      inst.addFunction('map', () => 'host')
      expect(inst.eval('map(xs, x => x)', { xs: [1] })).toBe('host')
    })
  })
  describe('scope', () => {
    it('shadows a context variable with a parameter', () => {
      expect(inst.eval('map(xs, x => x)', { x: 'outer', xs: [1] })).toEqual([1])
    })
    it('reads any other name from the context', () => {
      const expr = inst.compile('filter(xs, x => x > min)')
      expect(expr.eval({ xs: [1, 5], min: 2 })).toEqual([5])
      expect(expr.eval({ xs: [1, 5], min: 0 })).toEqual([1, 5])
    })
    it('closes over the parameters of an enclosing lambda', () => {
      const context = { xs: [1, 2], ys: [10, 20] }
      expect(
        inst.eval('map(xs, x => map(ys, y => x * y + offset))', {
          ...context,
          offset: 1
        })
      ).toEqual([
        [11, 21],
        [21, 41]
      ])
      const adders = inst.eval('map(xs, x => y => x + y)', context)
      expect(adders.map((add) => add(100))).toEqual([101, 102])
    })
    it('reaches a parameter from a template interpolation', () => {
      expect(inst.eval('map(xs, x => `<${x}>`)', { xs: [1] })).toEqual(['<1>'])
    })
    it('refuses an assignment in its body', () => {
      expect(() => inst.compile('map(xs, x => y = x)')).toThrow(
        /Assignment is not supported in a lambda/
      )
      expect(() => inst.compile('map(xs, x => `${y = x}`)')).toThrow(
        /Assignment is not supported in a lambda/
      )
    })
    it('can itself be assigned, at the top level', () => {
      const context = { xs: [1, 2] }
      expect(
        inst.eval('double = x => x * 2; map(xs, double)', context)
      ).toEqual([2, 4])
      expect(inst.eval('double = x => x * 2; double', context)(4)).toBe(8)
      expect(context.double).toBeUndefined()
    })
  })
  describe('syntax', () => {
    it('takes no parameters, one bare, or several parenthesized', () => {
      inst.addFunction('call', (fn, ...args) => fn(...args))
      expect(inst.eval('call(() => 1)')).toBe(1)
      expect(inst.eval('call(x => x + 1, 1)')).toBe(2)
      expect(inst.eval('call((a, b,) => a - b, 5, 3)')).toBe(2)
    })
    it('extends its body as far as an assignment would', () => {
      inst.addFunction('call', (fn, ...args) => fn(...args))
      expect(inst.eval('call(x => x ? "y" : "n", 0)')).toBe('n')
      expect(inst.eval('call(x => x || 1 && 2, 0)')).toBe(2)
    })
    it('builds a Lambda node', () => {
      expect(inst.compile('x => x + 1')._ast).toEqual({
        type: 'Lambda',
        params: ['x'],
        body: {
          type: 'BinaryExpression',
          operator: '+',
          left: { type: 'Identifier', value: 'x' },
          right: { type: 'Literal', value: 1 }
        }
      })
    })
    it('is a whole operand, not part of one', () => {
      expect(() => inst.compile('1 + x => x')).toThrow(/unexpected/)
      expect(() => inst.compile('(a, a) => a')).toThrow(/Duplicate/)
      expect(() => inst.compile('(a b) => a')).toThrow(/unexpected/)
    })
    it('hands a host function a plain function', () => {
      // jbrowse registers this, and a config string had no way to call it
      inst.addFunction('interpolate', (count, scale) => scale(count))
      const expr = inst.compile(
        'interpolate(score, s => s > 5 ? "red" : "blue")'
      )
      expect(expr.eval({ score: 9 })).toBe('red')
      expect(expr.eval({ score: 1 })).toBe('blue')
    })
  })
})
