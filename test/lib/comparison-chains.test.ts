/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'
import { analyze } from '../../src/analyze.ts'
import { check } from '../../src/check/index.ts'
import { conditions } from '../../src/conditions.ts'
import { print } from '../../src/print.ts'

import type { FieldSchema } from '../../src/check/index.ts'

let inst: Jexl

describe('comparison chains', () => {
  beforeEach(() => {
    inst = new Jexl()
  })

  describe('a chain of <, <=, > and >= tests a range, as in Python', () => {
    it('holds where every link holds', () => {
      expect(inst.eval('1 < x < 3', { x: 2 })).toBe(true)
      expect(inst.eval('1 < x < 3', { x: 3 })).toBe(false)
      expect(inst.eval('1 < x <= 3', { x: 3 })).toBe(true)
      expect(inst.eval('3 > x >= 2', { x: 2 })).toBe(true)
      expect(inst.eval('0 < x < y < 10', { x: 2, y: 5 })).toBe(true)
      expect(inst.eval('0 < x < y < 10', { x: 6, y: 5 })).toBe(false)
    })
    it('was the boolean of the first comparison against the last operand', () => {
      expect(inst.eval('3 > 2 > 1')).toBe(true)
      expect(inst.eval('0.1 < x < 0.5', { x: 0.9 })).toBe(false)
    })
    it('mixes directions', () => {
      expect(inst.eval('a < b > c', { a: 1, b: 5, c: 2 })).toBe(true)
    })
    it('evaluates each operand once, and only while the links hold', () => {
      const calls: number[] = []
      inst.addFunction('at', (n: number) => (calls.push(n), n))
      expect(inst.eval('at(1) < at(2) < at(3)')).toBe(true)
      expect(calls).toEqual([1, 2, 3])
      calls.length = 0
      expect(inst.eval('at(2) < at(1) < at(3)')).toBe(false)
      expect(calls).toEqual([2, 1])
    })
    it('holds for a list where one value lies within the range', () => {
      const context = { AF: [0.01, 0.9] }
      expect(inst.eval('0.1 < AF < 0.5', context)).toBe(false)
      expect(inst.eval('0.1 < AF && AF < 0.5', context)).toBe(true)
      expect(inst.eval('0.1 < AF < 0.5', { AF: [0.01, 0.2] })).toBe(true)
      expect(inst.eval('lo < 0.2 < hi', { lo: [0.3, 0.1], hi: 0.5 })).toBe(true)
    })
    it('holds for no missing value and no empty list', () => {
      expect(inst.eval('0 < missing < 1')).toBe(false)
      expect(inst.eval('0 < AF < 1', { AF: [null, 0.5] })).toBe(true)
      expect(inst.eval('0 < AF < 1', { AF: [] })).toBe(false)
    })
    it('works inside a lambda', () => {
      expect(
        inst.eval('count(xs, x => 1 <= x < 3)', { xs: [0, 1, 2, 3] })
      ).toBe(2)
    })
    it('compares with a host replacement for an ordering operator', () => {
      inst.addBinaryOp('<', 20, (a: string, b: string) => a.length < b.length)
      expect(inst.eval("'a' < 'bb' < 'ccc'")).toBe(true)
    })
  })

  describe('parentheses keep a comparison of a comparison', () => {
    it('compares the boolean', () => {
      expect(inst.eval('(3 > 2) > 1')).toBe(false)
      expect(inst.eval('3 > (2 > 1)')).toBe(true)
      expect(inst.eval('(x == 1) == true', { x: 1 })).toBe(true)
    })
  })

  describe('any other unparenthesized comparison of a comparison', () => {
    it.each([
      'a == b == c',
      'a < b == c',
      'a == b < c',
      'a != b != c',
      'a in b < c',
      "a ~ 'x' == true",
      'a < b < c == d'
    ])('%s is a syntax error', (expr) => {
      expect(() => inst.compile(expr)).toThrow(
        /Only <, <=, > and >= chain; parenthesize a comparison inside another/
      )
    })
    it('leaves a host operator at the same precedence alone', () => {
      inst.addBinaryOp('~=', 20, (a: string, b: string) => a === b)
      expect(inst.eval("'a' ~= 'a' == true")).toBe(true)
    })
  })

  describe('print', () => {
    it.each([
      ['a < b < c', 'a < b < c'],
      ['a<b>=c', 'a < b >= c'],
      ['(a < b) < c', '(a < b) < c'],
      ['a < (b < c)', 'a < (b < c)'],
      ['(a == b) == c', '(a == b) == c'],
      ['a + 1 < b < c * 2', 'a + 1 < b < c * 2'],
      ['(a || b) < c < d', '(a || b) < c < d'],
      ['!(a < b < c)', '!(a < b < c)']
    ])('prints %s as %s, which parses back', (expr, text) => {
      const ast = inst.parse(expr)!
      expect(print(ast)).toBe(text)
      expect(inst.parse(print(ast))).toStrictEqual(ast)
    })
  })

  describe('analyze, check and conditions', () => {
    const schema: FieldSchema[] = [
      { path: [], type: 'record' },
      { path: ['score'], type: 'number' },
      { path: ['name'], type: 'string' }
    ]
    it('reads every operand', () => {
      const { fields } = analyze(
        inst.parse('feature.start < feature.score < feature.end'),
        { row: 'feature' }
      )
      expect(fields.map((field) => field.path.join('.'))).toEqual([
        'start',
        'score',
        'end'
      ])
    })
    it('is a boolean, checked link by link', () => {
      const { type, diagnostics } = check(inst.parse('0 < feature.name <= 5'), {
        schema,
        row: 'feature'
      })
      expect(type.kind).toBe('boolean')
      expect(diagnostics.map((d) => d.code)).toEqual(['string-numeric'])
    })
    it('is no condition row, since a range over a list is not two rows', () => {
      expect(
        conditions(inst.parse('0 < feature.score < 5'), { row: 'feature' })
      ).toBeUndefined()
    })
  })
})
