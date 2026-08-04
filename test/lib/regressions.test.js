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
})
