/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import Lexer from '../../../src/Lexer.ts'
import { compileAst } from '../../../src/evaluator/compile.ts'
import { getGrammar } from '../../../src/grammar.ts'
import Parser from '../../../src/parser/Parser.ts'

const grammar = getGrammar()
const lexer = new Lexer(grammar)

const toTree = (exp) => {
  const p = new Parser(grammar, lexer)
  p.addTokens(lexer.tokenize(exp))
  return p.complete()
}

const evaluate = (exp, context = {}) =>
  compileAst(toTree(exp), grammar)(context)

describe('compileAst', () => {
  it('evaluates an arithmetic expression', () => {
    expect(evaluate('(2 + 3) * 4')).toBe(20)
  })
  it('evaluates a string concat', () => {
    expect(evaluate(String.raw`"Hello" + (4+4) + "Wo\"rld"`)).toBe(
      'Hello8Wo"rld'
    )
  })
  it('evaluates a true comparison expression', () => {
    expect(evaluate('2 > 1')).toBe(true)
  })
  it('evaluates a false comparison expression', () => {
    expect(evaluate('2 <= 1')).toBe(false)
  })
  it('evaluates a complex expression', () => {
    expect(evaluate('"foo" && 6 >= 6 && 0 + 1 && true')).toBe(true)
  })
  it('evaluates an identifier chain', () => {
    const context = { foo: { baz: { bar: 'tek' } } }
    expect(evaluate('foo.baz.bar', context)).toBe(context.foo.baz.bar)
  })
  it('assumes array index 0 when traversing', () => {
    const context = {
      foo: {
        bar: [{ tek: { hello: 'world' } }, { tek: { hello: 'universe' } }]
      }
    }
    expect(evaluate('foo.bar.tek.hello', context)).toBe('world')
  })
  it('makes array elements addressable by index', () => {
    const context = {
      foo: {
        bar: [{ tek: 'tok' }, { tek: 'baz' }, { tek: 'foz' }]
      }
    }
    expect(evaluate('foo.bar[1].tek', context)).toBe('baz')
  })
  it('allows filters to select object properties', () => {
    const context = { foo: { baz: { bar: 'tek' } } }
    expect(evaluate('foo["ba" + "z"].bar', context)).toBe(context.foo.baz.bar)
  })
  it('applys the DivFloor operator', () => {
    expect(evaluate('7 // 2')).toBe(3)
  })
  it('evaluates an object literal', () => {
    expect(evaluate('{foo: {bar: "tek"}}')).toEqual({
      foo: { bar: 'tek' }
    })
  })
  it('evaluates an empty object literal', () => {
    expect(evaluate('{}')).toEqual({})
  })
  it('evaluates dot notation for object literals', () => {
    expect(evaluate('{foo: "bar"}.foo')).toBe('bar')
  })
  it('allows access to literal properties', () => {
    expect(evaluate('"foo".length')).toBe(3)
  })
  it('evaluates array literals', () => {
    expect(evaluate('["foo", 1+2]')).toEqual(['foo', 3])
  })
  it('applys the "in" operator to strings', () => {
    expect(evaluate('"bar" in "foobartek"')).toBe(true)
    expect(evaluate('"baz" in "foobartek"')).toBe(false)
  })
  it('applys the "in" operator to arrays', () => {
    expect(evaluate('"bar" in ["foo","bar","tek"]')).toBe(true)
    expect(evaluate('"baz" in ["foo","bar","tek"]')).toBe(false)
  })
  it('evaluates a conditional expression', () => {
    expect(evaluate('"foo" ? 1 : 2')).toBe(1)
    expect(evaluate('"" ? 1 : 2')).toBe(2)
  })
  it('allows missing consequent in ternary', () => {
    expect(evaluate('"foo" ?: "bar"')).toBe('foo')
  })
  it('does not treat falsey properties as undefined', () => {
    expect(evaluate('"".length')).toBe(0)
  })
  it('evaluates an expression with arbitrary whitespace', () => {
    expect(evaluate('(\t2\n+\n3) *\n4\n\r\n')).toBe(20)
  })
  it('evaluates an expression with $ in identifiers', () => {
    const context = {
      $: 5,
      $foo: 6,
      $foo$bar: 7,
      $bar: 8
    }
    expect(evaluate('$+$foo+$foo$bar+$bar', context)).toBe(26)
  })
  describe('Template Strings', () => {
    it('evaluates a simple template string', () => {
      expect(evaluate('`Hello ${name}`', { name: 'World' })).toBe('Hello World')
    })
    it('evaluates template string with expression', () => {
      expect(
        evaluate('`Total: ${price * quantity}`', {
          price: 10,
          quantity: 3
        })
      ).toBe('Total: 30')
    })
    it('evaluates template string with multiple interpolations', () => {
      expect(evaluate('`${a} + ${b} = ${c}`', { a: 5, b: 3, c: 8 })).toBe(
        '5 + 3 = 8'
      )
    })
    it('evaluates template string with null value', () => {
      expect(evaluate('`Value: ${missing}`')).toBe('Value: ')
    })
    it('evaluates template string with undefined value', () => {
      expect(evaluate('`Value: ${obj.missing}`', { obj: {} })).toBe('Value: ')
    })
    it('evaluates template string with ternary expression', () => {
      expect(
        evaluate('`Status: ${age >= 18 ? "adult" : "minor"}`', {
          age: 20
        })
      ).toBe('Status: adult')
    })
    it('evaluates template string with array access', () => {
      expect(evaluate('`First: ${items[0]}`', { items: ['a', 'b', 'c'] })).toBe(
        'First: a'
      )
    })
    it('evaluates template string with object access', () => {
      expect(
        evaluate('`Name: ${user.firstName + " " + user.lastName}`', {
          user: { firstName: 'John', lastName: 'Doe' }
        })
      ).toBe('Name: John Doe')
    })
    it('evaluates template string with escaped backticks', () => {
      expect(evaluate('`Code: \\`example\\``')).toBe('Code: `example`')
    })
    it('evaluates template string with escaped dollar signs', () => {
      expect(evaluate('`Price: \\$100`')).toBe('Price: $100')
    })
    it('evaluates static template string with no interpolations', () => {
      expect(evaluate('`just a string`')).toBe('just a string')
    })
  })
  describe('function calls', () => {
    // the compiler spells out arities 0-3 to avoid allocating an argument
    // array; anything above that falls through to the spread path, which was
    // otherwise never exercised
    const withFns = getGrammar()
    Object.assign(withFns.functions, {
      count: (...args) => args.length,
      concat: (...args) => args.join('')
    })
    const callLexer = new Lexer(withFns)
    const call = (exp, context = {}) => {
      const p = new Parser(withFns, callLexer)
      p.addTokens(callLexer.tokenize(exp))
      return compileAst(p.complete(), withFns)(context)
    }
    it('passes each spelled-out arity', () => {
      expect(call('count()')).toBe(0)
      expect(call('count(1)')).toBe(1)
      expect(call('count(1, 2)')).toBe(2)
      expect(call('count(1, 2, 3)')).toBe(3)
    })
    it('passes arities beyond the spelled-out ones', () => {
      expect(call('count(1, 2, 3, 4)')).toBe(4)
      expect(call('count(1, 2, 3, 4, 5, 6, 7, 8)')).toBe(8)
    })
    it('evaluates each argument of a spread call in order', () => {
      expect(
        call('concat(a, b, c, d, e)', {
          a: 1,
          b: 2,
          c: 3,
          d: 4,
          e: 5
        })
      ).toBe('12345')
    })
  })
})
