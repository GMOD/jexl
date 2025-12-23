/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it } from 'vitest'

import Expression from '../../src/Expression.ts'
import { Jexl } from '../../src/Jexl.ts'
let inst

describe('Jexl', () => {
  beforeEach(() => {
    inst = new Jexl()
  })
  describe('compile', () => {
    it('returns an instance of Expression', () => {
      const expr = inst.compile('2/2')
      expect(expr).toEqual(expect.any(Expression))
    })
    it('compiles the Expression', () => {
      const willFail = () => inst.compile('2 & 2')
      expect(willFail).toThrow('Invalid expression token: &')
    })
  })
  describe('createExpression', () => {
    it('returns an instance of Expression', () => {
      const expr = inst.createExpression('2/2')
      expect(expr).toEqual(expect.any(Expression))
    })
    it('does not compile the Expression', () => {
      const expr = inst.createExpression('2 wouldFail &^% ..4')
      expect(expr).toEqual(expect.any(Expression))
    })
  })
  describe('eval', () => {
    it('returns success', () => {
      expect(inst.eval('2+2')).toBe(4)
    })
    it('throws on error', () => {
      expect(inst.eval.bind(inst, '2++2')).toThrow(/unexpected/)
    })
    it('passes context', () => {
      expect(inst.eval('foo', { foo: 'bar' })).toBe('bar')
    })
    it('throws if transform fails', () => {
      inst.addTransform('abort', () => {
        throw new Error('oops')
      })
      expect(inst.eval.bind(inst, '"hello"|abort')).toThrow(/oops/)
    })
    it('throws if nested transform fails', () => {
      inst.addTransform('q1', () => {
        throw new Error('oops')
      })
      inst.addBinaryOp('is', 100, () => true)
      expect(inst.eval.bind(inst, '"hello"|q1 is asdf')).toThrow(/oops/)
    })
    it('filters collections as expected (issue #61)', () => {
      const context = {
        a: [{ b: 'A' }, { b: 'B' }, { b: 'C' }]
      }
      expect(inst.eval('a[.b in ["A","B"]]', context)).toEqual([
        { b: 'A' },
        { b: 'B' }
      ])
    })
    it('early-exits boolean AND when the left is false (issue #64)', () => {
      const context = { a: null }
      const expr = 'a != null && a.b'
      expect(inst.eval.bind(inst, expr, context)).not.toThrow()
    })
  })
  describe('expr', () => {
    it('returns an evaluatable instance of Expression', () => {
      const expr = inst.expr`2+2`
      expect(expr).toEqual(expect.any(Expression))
      expect(expr.eval()).toEqual(4)
    })
    it('functions as a template string', () => {
      const myVar = 'foo'
      const expr = inst.expr`'myVar' + ${myVar} + 'Car'`
      expect(expr.eval({ foo: 'Bar' })).toEqual('myVarBarCar')
    })
    it('works outside of the instance context', () => {
      const myVar = '##'
      inst.addUnaryOp('##', (val) => val * 2)
      const { expr } = inst
      const e = expr`${myVar}5`
      expect(e.eval()).toBe(10)
    })
  })
  describe('addFunction', () => {
    it('allows functions to be defined', () => {
      inst.addFunction('sayHi', () => 'Hello')
      expect(inst.eval('sayHi()')).toBe('Hello')
    })
    it('allows functions to be retrieved', () => {
      inst.addFunction('ret2', () => 2)
      const f = inst.getFunction('ret2')
      expect(f).toBeDefined()
      expect(f()).toBe(2)
    })
    it('allows functions to be set in batch', () => {
      inst.addFunctions({
        add1: (val) => val + 1,
        add2: (val) => val + 2
      })
      expect(inst.eval('add1(add2(2))')).toBe(5)
    })
  })
  describe('addTransform', () => {
    it('allows transforms to be defined', () => {
      inst.addTransform('toCase', (val, args) =>
        args.case === 'upper' ? val.toUpperCase() : val.toLowerCase()
      )
      expect(inst.eval('"hello"|toCase({case:"upper"})')).toBe('HELLO')
    })
    it('allows transforms to be retrieved', () => {
      inst.addTransform('ret2', () => 2)
      const t = inst.getTransform('ret2')
      expect(t).toBeDefined()
      expect(t()).toBe(2)
    })
    it('allows transforms to be set in batch', () => {
      inst.addTransforms({
        add1: (val) => val + 1,
        add2: (val) => val + 2
      })
      expect(inst.eval('2|add1|add2')).toBe(5)
    })
  })
  describe('addBinaryOp', () => {
    it('allows binaryOps to be defined', () => {
      inst.addBinaryOp(
        '_=',
        20,
        (left, right) => left.toLowerCase() === right.toLowerCase()
      )
      expect(inst.eval('"FoO" _= "fOo"')).toBe(true)
    })
    it('observes weight on binaryOps', () => {
      inst.addBinaryOp('**', 0, (left, right) => left * 2 + right * 2)
      inst.addBinaryOp('***', 1000, (left, right) => left * 2 + right * 2)
      expect(inst.eval('1 + 2 ** 3 + 4')).toBe(20)
      expect(inst.eval('1 + 2 *** 3 + 4')).toBe(15)
    })
    it('allows binaryOps to be defined with manual operand evaluation', () => {
      inst.addBinaryOp(
        '$$',
        50,
        (left, right) => {
          const val = left.eval()
          if (val > 0) {
            return val
          }
          return right.eval()
        },
        true
      )
      let count = 0
      inst.addTransform('inc', (elem) => {
        count++
        return elem
      })
      expect(inst.eval('-2|inc $$ 5|inc')).toEqual(5)
      expect(count).toEqual(2)
      count = 0
      expect(inst.eval('2|inc $$ -5|inc')).toEqual(2)
      expect(count).toEqual(1)
    })
  })
  describe('addUnaryOp', () => {
    it('allows unaryOps to be defined', () => {
      inst.addUnaryOp('~', (right) => Math.floor(right))
      expect(inst.eval('~5.7 + 5')).toBe(10)
    })
  })
  describe('removeOp', () => {
    it('allows binaryOps to be removed', () => {
      inst.removeOp('+')
      expect(() => inst.eval('1+2')).toThrow(/invalid/i)
    })
    it('allows unaryOps to be removed', () => {
      inst.removeOp('!')
      expect(() => inst.eval('!true')).toThrow(/invalid/i)
    })
  })
})
