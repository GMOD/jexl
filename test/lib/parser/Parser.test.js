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
    expect(inst.parse('1+2')).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      left: { type: 'Literal', value: 1 },
      right: { type: 'Literal', value: 2 }
    })
  })
  it('adds heavier operations to the right for 2+3*4', () => {
    expect(inst.parse('2+3*4')).toEqual({
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
    expect(inst.parse('2*3+4')).toEqual({
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
    expect(inst.parse('2+3*4==5/6-7')).toEqual({
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
    expect(inst.parse('1*!!true-2')).toEqual({
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
    expect(inst.parse('(2+3)*4')).toEqual({
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
    expect(inst.parse('(4*(2+3))/5')).toEqual({
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
    expect(inst.parse('{foo: "bar", tek: 1+2}')).toEqual({
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
    expect(inst.parse(`{'with-dash': "bar", tek: 1+2}`)).toEqual({
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
    expect(inst.parse('{foo: {bar: "tek"}}')).toEqual({
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
    expect(inst.parse('{}')).toEqual({
      type: 'ObjectLiteral',
      value: {}
    })
  })
  it('handles array literals', () => {
    expect(inst.parse('["foo", 1+2]')).toEqual({
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
    expect(inst.parse('["foo", ["bar", "tek"]]')).toEqual({
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
    expect(inst.parse('[]')).toEqual({
      type: 'ArrayLiteral',
      value: []
    })
  })
  it('chains traversed identifiers', () => {
    expect(inst.parse('foo.bar.baz + 1')).toEqual({
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
    expect(inst.parse('"foo".length + {foo: "bar"}.foo')).toEqual({
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
    expect(inst.parse('("foo" + "bar").length')).toEqual({
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
    expect(inst.parse('["foo", "bar"].length')).toEqual({
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
    expect(inst.parse('foo ? 1 : 0')).toEqual({
      type: 'ConditionalExpression',
      test: { type: 'Identifier', value: 'foo' },
      consequent: { type: 'Literal', value: 1 },
      alternate: { type: 'Literal', value: 0 }
    })
  })
  it('handles nested and grouped ternary expressions', () => {
    expect(inst.parse('foo ? (bar ? 1 : 2) : 3')).toEqual({
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
    expect(inst.parse('foo ? bar ? 1 : 2 : 3')).toEqual({
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
    expect(inst.parse('foo ? {bar: "tek"} : "baz"')).toEqual({
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
    expect(inst.parse('a.b == c.d')).toEqual({
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
    expect(inst.parse('\t2\r\n+\n\r3\n\n')).toEqual({
      type: 'BinaryExpression',
      operator: '+',
      left: { type: 'Literal', value: 2 },
      right: { type: 'Literal', value: 3 }
    })
  })
})
