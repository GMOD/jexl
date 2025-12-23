/*
 * Complex Template String Tests
 */

/* global setTimeout */

import { describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'

describe('Template Strings with Complex Expressions', () => {
  const jexl = new Jexl()

  // Add a 'get' function similar to what might be used in JBrowse
  jexl.addFunction('get', (obj, prop) => obj?.[prop])

  // Add some transforms
  jexl.addTransform('upper', (val) => val.toUpperCase())
  jexl.addTransform('lower', (val) => val.toLowerCase())
  jexl.addTransform('round', (val) => Math.round(val))

  const context = {
    feature: {
      name: 'BRCA1',
      score: 95.7,
      type: 'gene',
      location: { start: 1000, end: 2000 }
    },
    user: {
      firstName: 'Jane',
      lastName: 'Doe'
    },
    threshold: 80
  }

  it('evaluates function calls in template strings', () => {
    const result = jexl.eval('`Feature name: ${get(feature, "name")}`', context)
    expect(result).toBe('Feature name: BRCA1')
  })

  it('evaluates nested property access in function calls', () => {
    const result = jexl.eval(
      '`Start position: ${get(feature.location, "start")}`',
      context
    )
    expect(result).toBe('Start position: 1000')
  })

  it('evaluates transforms in template strings', () => {
    const result = jexl.eval('`Type: ${feature.type|upper}`', context)
    expect(result).toBe('Type: GENE')
  })

  it('evaluates math expressions in template strings', () => {
    const result = jexl.eval(
      '`Length: ${feature.location.end - feature.location.start}`',
      context
    )
    expect(result).toBe('Length: 1000')
  })

  it('evaluates conditional expressions in template strings', () => {
    const result = jexl.eval(
      '`Status: ${feature.score >= threshold ? "PASS" : "FAIL"}`',
      context
    )
    expect(result).toBe('Status: PASS')
  })

  it('evaluates multiple complex expressions in one template', () => {
    const result = jexl.eval(
      '`${user.firstName|upper} ${user.lastName|upper}: ${get(feature, "name")} (${feature.score|round})`',
      context
    )
    expect(result).toBe('JANE DOE: BRCA1 (96)')
  })

  it('evaluates function calls with expression arguments', () => {
    const result = jexl.eval('`Name: ${get(feature, "na" + "me")}`', context)
    expect(result).toBe('Name: BRCA1')
  })

  it('evaluates array access in template strings', () => {
    const contextWithArray = {
      features: [
        { name: 'TP53', score: 90 },
        { name: 'BRCA2', score: 85 }
      ]
    }
    const result = jexl.eval(
      '`First: ${features[0].name}, Second: ${features[1].name}`',
      contextWithArray
    )
    expect(result).toBe('First: TP53, Second: BRCA2')
  })

  it('evaluates filter expressions in template strings', () => {
    const contextWithArray = {
      features: [
        { name: 'TP53', score: 90 },
        { name: 'BRCA2', score: 85 }
      ]
    }
    const result = jexl.eval(
      '`High scores: ${features[.score >= 88].name}`',
      contextWithArray
    )
    expect(result).toBe('High scores: TP53')
  })

  it('evaluates multiple property accesses in template strings', () => {
    const result = jexl.eval(
      '`Feature: ${feature.name}, Range: ${feature.location.start}-${feature.location.end}`',
      context
    )
    expect(result).toBe('Feature: BRCA1, Range: 1000-2000')
  })

  it('evaluates chained transforms in template strings', () => {
    const result = jexl.eval('`Name: ${feature.name|lower|upper}`', context)
    expect(result).toBe('Name: BRCA1')
  })

  it('evaluates nested object construction in template strings', () => {
    const result = jexl.eval(
      '`Data: ${feature.location.start + feature.location.end}`',
      context
    )
    expect(result).toBe('Data: 3000')
  })

  it('evaluates logical operators in template strings', () => {
    const result = jexl.eval(
      '`Valid: ${feature.score > 80 && feature.type == "gene"}`',
      context
    )
    expect(result).toBe('Valid: true')
  })

  it('evaluates complex nested expressions', () => {
    const result = jexl.eval(
      '`Result: ${(feature.score > threshold ? feature.name : "N/A")|upper}`',
      context
    )
    expect(result).toBe('Result: BRCA1')
  })
})
