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

    it('reassignment updates variable', () => {
      const ctx = { x: 1 }
      expect(jexl.evalSync('x = 5; x = x + 1; x', ctx)).toBe(6)
      expect(ctx.x).toBe(6)
    })
  })

  describe('Error Handling', () => {
    it('assignment to non-identifier throws error', () => {
      expect(() => jexl.evalSync('5 = 10')).toThrow(
        'Left side of assignment must be a variable name'
      )
    })
  })
})
