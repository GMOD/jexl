/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it } from 'vitest'

import Lexer from '../../src/Lexer.ts'
import { getGrammar } from '../../src/grammar.ts'
import { Jexl } from '../../src/Jexl.ts'

let inst

describe('regressions', () => {
  beforeEach(() => {
    inst = new Jexl()
  })
  describe('string escapes', () => {
    it('unescapes every escaped backslash, not just the first', () => {
      expect(inst.eval(String.raw`"a\\b\\c"`)).toBe(String.raw`a\b\c`)
      expect(inst.eval(String.raw`'a\\b\\c'`)).toBe(String.raw`a\b\c`)
    })
    it('still unescapes a lone escaped backslash', () => {
      expect(inst.eval(String.raw`"a\\b"`)).toBe(String.raw`a\b`)
    })
  })
  describe('ternary', () => {
    it('evaluates an omitted alternate to undefined', () => {
      expect(inst.eval('1 == 2 ? "yes" : ')).toBeUndefined()
    })
    it('still supports the elvis form', () => {
      expect(inst.eval('"truthy" ? : "no"')).toBe('truthy')
    })
  })
  describe('empty expressions', () => {
    it('evaluates an empty expression to undefined', () => {
      expect(inst.eval('')).toBeUndefined()
    })
    it('evaluates a whitespace-only expression to undefined', () => {
      expect(inst.eval('   ')).toBeUndefined()
    })
  })
  describe('function pool lookups', () => {
    it('does not resolve inherited Object.prototype members', () => {
      expect(() => inst.eval('toString()')).toThrow(/is not defined/)
      expect(() => inst.eval('constructor()')).toThrow(/is not defined/)
      expect(() => inst.eval('hasOwnProperty("a")')).toThrow(/is not defined/)
    })
    it('still resolves defined functions with those names', () => {
      inst.addFunction('toString', () => 'ok')
      expect(inst.eval('toString()')).toBe('ok')
    })
  })
  describe('removeOp', () => {
    it('is a no-op for an operator that is not in the grammar', () => {
      expect(() => inst.removeOp('@@')).not.toThrow()
      expect(inst.eval('1 + 2')).toBe(3)
    })
  })
  describe('Lexer', () => {
    it('does not mutate the array passed to getTokens', () => {
      const lexer = new Lexer(getGrammar())
      const elements = ['-', '5']
      expect(lexer.getTokens(elements)).toEqual([
        { type: 'literal', value: -5, raw: '-5' }
      ])
      expect(elements).toEqual(['-', '5'])
    })
  })
  describe('unary minus', () => {
    it('negates a value that is not a numeric literal', () => {
      expect(inst.eval('-a', { a: 5 })).toBe(-5)
      expect(inst.eval('-(1 + 2)')).toBe(-3)
      expect(inst.eval('-x.y', { x: { y: 3 } })).toBe(-3)
      expect(inst.eval('-arr[0]', { arr: [7] })).toBe(-7)
    })
    it('negates the result of a function call', () => {
      inst.addFunction('double', (x) => x * 2)
      expect(inst.eval('-double(4)')).toBe(-8)
    })
    it('applies inside collections and ternaries', () => {
      expect(inst.eval('[-a, -1]', { a: 5 })).toEqual([-5, -1])
      expect(inst.eval('a ? -b : -c', { a: 1, b: 2, c: 3 })).toBe(-2)
    })
    it('composes with binary operators at the right precedence', () => {
      expect(inst.eval('-a + b', { a: 5, b: 2 })).toBe(-3)
      expect(inst.eval('-a * b', { a: 5, b: 2 })).toBe(-10)
      expect(inst.eval('1 + -a', { a: 5 })).toBe(-4)
      expect(inst.eval('-a == -5', { a: 5 })).toBe(true)
    })
    it('stacks, and still folds the sign into numeric literals', () => {
      expect(inst.eval('- -a', { a: 5 })).toBe(5)
      expect(inst.eval('1 - -2')).toBe(3)
      expect(inst.eval('1 - 2')).toBe(-1)
      expect(inst.eval('-1?-2:-3')).toBe(-2)
    })
    it('lexes a bare prefix minus as a unary operator', () => {
      const lexer = new Lexer(getGrammar())
      expect(lexer.tokenize('-a')).toEqual([
        { type: 'unaryOp', value: '-', raw: '-' },
        { type: 'identifier', value: 'a', raw: 'a' }
      ])
    })
  })
  describe('assignment', () => {
    it('rejects assigning to a member expression', () => {
      // previously this silently created a top-level `b` and left `a.b` alone
      const context = { a: { b: 0 } }
      expect(() => inst.eval('a.b = 5', context)).toThrow(
        /Left side of assignment must be a variable name/
      )
      expect(context).toEqual({ a: { b: 0 } })
    })
    it('still assigns to a bare variable name', () => {
      const context = {}
      expect(inst.eval('a = 5; a + 1', context)).toBe(6)
      expect(context).toEqual({ a: 5 })
    })
  })
  describe('template strings', () => {
    it('ignores braces inside string literals in an interpolation', () => {
      expect(inst.eval('`${ "}" }`')).toBe('}')
      expect(inst.eval("`${ '}' }`")).toBe('}')
      expect(inst.eval('`a${ b }c${ "}" }d`', { b: 1 })).toBe('a1c}d')
    })
    it('still balances braces for object literals', () => {
      expect(inst.eval('`${ {a: 1}.a }`')).toBe('1')
    })
    it('still detects a genuinely unclosed interpolation', () => {
      expect(() => inst.eval('`${ "}" `')).toThrow(/Unclosed interpolation/)
    })
  })
})
