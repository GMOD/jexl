/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'

describe('Ternary operator with functions and transforms', () => {
  const jexl = new Jexl()

  jexl.addFunction('parseInt', (str) => parseInt(str, 10))
  jexl.addFunction('isNaN', (val) => isNaN(val))
  jexl.addFunction('foo', () => true)
  jexl.addFunction('bar', () => false)
  jexl.addFunction('len', (str) => str.length)

  jexl.addTransform('upper', (val) => val.toUpperCase())

  describe('Function calls as ternary condition', () => {
    it('handles function call returning true', () => {
      expect(jexl.evalSync('foo() ? 1 : 0')).toBe(1)
    })

    it('handles function call returning false', () => {
      expect(jexl.evalSync('bar() ? 1 : 0')).toBe(0)
    })

    it('handles complex function composition', () => {
      expect(jexl.evalSync('isNaN(parseInt(size)) ? 0 : parseInt(size)', { size: '' })).toBe(0)
    })

    it('handles valid number parsing', () => {
      expect(jexl.evalSync('isNaN(parseInt(size)) ? 0 : parseInt(size)', { size: '42' })).toBe(42)
    })
  })

  describe('Function calls with comparisons in ternary', () => {
    it('handles function result comparison', () => {
      expect(jexl.evalSync('len(name) > 5 ? "long" : "short"', { name: 'Christopher' })).toBe('long')
    })

    it('handles function result comparison (short)', () => {
      expect(jexl.evalSync('len(name) > 5 ? "long" : "short"', { name: 'Joe' })).toBe('short')
    })
  })

  describe('Transforms in ternary', () => {
    it('handles transform as ternary condition', () => {
      expect(jexl.evalSync('name|upper ? "yes" : "no"', { name: 'test' })).toBe('yes')
    })

    it('handles falsy transform result', () => {
      expect(jexl.evalSync('name|upper ? "yes" : "no"', { name: '' })).toBe('no')
    })
  })
})
