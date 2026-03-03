/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'

const jexl = new Jexl()

describe('Multi-Expression Support', () => {
  describe('Sequence Expressions', () => {
    it('evaluates semicolon-separated expressions', () => {
      expect(jexl.eval('5; 10; 15')).toBe(15)
    })

    it('returns last value in sequence', () => {
      expect(jexl.eval('1 + 1; 2 + 2; 3 + 3')).toBe(6)
    })

    it('handles single expression without semicolon', () => {
      expect(jexl.eval('42')).toBe(42)
    })
  })

  describe('Assignment Expressions', () => {
    it('simple assignment returns assigned value', () => {
      expect(jexl.eval('x = 5')).toBe(5)
    })

    it('assignment with usage', () => {
      expect(jexl.eval('x = 5; x * 2')).toBe(10)
    })

    it('multiple assignments', () => {
      expect(jexl.eval('x = 5; y = 10; x + y')).toBe(15)
    })

    it('complex expression with assignment', () => {
      expect(jexl.eval('x = 5; y = x * 2; z = y + 3; z')).toBe(13)
    })

    it('assignment mutates context', () => {
      const ctx = {}
      jexl.eval('x = 5; y = 10', ctx)
      expect(ctx).toEqual({ x: 5, y: 10 })
    })

    it('can use external context variables', () => {
      expect(jexl.eval('y = x * 2; y', { x: 5 })).toBe(10)
    })

    it('reassignment updates variable', () => {
      const ctx = { x: 1 }
      expect(jexl.eval('x = 5; x = x + 1; x', ctx)).toBe(6)
      expect(ctx.x).toBe(6)
    })
  })

  describe('Semicolon after property access', () => {
    it('handles semicolon after dot-accessed identifier', () => {
      const ctx = { obj: { val: 'hello' } }
      expect(jexl.eval('s = obj.val; s', ctx)).toBe('hello')
    })

    it('handles semicolon after function call result property', () => {
      const j = new Jexl()
      j.addFunction('getObj', () => ({ CLNSIG: 'Benign' }))
      const lookup = { Benign: 'blue', Pathogenic: 'red' }
      expect(j.eval('s = getObj().CLNSIG; lookup[s]', { lookup })).toBe('blue')
    })

    it('handles semicolon after bracket access on identifier', () => {
      const ctx = { arr: [10, 20, 30] }
      expect(jexl.eval('v = arr[1]; v + 5', ctx)).toBe(25)
    })
  })

  describe('Real-world expressions', () => {
    it('handles full CLNSIG-style lookup with semicolon', () => {
      const j = new Jexl()
      j.addFunction('get', (obj, key) => obj[key])
      const expr =
        "s = get(feature,'INFO').CLNSIG; ({'Benign':'blue','Likely_benign':'deepskyblue','Uncertain_significance':'gray','Pathogenic':'red','Likely_pathogenic':'orange','Conflicting_interpretations_of_pathogenicity':'brown'})[s] || 'purple'"
      expect(j.eval(expr, { feature: { INFO: { CLNSIG: 'Benign' } } })).toBe(
        'blue'
      )
      expect(
        j.eval(expr, { feature: { INFO: { CLNSIG: 'Pathogenic' } } })
      ).toBe('red')
      expect(
        j.eval(expr, { feature: { INFO: { CLNSIG: 'Likely_benign' } } })
      ).toBe('deepskyblue')
      expect(
        j.eval(expr, {
          feature: {
            INFO: {
              CLNSIG: 'Conflicting_interpretations_of_pathogenicity'
            }
          }
        })
      ).toBe('brown')
      expect(
        j.eval(expr, { feature: { INFO: { CLNSIG: 'SomethingElse' } } })
      ).toBe('purple')
    })

    it('handles CLNSIG-style lookup returning default', () => {
      const j = new Jexl()
      j.addFunction('get', (obj, key) => obj[key])
      const feature = {
        INFO: { CLNSIG: 'Unknown' }
      }
      const result = j.eval(
        "s = get(feature,'INFO').CLNSIG; ({'Benign':'blue','Pathogenic':'red'})[s] || 'purple'",
        { feature }
      )
      expect(result).toBe('purple')
    })

    it('semicolon after function call with no property access', () => {
      const j = new Jexl()
      j.addFunction('add', (a, b) => a + b)
      expect(j.eval('x = add(3, 4); x * 2')).toBe(14)
    })

    it('semicolon after bracket access on result of parens', () => {
      expect(jexl.eval("s = 'a'; ({'a': 1, 'b': 2})[s]")).toBe(1)
    })
  })

  describe('Edge cases', () => {
    it('handles negative numbers after semicolons', () => {
      expect(jexl.eval('5; -3')).toBe(-3)
    })

    it('handles trailing semicolons', () => {
      expect(jexl.eval('5;')).toBe(5)
    })

    it('handles negative numbers after commas in function args', () => {
      const j = new Jexl()
      j.addFunction('add', (a, b) => a + b)
      expect(j.eval('add(1, -2)')).toBe(-1)
    })

    it('handles semicolon after ternary expression', () => {
      expect(jexl.eval('true ? 1 : 2; 99')).toBe(99)
    })

    it('handles ternary with object literal still works', () => {
      expect(jexl.eval('true ? {a:1} : {b:2}')).toEqual({ a: 1 })
    })

    it('handles ternary inside array', () => {
      expect(jexl.eval('[true ? 1 : 2]')).toEqual([1])
    })

    it('handles ternary in parens with continuation', () => {
      expect(jexl.eval('(true ? 1 : 2) + 3')).toBe(4)
    })
  })

  describe('Error Handling', () => {
    it('assignment to non-identifier throws error', () => {
      expect(() => jexl.eval('5 = 10')).toThrow(
        'Left side of assignment must be a variable name'
      )
    })
  })
})
