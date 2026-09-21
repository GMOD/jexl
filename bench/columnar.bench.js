/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { bench, describe } from 'vitest'

import { N, checkAgreement, columnarCases } from './columnarArms.js'

for (const c of columnarCases()) {
  checkAgreement(c)
  describe(`${c.label} over ${N} rows`, () => {
    for (const [arm, run] of Object.entries(c.arms)) {
      bench(arm, run)
    }
  })
}
