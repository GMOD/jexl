/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

// The columnar arms as a table of ns per row, min of ROUNDS interleaved
// rounds, which holds still on a loaded machine where a mean does not:
//
//   node bench/columnarTable.js [rounds]
import { N, checkAgreement, columnarCases } from './columnarArms.js'

const ROUNDS = Number(process.argv[2] ?? 31)
const cases = columnarCases()
for (const c of cases) {
  checkAgreement(c)
}

const best = cases.map((c) =>
  Object.fromEntries(Object.keys(c.arms).map((arm) => [arm, Infinity]))
)
for (let round = 0; round < ROUNDS; round++) {
  for (const [i, c] of cases.entries()) {
    for (const [arm, run] of Object.entries(c.arms)) {
      const t0 = performance.now()
      run()
      const ns = ((performance.now() - t0) * 1e6) / N
      best[i][arm] = Math.min(best[i][arm], ns)
    }
  }
}

for (const [i, c] of cases.entries()) {
  const b = best[i]
  console.log(`\n${c.label}, ${N} rows, min of ${ROUNDS}`)
  console.log('arm        ns/row  vs proxy  vs columnar')
  for (const [arm, ns] of Object.entries(b)) {
    console.log(
      `${arm.padEnd(9)} ${ns.toFixed(1).padStart(7)} ${(ns / b.proxy).toFixed(2).padStart(8)}x ${(ns / b.columnar).toFixed(2).padStart(10)}x`
    )
  }
}
