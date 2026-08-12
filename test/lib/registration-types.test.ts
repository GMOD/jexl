/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'

/**
 * A registered callback is handed whatever the expression evaluated to, and
 * the context an expression runs against routinely holds values jexl has no
 * literal for — here a host object with methods, standing in for a jbrowse
 * Feature.
 *
 * This file is TypeScript, and `tsconfig.lint.json` covers `test`, so these
 * registrations are typechecked by `pnpm typecheck` as well as run. That is the
 * point of it: the registration signatures previously demanded `JexlValue`
 * parameters, which no callback written against such a value can satisfy, and
 * nothing here failed — the breakage only showed up downstream, as 55 errors
 * across jbrowse-components.
 */
interface Feature {
  get: (key: string) => number | undefined
  id: () => string
}

const feature: Feature = {
  get: (key) => (key === 'start' ? 42 : undefined),
  id: () => 'f1'
}

describe('registration accepts callbacks typed by their author', () => {
  it('takes a function over a host object', () => {
    const inst = new Jexl()
    inst.addFunction('get', (f: Feature, key: string) => f.get(key))
    inst.addFunction('id', (f: Feature) => f.id())
    expect(inst.eval('get(feature, "start")', { feature })).toBe(42)
    expect(inst.eval('id(feature)', { feature })).toBe('f1')
  })
  it('takes a function returning a host object', () => {
    const inst = new Jexl()
    inst.addFunction('self', (f: Feature) => f)
    inst.addFunction('idOf', (f: Feature) => f.id())
    expect(inst.eval('idOf(self(feature))', { feature })).toBe('f1')
  })
  it('takes narrower primitive parameters and a variadic', () => {
    const inst = new Jexl()
    inst.addFunction('upper', (s: string) => s.toUpperCase())
    inst.addFunction('max', Math.max)
    expect(inst.eval('upper("ab")')).toBe('AB')
    expect(inst.eval('max(1, 7, 3)')).toBe(7)
  })
  it('takes a map of them through addFunctions', () => {
    const inst = new Jexl()
    inst.addFunctions({
      idOf: (f: Feature) => f.id(),
      half: (n: number) => n / 2
    })
    expect(inst.eval('idOf(feature)', { feature })).toBe('f1')
    expect(inst.eval('half(9)')).toBe(4.5)
  })
  it('takes a binary operator over numbers', () => {
    // jbrowse registers exactly this, to test BAM/CRAM flag bits
    const inst = new Jexl()
    inst.addBinaryOp('&', 15, (a: number, b: number) => a & b)
    expect(inst.eval('flags & 2', { flags: 6 })).toBe(2)
  })
  it('takes a unary operator over a narrower type', () => {
    const inst = new Jexl()
    inst.addUnaryOp('~', (n: number) => ~n)
    expect(inst.eval('~a', { a: 5 })).toBe(-6)
  })
  it('still types the operands of a manually evaluated operator as thunks', () => {
    const inst = new Jexl()
    let evaluated = 0
    inst.addFunction('bump', () => {
      evaluated++
      return 'right'
    })
    inst.addBinaryOp(
      '??',
      10,
      (left, right) => left.eval() ?? right.eval(),
      true
    )
    expect(inst.eval('a ?? bump()', { a: 'left' })).toBe('left')
    expect(evaluated).toBe(0)
  })
})
