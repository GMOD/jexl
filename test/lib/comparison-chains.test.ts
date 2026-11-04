/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'
import { check } from '../../src/check/index.ts'
import { print } from '../../src/print.ts'

import type { FieldSchema } from '../../src/check/index.ts'

let inst: Jexl

describe('comparison chains', () => {
  beforeEach(() => {
    inst = new Jexl()
  })

  describe('a comparison of an unparenthesized comparison', () => {
    it.each([
      // compared the boolean 0.1 < AF with 0.5, so it was false for any AF
      '0.1 < AF < 0.5',
      '3 > 2 > 1',
      'a == b == c',
      'a < b == c',
      'a == b < c',
      'a != b != c',
      'a in b < c',
      'a !in b == c',
      "a ~ 'x' == true"
    ])('%s is a syntax error', (expr) => {
      expect(() => inst.compile(expr)).toThrow(
        /Comparisons do not chain: parenthesize the inner one, or test a range with between\(x, lo, hi\)/
      )
    })
    it('compares the boolean once parenthesized', () => {
      expect(inst.eval('(3 > 2) > 1')).toBe(false)
      expect(inst.eval('3 > (2 > 1)')).toBe(true)
      expect(inst.eval('(x == 1) == true', { x: 1 })).toBe(true)
    })
    it('leaves a comparison joined by && or || alone', () => {
      expect(inst.eval('1 < x && x < 3', { x: 2 })).toBe(true)
      expect(inst.eval('x < 1 || x > 3', { x: 2 })).toBe(false)
    })
    it('leaves a host operator at the same precedence alone', () => {
      inst.addBinaryOp('~=', 20, (a: string, b: string) => a === b)
      expect(inst.eval("'a' ~= 'a' == true")).toBe(true)
    })
    it.each([
      ['(a < b) < c', '(a < b) < c'],
      ['a < (b < c)', 'a < (b < c)'],
      ['(a == b) == c', '(a == b) == c'],
      ['(a in b) == c', '(a in b) == c']
    ])('prints %s as %s, which parses back', (expr, text) => {
      const ast = inst.parse(expr)!
      expect(print(ast)).toBe(text)
      expect(inst.parse(print(ast))).toStrictEqual(ast)
    })
  })

  describe('between', () => {
    it('includes both ends, as SQL BETWEEN does', () => {
      expect(inst.eval('between(x, 1, 3)', { x: 1 })).toBe(true)
      expect(inst.eval('between(x, 1, 3)', { x: 3 })).toBe(true)
      expect(inst.eval('between(x, 1, 3)', { x: 3.5 })).toBe(false)
      expect(inst.eval('x.between(1, 3)', { x: 2 })).toBe(true)
    })
    it('holds for a list where one value lies within the range', () => {
      expect(inst.eval('between(AF, 0.1, 0.5)', { AF: [0.01, 0.2] })).toBe(true)
      // each test passes on a different value, so && holds where between doesn't
      const context = { AF: [0.01, 0.9] }
      expect(inst.eval('between(AF, 0.1, 0.5)', context)).toBe(false)
      expect(inst.eval('AF >= 0.1 && AF <= 0.5', context)).toBe(true)
    })
    it('holds for no missing value and no missing bound', () => {
      expect(inst.eval('between(missing, 0, 1)')).toBe(false)
      expect(inst.eval('between(AF, 0, 1)', { AF: [null, 0.5] })).toBe(true)
      expect(inst.eval('between(AF, 0, 1)', { AF: [] })).toBe(false)
      expect(inst.eval('between(0.5, missing, 1)')).toBe(false)
      expect(inst.eval('between(0.5, 0, missing)')).toBe(false)
    })
    it('is checked as a function of a number and two bounds', () => {
      const schema: FieldSchema[] = [
        { path: [], type: 'record' },
        { path: ['name'], type: 'string' }
      ]
      const diagnose = (expr: string) =>
        check(inst.parse(expr), {
          schema,
          row: 'feature',
          functions: inst.signatures()
        }).diagnostics.map(({ code }) => code)
      expect(diagnose('between(feature.name, 0, 5)')).toEqual([
        'string-numeric'
      ])
      expect(diagnose('between(1, 0)')).toEqual(['arity'])
    })
  })
})
