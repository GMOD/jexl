/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it } from 'vitest'

import Lexer from '../../src/Lexer.ts'
import { getGrammar } from '../../src/grammar.ts'

const grammar = getGrammar()
let inst

describe('Lexer', () => {
  beforeEach(() => {
    inst = new Lexer(grammar)
  })
  describe('Elements', () => {
    it('counts a string as one element', () => {
      const str = '"foo"'
      const elems = inst.getElements(str)
      expect(elems).toHaveLength(1)
      expect(elems[0]).toBe(str)
    })
    it('supports single-quote strings', () => {
      const str = "'foo'"
      const elems = inst.getElements(str)
      expect(elems).toHaveLength(1)
      expect(elems[0]).toEqual(str)
    })
    it('supports escaping double-quotes', () => {
      const str = String.raw`"f\"oo"`
      const elems = inst.getElements(str)
      expect(elems).toHaveLength(1)
      expect(elems[0]).toEqual(str)
    })
    it('supports escaped double-quotes at the end of strings', () => {
      const str = String.raw`"foo\""`
      const elems = inst.getElements(str)
      expect(elems).toHaveLength(1)
      expect(elems[0]).toEqual(str)
    })
    it('supports escaping single-quotes', () => {
      const str = String.raw`'f\'oo'`
      const elems = inst.getElements(str)
      expect(elems).toHaveLength(1)
      expect(elems[0]).toEqual(str)
    })
    it('supports escaped single-quotes at the end of strings', () => {
      const str = String.raw`'foo\''`
      const elems = inst.getElements(str)
      expect(elems).toHaveLength(1)
      expect(elems[0]).toEqual(str)
    })
    it('counts an identifier as one element', () => {
      const str = 'alpha12345'
      const elems = inst.getElements(str)
      expect(elems).toEqual([str])
    })
    it('does not split grammar elements out of transforms', () => {
      const str = 'inString'
      const elems = inst.getElements(str)
      expect(elems).toEqual([str])
    })
    it('allows an identifier to start with and contain $', () => {
      const str = '$my$Var'
      const elems = inst.getElements(str)
      expect(elems).toEqual([str])
    })
    it('allows an identifier to start with and contain accented letters from Latin 1 Supplement unicode block', () => {
      const str = 'ÄmyäVarÖö'
      const elems = inst.getElements(str)
      expect(elems).toEqual([str])
    })
    it('allows an identifier to start with and contain accented letters from Russian unicode block', () => {
      const str = 'Проверка'
      const elems = inst.getElements(str)
      expect(elems).toEqual([str])
    })
    it('keeps a keyword followed by a non-ASCII or $ character in one identifier', () => {
      for (const str of ['in$', 'inà', 'inя', 'true$', 'trueà', 'falseé']) {
        expect(inst.getElements(str), str).toEqual([str])
        expect(inst.tokenize(str)[0].type, str).toBe('identifier')
      }
    })
    it('still splits a keyword off punctuation and whitespace', () => {
      expect(inst.getElements('a in[b]')).toEqual([
        'a',
        ' ',
        'in',
        '[',
        'b',
        ']'
      ])
      expect(inst.getElements('(true)')).toEqual(['(', 'true', ')'])
    })
    it('matches a host word operator that starts with $', () => {
      const lexer = new Lexer({
        ...grammar,
        elements: { ...grammar.elements, $and: { type: 'binaryOp' } }
      })
      expect(lexer.getElements('a $and b')).toEqual([
        'a',
        ' ',
        '$and',
        ' ',
        'b'
      ])
      expect(lexer.getElements('$andy')).toEqual(['$andy'])
    })
  })
  describe('Tokens', () => {
    it('unquotes string elements', () => {
      const tokens = inst.getTokens([String.raw`"foo \"bar\\"`])
      expect(tokens).toEqual([
        {
          type: 'literal',
          value: 'foo "bar\\',
          raw: String.raw`"foo \"bar\\"`
        }
      ])
    })
    it('recognizes booleans', () => {
      const tokens = inst.getTokens(['true', 'false'])
      expect(tokens).toEqual([
        {
          type: 'literal',
          value: true,
          raw: 'true'
        },
        {
          type: 'literal',
          value: false,
          raw: 'false'
        }
      ])
    })
    it('recognizes null', () => {
      expect(inst.tokenize('null')).toEqual([
        { type: 'literal', value: null, raw: 'null' }
      ])
      for (const str of ['nullable', '_null', 'null$', 'nullя']) {
        expect(inst.tokenize(str), str).toEqual([
          { type: 'identifier', value: str, raw: str }
        ])
      }
    })
    it('recognizes numerics', () => {
      const tokens = inst.getTokens(['-7.6', '20'])
      expect(tokens).toEqual([
        {
          type: 'literal',
          value: -7.6,
          raw: '-7.6'
        },
        {
          type: 'literal',
          value: 20,
          raw: '20'
        }
      ])
    })
    it('recognizes binary operators', () => {
      const tokens = inst.getTokens(['+'])
      expect(tokens).toEqual([
        {
          type: 'binaryOp',
          value: '+',
          raw: '+'
        }
      ])
    })
    it('recognizes unary operators', () => {
      const tokens = inst.getTokens(['!'])
      expect(tokens).toEqual([
        {
          type: 'unaryOp',
          value: '!',
          raw: '!'
        }
      ])
    })
    it('recognizes control characters', () => {
      const tokens = inst.getTokens(['('])
      expect(tokens).toEqual([
        {
          type: 'openParen',
          value: '(',
          raw: '('
        }
      ])
    })
    it('recognizes identifiers', () => {
      const tokens = inst.getTokens(['_foo9_bar'])
      expect(tokens).toEqual([
        {
          type: 'identifier',
          value: '_foo9_bar',
          raw: '_foo9_bar'
        }
      ])
    })
    it('throws on invalid token', () => {
      const fn = inst.getTokens.bind(Lexer, ['9foo'])
      expect(fn).toThrow()
    })
  })
  it('tokenizes a full expression', () => {
    const tokens = inst.tokenize(
      String.raw`6+x -  -17.55*y<= !foo.bar["baz\"foz"]`
    )
    expect(tokens).toEqual([
      { type: 'literal', value: 6, raw: '6' },
      { type: 'binaryOp', value: '+', raw: '+' },
      { type: 'identifier', value: 'x', raw: 'x ' },
      { type: 'binaryOp', value: '-', raw: '-  ' },
      { type: 'literal', value: -17.55, raw: '-17.55' },
      { type: 'binaryOp', value: '*', raw: '*' },
      { type: 'identifier', value: 'y', raw: 'y' },
      { type: 'binaryOp', value: '<=', raw: '<= ' },
      { type: 'unaryOp', value: '!', raw: '!' },
      { type: 'identifier', value: 'foo', raw: 'foo' },
      { type: 'dot', value: '.', raw: '.' },
      { type: 'identifier', value: 'bar', raw: 'bar' },
      { type: 'openBracket', value: '[', raw: '[' },
      { type: 'literal', value: 'baz"foz', raw: String.raw`"baz\"foz"` },
      { type: 'closeBracket', value: ']', raw: ']' }
    ])
  })
  describe('Numbers', () => {
    const valueOf = (str) => {
      const tokens = inst.tokenize(str)
      expect(tokens).toHaveLength(1)
      expect(tokens[0].type).toBe('literal')
      return tokens[0].value
    }
    it('reads scientific notation', () => {
      expect(valueOf('1e3')).toBe(1000)
      expect(valueOf('1E3')).toBe(1000)
      expect(valueOf('1e+3')).toBe(1000)
      expect(valueOf('1e-8')).toBe(1e-8)
      expect(valueOf('1.5e-3')).toBe(0.0015)
      expect(valueOf('.5e3')).toBe(500)
    })
    it('folds a prefix minus into scientific notation', () => {
      expect(inst.tokenize('-5e-8')).toEqual([
        { type: 'literal', value: -5e-8, raw: '-5e-8' }
      ])
      expect(inst.tokenize('x - 5e-8')).toEqual([
        { type: 'identifier', value: 'x', raw: 'x ' },
        { type: 'binaryOp', value: '-', raw: '- ' },
        { type: 'literal', value: 5e-8, raw: '5e-8' }
      ])
    })
    it('reads a leading-dot decimal as a number rather than a dot', () => {
      expect(valueOf('.5')).toBe(0.5)
      expect(valueOf('-.5')).toBe(-0.5)
      expect(inst.getElements('[.5]')).toEqual(['[', '.5', ']'])
    })
    it('leaves an e that does not complete an exponent to the identifier', () => {
      expect(inst.getElements('e')).toEqual(['e'])
      expect(inst.getElements('e3')).toEqual(['e3'])
      expect(inst.getElements('a.e3')).toEqual(['a', '.', 'e3'])
      expect(inst.getElements('x1e3')).toEqual(['x1e3'])
      expect(inst.getElements('2e')).toEqual(['2', 'e'])
      expect(inst.getElements('1e3e')).toEqual(['1e3', 'e'])
    })
    it('still splits member access off a number, name or group', () => {
      expect(inst.getElements('a.b')).toEqual(['a', '.', 'b'])
      expect(inst.getElements('a[0].b')).toEqual(['a', '[', '0', ']', '.', 'b'])
      expect(inst.getElements('f(1).x')).toEqual(['f', '(', '1', ')', '.', 'x'])
    })
  })
  it('considers minus to be negative appropriately', () => {
    expect(inst.tokenize('-1?-2:-3')).toEqual([
      { type: 'literal', value: -1, raw: '-1' },
      { type: 'question', value: '?', raw: '?' },
      { type: 'literal', value: -2, raw: '-2' },
      { type: 'colon', value: ':', raw: ':' },
      { type: 'literal', value: -3, raw: '-3' }
    ])
  })
  describe('Template Strings', () => {
    it('tokenizes a simple template string', () => {
      const tokens = inst.tokenize('`hello world`')
      expect(tokens[0].type).toBe('templateString')
      expect(tokens[0].raw).toBe('`hello world`')
      expect(tokens[0].value).toEqual([
        { type: 'static', value: 'hello world' }
      ])
    })
    it('tokenizes a template string with interpolation', () => {
      const tokens = inst.tokenize('`hello ${name}`')
      expect(tokens[0].type).toBe('templateString')
      expect(tokens[0].value).toHaveLength(2)
      expect(tokens[0].value[0]).toEqual({ type: 'static', value: 'hello ' })
      expect(tokens[0].value[1]).toEqual({
        type: 'interpolation',
        value: 'name'
      })
    })
    it('tokenizes a template string with multiple interpolations', () => {
      const tokens = inst.tokenize('`${a} + ${b} = ${c}`')
      expect(tokens[0].value).toHaveLength(5)
      expect(tokens[0].value[0]).toEqual({ type: 'interpolation', value: 'a' })
      expect(tokens[0].value[1]).toEqual({ type: 'static', value: ' + ' })
      expect(tokens[0].value[2]).toEqual({ type: 'interpolation', value: 'b' })
      expect(tokens[0].value[3]).toEqual({ type: 'static', value: ' = ' })
      expect(tokens[0].value[4]).toEqual({ type: 'interpolation', value: 'c' })
    })
    it('handles escaped backticks', () => {
      const tokens = inst.tokenize('`hello \\` world`')
      expect(tokens[0].value).toEqual([
        { type: 'static', value: 'hello \\` world' }
      ])
    })
    it('handles escaped dollar signs', () => {
      const tokens = inst.tokenize('`price: \\$100`')
      expect(tokens[0].value).toEqual([
        { type: 'static', value: String.raw`price: \$100` }
      ])
    })
    it('handles nested braces in interpolations', () => {
      const tokens = inst.tokenize('`result: ${obj.map(x => {return x})}`')
      expect(tokens[0].value[1].value).toBe('obj.map(x => {return x})')
    })
    it('handles complex expressions in interpolations', () => {
      const tokens = inst.tokenize('`total: ${price * quantity}`')
      expect(tokens[0].value[1].value).toBe('price * quantity')
    })
    it('throws on unclosed interpolation', () => {
      expect(() => inst.tokenize('`unclosed: ${1 + 2`')).toThrow(
        /Unclosed interpolation/
      )
    })
  })
})
