/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'
let inst

describe('Expression', () => {
  beforeEach(() => {
    inst = new Jexl()
  })
  describe('compile', () => {
    it('returns the parent instance', () => {
      const expr = inst.createExpression('2/2')
      const compiled = expr.compile()
      expect(expr).toBe(compiled)
    })
    it('compiles the Expression', () => {
      const expr = inst.createExpression('2 & 2')
      const willFail = () => expr.compile('2 & 2')
      expect(willFail).toThrow('Invalid expression token: &')
    })
    it('compiles more than once if requested', () => {
      const expr = inst.createExpression('2*2')
      const spy = vi.spyOn(expr, 'compile')
      expr.compile()
      expr.compile()
      expect(spy).toHaveBeenCalledTimes(2)
    })
  })
  describe('eval', () => {
    it('returns success', () => {
      const expr = inst.createExpression('2 % 2')
      expect(expr.eval()).toBe(0)
    })
    it('throws on error', () => {
      const expr = inst.createExpression('2++2')
      expect(expr.eval.bind(expr)).toThrow(/unexpected/)
    })
    it('passes context', () => {
      const expr = inst.createExpression('foo')
      expect(expr.eval({ foo: 'bar' })).toBe('bar')
    })
    it('never compiles more than once', () => {
      const expr = inst.createExpression('2*2')
      const spy = vi.spyOn(expr, 'compile')
      expr.eval()
      expr.eval()
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })
})
