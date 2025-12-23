/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it } from 'vitest'

import Lexer from '../../../src/Lexer.ts'
import { getGrammar } from '../../../src/grammar.ts'
import Parser from '../../../src/parser/Parser.ts'

const grammar = getGrammar()

let inst
const lexer = new Lexer(grammar)

describe('Parser', () => {
  beforeEach(() => {
    inst = new Parser(grammar, lexer)
  })
  it('constructs an AST for 1+2', () => {
    inst.addTokens(lexer.tokenize('1+2'))
    expect(inst.complete()).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      left: { type: 'Literal', value: 1 },
      right: { type: 'Literal', value: 2 }
    })
  })
  it('adds heavier operations to the right for 2+3*4', () => {
    inst.addTokens(lexer.tokenize('2+3*4'))
    expect(inst.complete()).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      left: { type: 'Literal', value: 2 },
      right: {
        type: 'BinaryExpression',
        operator: '*',
        left: { type: 'Literal', value: 3 },
        right: { type: 'Literal', value: 4 }
      }
    })
  })
  it('encapsulates for lighter operation in 2*3+4', () => {
    inst.addTokens(lexer.tokenize('2*3+4'))
    expect(inst.complete()).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      left: {
        type: 'BinaryExpression',
        operator: '*',
        left: { type: 'Literal', value: 2 },
        right: { type: 'Literal', value: 3 }
      },
      right: { type: 'Literal', value: 4 }
    })
  })
  it('handles encapsulation of subtree in 2+3*4==5/6-7', () => {
    inst.addTokens(lexer.tokenize('2+3*4==5/6-7'))
    expect(inst.complete()).toEqual({
      type: 'BinaryExpression',
      operator: '==',
      left: {
        type: 'BinaryExpression',
        operator: '+',
        left: { type: 'Literal', value: 2 },
        right: {
          type: 'BinaryExpression',
          operator: '*',
          left: { type: 'Literal', value: 3 },
          right: { type: 'Literal', value: 4 }
        }
      },
      right: {
        type: 'BinaryExpression',
        operator: '-',
        left: {
          type: 'BinaryExpression',
          operator: '/',
          left: { type: 'Literal', value: 5 },
          right: { type: 'Literal', value: 6 }
        },
        right: { type: 'Literal', value: 7 }
      }
    })
  })
  it('handles a unary operator', () => {
    inst.addTokens(lexer.tokenize('1*!!true-2'))
    expect(inst.complete()).toEqual({
      type: 'BinaryExpression',
      operator: '-',
      left: {
        type: 'BinaryExpression',
        operator: '*',
        left: { type: 'Literal', value: 1 },
        right: {
          type: 'UnaryExpression',
          operator: '!',
          right: {
            type: 'UnaryExpression',
            operator: '!',
            right: { type: 'Literal', value: true }
          }
        }
      },
      right: { type: 'Literal', value: 2 }
    })
  })
  it('handles a subexpression', () => {
    inst.addTokens(lexer.tokenize('(2+3)*4'))
    expect(inst.complete()).toEqual({
      type: 'BinaryExpression',
      operator: '*',
      left: {
        type: 'BinaryExpression',
        operator: '+',
        left: { type: 'Literal', value: 2 },
        right: { type: 'Literal', value: 3 }
      },
      right: { type: 'Literal', value: 4 }
    })
  })
  it('handles nested subexpressions', () => {
    inst.addTokens(lexer.tokenize('(4*(2+3))/5'))
    expect(inst.complete()).toEqual({
      type: 'BinaryExpression',
      operator: '/',
      left: {
        type: 'BinaryExpression',
        operator: '*',
        left: { type: 'Literal', value: 4 },
        right: {
          type: 'BinaryExpression',
          operator: '+',
          left: { type: 'Literal', value: 2 },
          right: { type: 'Literal', value: 3 }
        }
      },
      right: { type: 'Literal', value: 5 }
    })
  })
  it('handles object literals', () => {
    inst.addTokens(lexer.tokenize('{foo: "bar", tek: 1+2}'))
    expect(inst.complete()).toEqual({
      type: 'ObjectLiteral',
      value: {
        foo: { type: 'Literal', value: 'bar' },
        tek: {
          type: 'BinaryExpression',
          operator: '+',
          left: { type: 'Literal', value: 1 },
          right: { type: 'Literal', value: 2 }
        }
      }
    })
  })
  it('handles dashes in key', () => {
    inst.addTokens(lexer.tokenize(`{'with-dash': "bar", tek: 1+2}`))
    expect(inst.complete()).toEqual({
      type: 'ObjectLiteral',
      value: {
        'with-dash': { type: 'Literal', value: 'bar' },
        tek: {
          type: 'BinaryExpression',
          operator: '+',
          left: { type: 'Literal', value: 1 },
          right: { type: 'Literal', value: 2 }
        }
      }
    })
  })
  it('handles nested object literals', () => {
    inst.addTokens(lexer.tokenize('{foo: {bar: "tek"}}'))
    expect(inst.complete()).toEqual({
      type: 'ObjectLiteral',
      value: {
        foo: {
          type: 'ObjectLiteral',
          value: {
            bar: { type: 'Literal', value: 'tek' }
          }
        }
      }
    })
  })
  it('handles empty object literals', () => {
    inst.addTokens(lexer.tokenize('{}'))
    expect(inst.complete()).toEqual({
      type: 'ObjectLiteral',
      value: {}
    })
  })
  it('handles array literals', () => {
    inst.addTokens(lexer.tokenize('["foo", 1+2]'))
    expect(inst.complete()).toEqual({
      type: 'ArrayLiteral',
      value: [
        { type: 'Literal', value: 'foo' },
        {
          type: 'BinaryExpression',
          operator: '+',
          left: { type: 'Literal', value: 1 },
          right: { type: 'Literal', value: 2 }
        }
      ]
    })
  })
  it('handles nested array literals', () => {
    inst.addTokens(lexer.tokenize('["foo", ["bar", "tek"]]'))
    expect(inst.complete()).toEqual({
      type: 'ArrayLiteral',
      value: [
        { type: 'Literal', value: 'foo' },
        {
          type: 'ArrayLiteral',
          value: [
            { type: 'Literal', value: 'bar' },
            { type: 'Literal', value: 'tek' }
          ]
        }
      ]
    })
  })
  it('handles empty array literals', () => {
    inst.addTokens(lexer.tokenize('[]'))
    expect(inst.complete()).toEqual({
      type: 'ArrayLiteral',
      value: []
    })
  })
  it('chains traversed identifiers', () => {
    inst.addTokens(lexer.tokenize('foo.bar.baz + 1'))
    expect(inst.complete()).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      left: {
        type: 'Identifier',
        value: 'baz',
        from: {
          type: 'Identifier',
          value: 'bar',
          from: {
            type: 'Identifier',
            value: 'foo'
          }
        }
      },
      right: { type: 'Literal', value: 1 }
    })
  })
  it('allows dot notation for all operands', () => {
    inst.addTokens(lexer.tokenize('"foo".length + {foo: "bar"}.foo'))
    expect(inst.complete()).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      left: {
        type: 'Identifier',
        value: 'length',
        from: { type: 'Literal', value: 'foo' }
      },
      right: {
        type: 'Identifier',
        value: 'foo',
        from: {
          type: 'ObjectLiteral',
          value: {
            foo: { type: 'Literal', value: 'bar' }
          }
        }
      }
    })
  })
  it('allows dot notation on subexpressions', () => {
    inst.addTokens(lexer.tokenize('("foo" + "bar").length'))
    expect(inst.complete()).toEqual({
      type: 'Identifier',
      value: 'length',
      from: {
        type: 'BinaryExpression',
        operator: '+',
        left: { type: 'Literal', value: 'foo' },
        right: { type: 'Literal', value: 'bar' }
      }
    })
  })
  it('allows dot notation on arrays', () => {
    inst.addTokens(lexer.tokenize('["foo", "bar"].length'))
    expect(inst.complete()).toEqual({
      type: 'Identifier',
      value: 'length',
      from: {
        type: 'ArrayLiteral',
        value: [
          { type: 'Literal', value: 'foo' },
          { type: 'Literal', value: 'bar' }
        ]
      }
    })
  })
  it('handles a ternary expression', () => {
    inst.addTokens(lexer.tokenize('foo ? 1 : 0'))
    expect(inst.complete()).toEqual({
      type: 'ConditionalExpression',
      test: { type: 'Identifier', value: 'foo' },
      consequent: { type: 'Literal', value: 1 },
      alternate: { type: 'Literal', value: 0 }
    })
  })
  it('handles nested and grouped ternary expressions', () => {
    inst.addTokens(lexer.tokenize('foo ? (bar ? 1 : 2) : 3'))
    expect(inst.complete()).toEqual({
      type: 'ConditionalExpression',
      test: { type: 'Identifier', value: 'foo' },
      consequent: {
        type: 'ConditionalExpression',
        test: { type: 'Identifier', value: 'bar' },
        consequent: { type: 'Literal', value: 1 },
        alternate: { type: 'Literal', value: 2 }
      },
      alternate: { type: 'Literal', value: 3 }
    })
  })
  it('handles nested, non-grouped ternary expressions', () => {
    inst.addTokens(lexer.tokenize('foo ? bar ? 1 : 2 : 3'))
    expect(inst.complete()).toEqual({
      type: 'ConditionalExpression',
      test: { type: 'Identifier', value: 'foo' },
      consequent: {
        type: 'ConditionalExpression',
        test: { type: 'Identifier', value: 'bar' },
        consequent: { type: 'Literal', value: 1 },
        alternate: { type: 'Literal', value: 2 }
      },
      alternate: { type: 'Literal', value: 3 }
    })
  })
  it('handles ternary expression with objects', () => {
    inst.addTokens(lexer.tokenize('foo ? {bar: "tek"} : "baz"'))
    expect(inst.complete()).toEqual({
      type: 'ConditionalExpression',
      test: { type: 'Identifier', value: 'foo' },
      consequent: {
        type: 'ObjectLiteral',
        value: {
          bar: { type: 'Literal', value: 'tek' }
        }
      },
      alternate: { type: 'Literal', value: 'baz' }
    })
  })
  it('balances a binary op between complex identifiers', () => {
    inst.addTokens(lexer.tokenize('a.b == c.d'))
    expect(inst.complete()).toEqual({
      type: 'BinaryExpression',
      operator: '==',
      left: {
        type: 'Identifier',
        value: 'b',
        from: { type: 'Identifier', value: 'a' }
      },
      right: {
        type: 'Identifier',
        value: 'd',
        from: { type: 'Identifier', value: 'c' }
      }
    })
  })
  it('handles whitespace in an expression', () => {
    inst.addTokens(lexer.tokenize('\t2\r\n+\n\r3\n\n'))
    expect(inst.complete()).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      left: { type: 'Literal', value: 2 },
      right: { type: 'Literal', value: 3 }
    })
  })
})
