/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, it, expect } from 'vitest'
import { Jexl } from '../../src/Jexl'

const jexl = new Jexl()

describe('Multi-Expression Support', () => {
  describe('Sequence Expressions', () => {
    it('evaluates semicolon-separated expressions', () => {
      expect(jexl.evalSync('5; 10; 15')).toBe(15)
    })

    it('returns last value in sequence', () => {
      expect(jexl.evalSync('1 + 1; 2 + 2; 3 + 3')).toBe(6)
    })

    it('handles single expression without semicolon', () => {
      expect(jexl.evalSync('42')).toBe(42)
    })
  })

  describe('Assignment Expressions', () => {
    it('simple assignment returns assigned value', () => {
      expect(jexl.evalSync('x = 5')).toBe(5)
    })

    it('assignment with usage', () => {
      expect(jexl.evalSync('x = 5; x * 2')).toBe(10)
    })

    it('multiple assignments', () => {
      expect(jexl.evalSync('x = 5; y = 10; x + y')).toBe(15)
    })

    it('complex expression with assignment', () => {
      expect(jexl.evalSync('x = 5; y = x * 2; z = y + 3; z')).toBe(13)
    })

    it('assignment mutates context', () => {
      const ctx = {}
      jexl.evalSync('x = 5; y = 10', ctx)
      expect(ctx).toEqual({ x: 5, y: 10 })
    })

    it('can use external context variables', () => {
      expect(jexl.evalSync('y = x * 2; y', { x: 5 })).toBe(10)
    })

    it('assignment in expression', () => {
      expect(jexl.evalSync('(x = 3) + (y = 4)', {})).toBe(7)
    })

    it('reassignment updates variable', () => {
      const ctx = { x: 1 }
      expect(jexl.evalSync('x = 5; x = x + 1; x', ctx)).toBe(6)
      expect(ctx.x).toBe(6)
    })
  })

  describe('Combined Features', () => {
    it('assignment with arithmetic', () => {
      const ctx = {}
      expect(jexl.evalSync('a = 2; b = 3; c = a * b; c + 1', ctx)).toBe(7)
      expect(ctx).toEqual({ a: 2, b: 3, c: 6 })
    })

    it('assignment with transforms', () => {
      const result = jexl.evalSync('nums = [1,2,3]; nums|length', {})
      expect(result).toBeUndefined() // No transforms by default
    })

    it('assignment with conditionals', () => {
      expect(jexl.evalSync('x = 5; result = x > 3 ? "big" : "small"; result')).toBe('big')
    })

    it('assignment with object literals', () => {
      const ctx = {}
      jexl.evalSync('obj = {a: 1, b: 2}; x = obj.a + obj.b', ctx)
      expect(ctx.obj).toEqual({ a: 1, b: 2 })
      expect(ctx.x).toBe(3)
    })
  })

  describe('Error Handling', () => {
    it('assignment to non-identifier throws error', () => {
      expect(() => jexl.evalSync('5 = 10')).toThrow('Left side of assignment must be a variable name')
    })

    it('assignment to expression throws error', () => {
      expect(() => jexl.evalSync('x + y = 10')).toThrow('Left side of assignment must be a variable name')
    })
  })
})
