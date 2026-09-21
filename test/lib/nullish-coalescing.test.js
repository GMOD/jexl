/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'

let inst

describe('?? nullish coalescing', () => {
  beforeEach(() => {
    inst = new Jexl()
    inst.addFunction('get', (obj, key) => obj[key])
  })

  it('keeps a falsy value that || would replace', () => {
    const context = { feature: { score: 0, name: '', flag: false } }
    expect(inst.eval("get(feature, 'score') ?? 5", context)).toBe(0)
    expect(inst.eval("get(feature, 'score') || 5", context)).toBe(5)
    expect(inst.eval("get(feature, 'name') ?? 'none'", context)).toBe('')
    expect(inst.eval("get(feature, 'flag') ?? true", context)).toBe(false)
  })

  it('falls back on undefined and null', () => {
    expect(inst.eval('missing ?? 5')).toBe(5)
    expect(inst.eval('x ?? 5', { x: null })).toBe(5)
    expect(inst.eval('a.b.c ?? 5', { a: {} })).toBe(5)
  })

  it('does not evaluate the right side when the left is present', () => {
    let calls = 0
    inst.addFunction('count', () => ++calls)
    expect(inst.eval('0 ?? count()')).toBe(0)
    expect(calls).toBe(0)
    expect(inst.eval('missing ?? count()')).toBe(1)
    expect(calls).toBe(1)
  })

  it('chains left to right', () => {
    expect(inst.eval('a ?? b ?? c', { c: 3 })).toBe(3)
    expect(inst.eval('a ?? b ?? c', { b: 0, c: 3 })).toBe(0)
  })

  it('lexes without surrounding whitespace', () => {
    expect(inst.eval('a??5')).toBe(5)
  })

  it('binds looser than comparison and arithmetic, as in JS', () => {
    expect(inst.eval('1 ?? 2 == 3')).toBe(1)
    expect(inst.eval('missing ?? 2 == 2')).toBe(true)
    expect(inst.eval('missing ?? 2 + 3')).toBe(5)
    expect(inst.eval('(missing ?? 2) == 2')).toBe(true)
  })

  it('binds tighter than assignment', () => {
    const context = {}
    expect(inst.eval('x = missing ?? 4; x', context)).toBe(4)
  })

  describe('beside the conditional', () => {
    it('forms the test of a ternary', () => {
      expect(inst.eval('a ?? b ? "yes" : "no"', { b: 1 })).toBe('yes')
      expect(inst.eval('a ?? b ? "yes" : "no"', { a: 0, b: 1 })).toBe('no')
    })
    it('works in either branch', () => {
      expect(inst.eval('1 ? a ?? 2 : 3')).toBe(2)
      expect(inst.eval('0 ? 1 : a ?? 3')).toBe(3)
    })
    it('leaves the elvis form and a plain ternary alone', () => {
      expect(inst.eval('0 ?: 2')).toBe(2)
      expect(inst.eval('1 ?: 2')).toBe(1)
      expect(inst.eval('1 ? 2 : 3')).toBe(2)
      expect(inst.eval('1?2:3')).toBe(2)
    })
  })

  describe('mixed with && and ||', () => {
    it('refuses to mix them without parentheses, as JS does', () => {
      for (const expr of [
        'a ?? b || c',
        'a || b ?? c',
        'a ?? b && c',
        'a && b ?? c',
        'a ?? b == c || d',
        'a ?? (b) || c'
      ]) {
        expect(() => inst.compile(expr), expr).toThrow(/Parenthesize \?\?/)
      }
    })
    it('accepts either grouping once it is written out', () => {
      expect(inst.eval('(a ?? b) || c', { b: 0, c: 3 })).toBe(3)
      expect(inst.eval('a ?? (b || c)', { b: 0, c: 3 })).toBe(3)
      expect(inst.eval('(a || b) ?? c', { c: 3 })).toBe(3)
      expect(inst.eval('a || (b ?? c)', { c: 3 })).toBe(3)
    })
    it('still allows && and || together', () => {
      expect(inst.eval('0 && 1 || 2')).toBe(2)
    })
    it('allows each in its own argument, element or branch', () => {
      expect(inst.eval('[a ?? 1, b || 2]')).toEqual([1, 2])
      expect(inst.eval('a || 1 ? b ?? 2 : 3')).toBe(2)
    })
  })

  describe('with host-registered operators', () => {
    it('is not split into two ? when a host registers ?.', () => {
      inst.addBinaryOp('?.', 100, (left, right) => left?.[right])
      expect(inst.eval('o ?. "k"', { o: { k: 1 } })).toBe(1)
      expect(inst.eval('a ?? 2')).toBe(2)
      expect(inst.eval('1 ? 2 : 3')).toBe(2)
    })
    it('survives a host replacing ? with a binary operator', () => {
      inst.addBinaryOp('?', 100, (left, right) => `${left}${right}`)
      expect(inst.eval('1 ? 2')).toBe('12')
      expect(inst.eval('a ?? 2')).toBe(2)
    })
    it('can be replaced by a host', () => {
      inst.addBinaryOp('??', 10, (left, right) => left || right)
      expect(inst.eval('0 ?? 2')).toBe(2)
    })
  })
})
