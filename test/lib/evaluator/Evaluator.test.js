/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import Lexer from '../../../src/Lexer.ts'
import PromiseSync from '../../../src/PromiseSync.ts'
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
  it('evaluates using an alternative Promise class', () => {
    const e = new Evaluator(grammar, null, null, PromiseSync)
    expect(e.eval(toTree('2 + 2'))).toHaveProperty('value', 4)
  })
  it('evaluates an arithmetic expression', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('(2 + 3) * 4'))).resolves.toBe(20)
  })
  it('evaluates a string concat', async () => {
    const e = new Evaluator(grammar)
    return expect(
      e.eval(toTree(String.raw`"Hello" + (4+4) + "Wo\"rld"`))
    ).resolves.toBe('Hello8Wo"rld')
  })
  it('evaluates a true comparison expression', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('2 > 1'))).resolves.toBe(true)
  })
  it('evaluates a false comparison expression', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('2 <= 1'))).resolves.toBe(false)
  })
  it('evaluates a complex expression', async () => {
    const e = new Evaluator(grammar)
    return expect(
      e.eval(toTree('"foo" && 6 >= 6 && 0 + 1 && true'))
    ).resolves.toBe(true)
  })
  it('evaluates an identifier chain', async () => {
    const context = { foo: { baz: { bar: 'tek' } } }
    const e = new Evaluator(grammar, context)
    return expect(e.eval(toTree('foo.baz.bar'))).resolves.toBe(
      context.foo.baz.bar
    )
  })
  it('applies transforms', async () => {
    const context = { foo: 10 }
    const half = (val) => val / 2
    const g = { ...grammar, transforms: { half } }
    const e = new Evaluator(g, context)
    return expect(e.eval(toTree('foo|half + 3'))).resolves.toBe(8)
  })
  it('filters arrays', async () => {
    const context = {
      foo: {
        bar: [{ tek: 'hello' }, { tek: 'baz' }, { tok: 'baz' }]
      }
    }
    const e = new Evaluator(grammar, context)
    return expect(e.eval(toTree('foo.bar[.tek == "baz"]'))).resolves.toEqual([
      { tek: 'baz' }
    ])
  })
  it('assumes array index 0 when traversing', async () => {
    const context = {
      foo: {
        bar: [{ tek: { hello: 'world' } }, { tek: { hello: 'universe' } }]
      }
    }
    const e = new Evaluator(grammar, context)
    return expect(e.eval(toTree('foo.bar.tek.hello'))).resolves.toBe('world')
  })
  it('makes array elements addressable by index', async () => {
    const context = {
      foo: {
        bar: [{ tek: 'tok' }, { tek: 'baz' }, { tek: 'foz' }]
      }
    }
    const e = new Evaluator(grammar, context)
    return expect(e.eval(toTree('foo.bar[1].tek'))).resolves.toBe('baz')
  })
  it('allows filters to select object properties', async () => {
    const context = { foo: { baz: { bar: 'tek' } } }
    const e = new Evaluator(grammar, context)
    return expect(e.eval(toTree('foo["ba" + "z"].bar'))).resolves.toBe(
      context.foo.baz.bar
    )
  })
  it('throws when transform does not exist', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('"hello"|world'))).rejects.toThrow(Error)
  })
  it('applys the DivFloor operator', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('7 // 2'))).resolves.toBe(3)
  })
  it('evaluates an object literal', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('{foo: {bar: "tek"}}'))).resolves.toEqual({
      foo: { bar: 'tek' }
    })
  })
  it('evaluates an empty object literal', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('{}'))).resolves.toEqual({})
  })
  it('evaluates a transform with multiple args', async () => {
    const g = {
      ...grammar,
      transforms: {
        concat: (val, a1, a2, a3) => val + ': ' + a1 + a2 + a3
      }
    }
    const e = new Evaluator(g)
    return expect(
      e.eval(toTree('"foo"|concat("baz", "bar", "tek")'))
    ).resolves.toBe('foo: bazbartek')
  })
  it('evaluates dot notation for object literals', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('{foo: "bar"}.foo'))).resolves.toBe('bar')
  })
  it('allows access to literal properties', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('"foo".length'))).resolves.toBe(3)
  })
  it('evaluates array literals', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('["foo", 1+2]'))).resolves.toEqual(['foo', 3])
  })
  it('applys the "in" operator to strings', async () => {
    const e = new Evaluator(grammar)
    return Promise.all([
      expect(e.eval(toTree('"bar" in "foobartek"'))).resolves.toBe(true),
      expect(e.eval(toTree('"baz" in "foobartek"'))).resolves.toBe(false)
    ])
  })
  it('applys the "in" operator to arrays', async () => {
    const e = new Evaluator(grammar)
    return Promise.all([
      expect(e.eval(toTree('"bar" in ["foo","bar","tek"]'))).resolves.toBe(
        true
      ),
      expect(e.eval(toTree('"baz" in ["foo","bar","tek"]'))).resolves.toBe(
        false
      )
    ])
  })
  it('evaluates a conditional expression', async () => {
    const e = new Evaluator(grammar)
    return Promise.all([
      expect(e.eval(toTree('"foo" ? 1 : 2'))).resolves.toBe(1),
      expect(e.eval(toTree('"" ? 1 : 2'))).resolves.toBe(2)
    ])
  })
  it('allows missing consequent in ternary', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('"foo" ?: "bar"'))).resolves.toBe('foo')
  })
  it('does not treat falsey properties as undefined', async () => {
    const e = new Evaluator(grammar)
    return expect(e.eval(toTree('"".length'))).resolves.toBe(0)
  })
  it('returns empty array when applying a filter to an undefined value', async () => {
    const e = new Evaluator(grammar, { a: {}, d: 4 })
    return expect(e.eval(toTree('a.b[.c == d]'))).resolves.toHaveLength(0)
  })
  it('evaluates an expression with arbitrary whitespace', async () => {
    const e = new Evaluator(grammar)
    await expect(e.eval(toTree('(\t2\n+\n3) *\n4\n\r\n'))).resolves.toBe(20)
  })
  it('evaluates an expression with $ in identifiers', async () => {
    const context = {
      $: 5,
      $foo: 6,
      $foo$bar: 7,
      $bar: 8
    }
    const expr = '$+$foo+$foo$bar+$bar'
    const e = new Evaluator(grammar, context)
    await expect(e.eval(toTree(expr))).resolves.toBe(26)
  })
  describe('Template Strings', () => {
    it('evaluates a simple template string', async () => {
      const e = new Evaluator(grammar, { name: 'World' })
      return expect(e.eval(toTree('`Hello ${name}`'))).resolves.toBe(
        'Hello World'
      )
    })
    it('evaluates template string with expression', async () => {
      const e = new Evaluator(grammar, { price: 10, quantity: 3 })
      return expect(
        e.eval(toTree('`Total: ${price * quantity}`'))
      ).resolves.toBe('Total: 30')
    })
    it('evaluates template string with multiple interpolations', async () => {
      const e = new Evaluator(grammar, { a: 5, b: 3, c: 8 })
      return expect(e.eval(toTree('`${a} + ${b} = ${c}`'))).resolves.toBe(
        '5 + 3 = 8'
      )
    })
    it('evaluates template string with null value', async () => {
      const e = new Evaluator(grammar, {})
      return expect(e.eval(toTree('`Value: ${missing}`'))).resolves.toBe(
        'Value: '
      )
    })
    it('evaluates template string with undefined value', async () => {
      const e = new Evaluator(grammar, { obj: {} })
      return expect(e.eval(toTree('`Value: ${obj.missing}`'))).resolves.toBe(
        'Value: '
      )
    })
    it('evaluates template string with ternary expression', async () => {
      const e = new Evaluator(grammar, { age: 20 })
      return expect(
        e.eval(toTree('`Status: ${age >= 18 ? "adult" : "minor"}`'))
      ).resolves.toBe('Status: adult')
    })
    it('evaluates template string with array access', async () => {
      const e = new Evaluator(grammar, { items: ['a', 'b', 'c'] })
      return expect(e.eval(toTree('`First: ${items[0]}`'))).resolves.toBe(
        'First: a'
      )
    })
    it('evaluates template string with object access', async () => {
      const e = new Evaluator(grammar, {
        user: { firstName: 'John', lastName: 'Doe' }
      })
      return expect(
        e.eval(toTree('`Name: ${user.firstName + " " + user.lastName}`'))
      ).resolves.toBe('Name: John Doe')
    })
    it('evaluates template string with escaped backticks', async () => {
      const e = new Evaluator(grammar)
      return expect(e.eval(toTree('`Code: \\`example\\``'))).resolves.toBe(
        'Code: `example`'
      )
    })
    it('evaluates template string with escaped dollar signs', async () => {
      const e = new Evaluator(grammar)
      return expect(e.eval(toTree('`Price: \\$100`'))).resolves.toBe(
        'Price: $100'
      )
    })
    it('evaluates static template string with no interpolations', async () => {
      const e = new Evaluator(grammar)
      return expect(e.eval(toTree('`just a string`'))).resolves.toBe(
        'just a string'
      )
    })
  })
})
