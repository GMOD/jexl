/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import Lexer from '../../../src/Lexer.ts'
import Evaluator from '../../../src/evaluator/Evaluator.ts'
import { getGrammar } from '../../../src/grammar.ts'
import Parser from '../../../src/parser/Parser.ts'
const grammar = getGrammar()

const lexer = new Lexer(grammar)

const toTree = (exp) => {
  const p = new Parser(grammar, lexer)
  p.addTokens(lexer.tokenize(exp))
  return p.complete()
}

describe('Evaluator', () => {
  it('evaluates an arithmetic expression', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('(2 + 3) * 4'))).toBe(20)
  })
  it('evaluates a string concat', () => {
    const e = new Evaluator(grammar)
    expect(
      e.eval(toTree(String.raw`"Hello" + (4+4) + "Wo\"rld"`))
    ).toBe('Hello8Wo"rld')
  })
  it('evaluates a true comparison expression', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('2 > 1'))).toBe(true)
  })
  it('evaluates a false comparison expression', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('2 <= 1'))).toBe(false)
  })
  it('evaluates a complex expression', () => {
    const e = new Evaluator(grammar)
    expect(
      e.eval(toTree('"foo" && 6 >= 6 && 0 + 1 && true'))
    ).toBe(true)
  })
  it('evaluates an identifier chain', () => {
    const context = { foo: { baz: { bar: 'tek' } } }
    const e = new Evaluator(grammar, context)
    expect(e.eval(toTree('foo.baz.bar'))).toBe(
      context.foo.baz.bar
    )
  })
  it('applies transforms', () => {
    const context = { foo: 10 }
    const half = (val) => val / 2
    const g = { ...grammar, transforms: { half } }
    const e = new Evaluator(g, context)
    expect(e.eval(toTree('foo|half + 3'))).toBe(8)
  })
  it('filters arrays', () => {
    const context = {
      foo: {
        bar: [{ tek: 'hello' }, { tek: 'baz' }, { tok: 'baz' }]
      }
    }
    const e = new Evaluator(grammar, context)
    expect(e.eval(toTree('foo.bar[.tek == "baz"]'))).toEqual([
      { tek: 'baz' }
    ])
  })
  it('assumes array index 0 when traversing', () => {
    const context = {
      foo: {
        bar: [{ tek: { hello: 'world' } }, { tek: { hello: 'universe' } }]
      }
    }
    const e = new Evaluator(grammar, context)
    expect(e.eval(toTree('foo.bar.tek.hello'))).toBe('world')
  })
  it('makes array elements addressable by index', () => {
    const context = {
      foo: {
        bar: [{ tek: 'tok' }, { tek: 'baz' }, { tek: 'foz' }]
      }
    }
    const e = new Evaluator(grammar, context)
    expect(e.eval(toTree('foo.bar[1].tek'))).toBe('baz')
  })
  it('allows filters to select object properties', () => {
    const context = { foo: { baz: { bar: 'tek' } } }
    const e = new Evaluator(grammar, context)
    expect(e.eval(toTree('foo["ba" + "z"].bar'))).toBe(
      context.foo.baz.bar
    )
  })
  it('throws when transform does not exist', () => {
    const e = new Evaluator(grammar)
    expect(() => e.eval(toTree('"hello"|world'))).toThrow(Error)
  })
  it('applys the DivFloor operator', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('7 // 2'))).toBe(3)
  })
  it('evaluates an object literal', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('{foo: {bar: "tek"}}'))).toEqual({
      foo: { bar: 'tek' }
    })
  })
  it('evaluates an empty object literal', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('{}'))).toEqual({})
  })
  it('evaluates a transform with multiple args', () => {
    const g = {
      ...grammar,
      transforms: {
        concat: (val, a1, a2, a3) => val + ': ' + a1 + a2 + a3
      }
    }
    const e = new Evaluator(g)
    expect(
      e.eval(toTree('"foo"|concat("baz", "bar", "tek")'))
    ).toBe('foo: bazbartek')
  })
  it('evaluates dot notation for object literals', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('{foo: "bar"}.foo'))).toBe('bar')
  })
  it('allows access to literal properties', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('"foo".length'))).toBe(3)
  })
  it('evaluates array literals', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('["foo", 1+2]'))).toEqual(['foo', 3])
  })
  it('applys the "in" operator to strings', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('"bar" in "foobartek"'))).toBe(true)
    expect(e.eval(toTree('"baz" in "foobartek"'))).toBe(false)
  })
  it('applys the "in" operator to arrays', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('"bar" in ["foo","bar","tek"]'))).toBe(true)
    expect(e.eval(toTree('"baz" in ["foo","bar","tek"]'))).toBe(false)
  })
  it('evaluates a conditional expression', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('"foo" ? 1 : 2'))).toBe(1)
    expect(e.eval(toTree('"" ? 1 : 2'))).toBe(2)
  })
  it('allows missing consequent in ternary', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('"foo" ?: "bar"'))).toBe('foo')
  })
  it('does not treat falsey properties as undefined', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('"".length'))).toBe(0)
  })
  it('returns empty array when applying a filter to an undefined value', () => {
    const e = new Evaluator(grammar, { a: {}, d: 4 })
    expect(e.eval(toTree('a.b[.c == d]'))).toHaveLength(0)
  })
  it('evaluates an expression with arbitrary whitespace', () => {
    const e = new Evaluator(grammar)
    expect(e.eval(toTree('(\t2\n+\n3) *\n4\n\r\n'))).toBe(20)
  })
  it('evaluates an expression with $ in identifiers', () => {
    const context = {
      $: 5,
      $foo: 6,
      $foo$bar: 7,
      $bar: 8
    }
    const expr = '$+$foo+$foo$bar+$bar'
    const e = new Evaluator(grammar, context)
    expect(e.eval(toTree(expr))).toBe(26)
  })
  describe('Template Strings', () => {
    it('evaluates a simple template string', () => {
      const e = new Evaluator(grammar, { name: 'World' })
      expect(e.eval(toTree('`Hello ${name}`'))).toBe(
        'Hello World'
      )
    })
    it('evaluates template string with expression', () => {
      const e = new Evaluator(grammar, { price: 10, quantity: 3 })
      expect(
        e.eval(toTree('`Total: ${price * quantity}`'))
      ).toBe('Total: 30')
    })
    it('evaluates template string with multiple interpolations', () => {
      const e = new Evaluator(grammar, { a: 5, b: 3, c: 8 })
      expect(e.eval(toTree('`${a} + ${b} = ${c}`'))).toBe(
        '5 + 3 = 8'
      )
    })
    it('evaluates template string with null value', () => {
      const e = new Evaluator(grammar, {})
      expect(e.eval(toTree('`Value: ${missing}`'))).toBe(
        'Value: '
      )
    })
    it('evaluates template string with undefined value', () => {
      const e = new Evaluator(grammar, { obj: {} })
      expect(e.eval(toTree('`Value: ${obj.missing}`'))).toBe(
        'Value: '
      )
    })
    it('evaluates template string with ternary expression', () => {
      const e = new Evaluator(grammar, { age: 20 })
      expect(
        e.eval(toTree('`Status: ${age >= 18 ? "adult" : "minor"}`'))
      ).toBe('Status: adult')
    })
    it('evaluates template string with array access', () => {
      const e = new Evaluator(grammar, { items: ['a', 'b', 'c'] })
      expect(e.eval(toTree('`First: ${items[0]}`'))).toBe(
        'First: a'
      )
    })
    it('evaluates template string with object access', () => {
      const e = new Evaluator(grammar, {
        user: { firstName: 'John', lastName: 'Doe' }
      })
      expect(
        e.eval(toTree('`Name: ${user.firstName + " " + user.lastName}`'))
      ).toBe('Name: John Doe')
    })
    it('evaluates template string with escaped backticks', () => {
      const e = new Evaluator(grammar)
      expect(e.eval(toTree('`Code: \\`example\\``'))).toBe(
        'Code: `example`'
      )
    })
    it('evaluates template string with escaped dollar signs', () => {
      const e = new Evaluator(grammar)
      expect(e.eval(toTree('`Price: \\$100`'))).toBe(
        'Price: $100'
      )
    })
    it('evaluates static template string with no interpolations', () => {
      const e = new Evaluator(grammar)
      expect(e.eval(toTree('`just a string`'))).toBe(
        'just a string'
      )
    })
  })
})
