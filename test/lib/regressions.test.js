/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it } from 'vitest'

import Lexer from '../../src/Lexer.ts'
import { compileAst } from '../../src/evaluator/compile.ts'
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
  describe('the in operator', () => {
    it('is false for an absent left operand against a string', () => {
      // every string contains '', so coercing a non-primitive left operand to
      // '' made these all true — including a missing feature attribute
      expect(inst.eval('missing in "abc"')).toBe(false)
      expect(inst.eval('nothing in "abc"', { nothing: null })).toBe(false)
    })
    it('is false for a structured left operand against a string', () => {
      expect(inst.eval('{} in "abc"')).toBe(false)
      expect(inst.eval('[1] in "abc"')).toBe(false)
    })
    it('still matches primitives as substrings', () => {
      expect(inst.eval('"a" in "abc"')).toBe(true)
      expect(inst.eval('"" in "abc"')).toBe(true)
      expect(inst.eval('2 in "123"')).toBe(true)
      expect(inst.eval('true in "is true"')).toBe(true)
      expect(inst.eval('"z" in "abc"')).toBe(false)
    })
    it('still tests membership of an array', () => {
      expect(inst.eval('1 in [1, 2]')).toBe(true)
      expect(inst.eval('missing in [1, 2]')).toBe(false)
    })
  })
  describe('unterminated groups', () => {
    it('rejects a group left open before anything is placed in the tree', () => {
      // "(1" left the cursor null, so testing the cursor alone let the missing
      // ")" through and the expression evaluated as if it were closed
      expect(() => inst.eval('(1')).toThrow(/Unexpected end of expression/)
      expect(() => inst.eval('((1)')).toThrow(/Unexpected end of expression/)
      expect(() => inst.eval('(1 + 2')).toThrow(/Unexpected end of expression/)
    })
    it('still rejects the forms that were already caught', () => {
      expect(() => inst.eval('[1, 2')).toThrow(/Unexpected end of expression/)
      expect(() => inst.eval('{a: 1')).toThrow(/Unexpected end of expression/)
      expect(() => inst.eval('1 ? 2')).toThrow(/Unexpected end of expression/)
    })
    it('still accepts closed groups and completable subexpressions', () => {
      expect(inst.eval('(1)')).toBe(1)
      expect(inst.eval('((1 + 2) * 3)')).toBe(9)
      expect(inst.eval('()')).toBeUndefined()
      expect(inst.eval('1 ? 2 : 3')).toBe(2)
      expect(inst.eval('1 == 2 ? "yes" : ')).toBeUndefined()
    })
  })
  describe('__proto__ as a key', () => {
    it('makes it an own property of an object literal', () => {
      // a plain store invokes the prototype setter, so the literal used to
      // evaluate to {} and the value vanished
      const res = inst.eval('{"__proto__": 1, b: 2}')
      expect(Object.hasOwn(res, '__proto__')).toBe(true)
      expect(Object.getPrototypeOf(res)).toBe(Object.prototype)
      expect(res.b).toBe(2)
    })
    it('does not re-point the prototype of the produced object', () => {
      const res = inst.eval('{"__proto__": {"polluted": 1}}')
      expect(Object.getPrototypeOf(res)).toBe(Object.prototype)
      expect({}.polluted).toBeUndefined()
    })
    it('makes an assignment to it an own property of the context', () => {
      const context = {}
      expect(
        inst.eval('__proto__ = {"polluted": 1}; __proto__.polluted', context)
      ).toBe(1)
      expect(Object.getPrototypeOf(context)).toBe(Object.prototype)
      expect({}.polluted).toBeUndefined()
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
  describe('compiled closures', () => {
    // the AST is lowered to closures once at compile time; these pin the
    // semantics that lowering has to preserve across repeated evaluation
    it('reuses one compiled expression across many contexts', () => {
      const expr = inst.compile('a + b')
      expect(expr.eval({ a: 1, b: 2 })).toBe(3)
      expect(expr.eval({ a: 10, b: 20 })).toBe(30)
      expect(expr.eval({ a: 'x', b: 'y' })).toBe('xy')
    })
    it('short-circuits && and || on every evaluation, not just the first', () => {
      let calls = 0
      inst.addFunction('boom', () => {
        calls++
        return true
      })
      const expr = inst.compile('a && boom()')
      expect(expr.eval({ a: false })).toBe(false)
      expect(calls).toBe(0)
      expect(expr.eval({ a: true })).toBe(true)
      expect(calls).toBe(1)
      expect(expr.eval({ a: false })).toBe(false)
      expect(calls).toBe(1)
    })
    it('resolves functions registered after compilation', () => {
      const expr = inst.compile('later(2)')
      inst.addFunction('later', (x) => x * 3)
      expect(expr.eval()).toBe(6)
    })
    it('rebuilds fresh objects and arrays per evaluation', () => {
      const expr = inst.compile('{a: x}')
      const first = expr.eval({ x: 1 })
      const second = expr.eval({ x: 2 })
      expect(first).toEqual({ a: 1 })
      expect(second).toEqual({ a: 2 })
      expect(first).not.toBe(second)

      const arr = inst.compile('[x, x + 1]')
      expect(arr.eval({ x: 1 })).toEqual([1, 2])
      expect(arr.eval({ x: 5 })).toEqual([5, 6])
    })
    it('keeps assignment writing into the context of each evaluation', () => {
      const expr = inst.compile('n = n + 1; n')
      const first = { n: 0 }
      const second = { n: 10 }
      expect(expr.eval(first)).toBe(1)
      expect(expr.eval(second)).toBe(11)
      expect(first).toEqual({ n: 1 })
      expect(second).toEqual({ n: 11 })
    })
    it('re-throws on every evaluation of an unsupported relative filter', () => {
      const expr = inst.compile('a[.b > 1]')
      expect(() => expr.eval({ a: [] })).toThrow(/not supported/)
      expect(() => expr.eval({ a: [] })).toThrow(/not supported/)
    })
    it('still reports an undefined function on each evaluation', () => {
      const expr = inst.compile('nope(1)')
      expect(() => expr.eval()).toThrow(/is not defined/)
      expect(() => expr.eval()).toThrow(/is not defined/)
    })
    it('recompiles interpolations of a template literal per evaluation', () => {
      const expr = inst.compile('`v=${a + 1}`')
      expect(expr.eval({ a: 1 })).toBe('v=2')
      expect(expr.eval({ a: 9 })).toBe('v=10')
    })
    it('rejects a corrupt AST node type', () => {
      expect(() => compileAst({ type: 'NotARealNode' }, getGrammar())).toThrow(
        /unknown node type/
      )
    })
  })
  describe('shared lexer cache', () => {
    // The Lexer memoizes the regex that splits an expression into elements, and
    // is now shared across every Expression a Jexl instance creates, so grammar
    // changes have to invalidate it. These all use multi-character operators,
    // whose characters are individually meaningful; a single-character operator
    // survives a stale regex because unmatched text becomes its own element.
    it('picks up a binaryOp added after an expression was evaluated', () => {
      expect(inst.eval('1 + 2')).toBe(3)
      inst.addBinaryOp('**', 40, (left, right) => left ** right)
      // a stale regex splits this into two '*' tokens and fails to parse
      expect(inst.eval('2 ** 3')).toBe(8)
    })
    it('picks up a unaryOp added after an expression was evaluated', () => {
      expect(inst.eval('1 + 2')).toBe(3)
      inst.addUnaryOp('!!', (right) => right * 2)
      // a stale regex reads this as '!' applied twice, giving `true`
      expect(inst.eval('!!5')).toBe(10)
    })
    it('picks up an op removed after an expression was evaluated', () => {
      expect(inst.eval('1 + 2')).toBe(3)
      inst.removeOp('==')
      // with the regex rebuilt, '==' splits into two assignment operators; a
      // stale regex would instead reject '==' as an unknown token
      expect(() => inst.eval('1 == 2')).toThrow(
        /Left side of assignment must be a variable name/
      )
    })
    it('keeps instances isolated from each other', () => {
      const other = new Jexl()
      inst.addBinaryOp('**', 40, (left, right) => left ** right)
      expect(inst.eval('2 ** 3')).toBe(8)
      expect(() => other.eval('2 ** 3')).toThrow()
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
