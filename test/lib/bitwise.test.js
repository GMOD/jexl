import { describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'
import { check } from '../../src/check/index.ts'
import { print } from '../../src/print.ts'

const jexl = new Jexl()
const ev = (exp, context) => jexl.eval(exp, context)

describe('&', () => {
  it('ands the bits of two numbers', () => {
    expect(ev('flags & 2', { flags: 3 })).toBe(2)
    expect(ev('flags & 4', { flags: 3 })).toBe(0)
    expect(ev('(flags & 1540) == 0', { flags: 1024 })).toBe(false)
  })

  it('binds tighter than a comparison and looser than arithmetic', () => {
    expect(ev('flags & 2 == 2', { flags: 2 })).toBe(true)
    expect(ev('flags & 16 == 0', { flags: 2 })).toBe(true)
    expect(ev('flags & 1 + 1', { flags: 2 })).toBe(2)
    expect(ev('a && flags & 1', { a: true, flags: 3 })).toBe(1)
  })

  it('leaves && the logical and', () => {
    expect(ev('1&&2')).toBe(2)
    expect(ev('1&2')).toBe(0)
  })

  it('pairs list values as the other arithmetic does', () => {
    expect(ev('[3, 6] & 2')).toEqual([2, 2])
    expect(ev('[1, 2] & [1, 3]')).toEqual([1, 2])
  })

  it('prints as it parses', () => {
    for (const exp of ['flags & 2 == 2', '(a == b) & 1', 'a & (b + 1) * 2']) {
      expect(jexl.parse(print(jexl.parse(exp)))).toStrictEqual(jexl.parse(exp))
    }
    expect(print(jexl.parse('flags & 2 == 2'))).toBe('flags & 2 == 2')
  })

  it('checks as a number', () => {
    expect(check(jexl.parse('flags & 2')).type.kind).toBe('number')
  })

  it('warns that it reads text as 0 where it is not a number', () => {
    const { diagnostics } = check(jexl.parse('feature.name & 2'), {
      row: 'feature',
      schema: [{ path: ['name'], type: 'string' }]
    })
    expect(diagnostics.map((d) => d.message)).toEqual([
      'feature.name is text, so & converts it to a number, giving 0 wherever it is not one'
    ])
  })

  it('is replaced by a host operator of the same name', () => {
    const host = new Jexl()
    host.addBinaryOp('&', 15, (a, b) => a & b)
    expect(host.eval('flags & 2 == 2', { flags: 2 })).toBe(0)
  })
})
