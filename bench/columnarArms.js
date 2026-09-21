/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { Jexl } from '../src/index.ts'

// One channel expression over 100k rows, the way a genome browser's encoder
// fills a lane, through every representation the rows could arrive in:
//
// - proxy: what JBrowse does today — a feature object whose fields sit
//   behind `get(name)`, wrapped per row in a Proxy so `feature.score` reads
//   `get('score')`, inside a fresh context object per row
// - getter: the feature read by `get(feature, name)` from one reused
//   context and no Proxy, standing in for a member-access hook that compiles
//   `feature.score` to `feature.get('score')`
// - object: a plain object per row, the expression reading bare names
// - cursor: one context whose getters read `column[i]` for a moving `i`,
//   which needs no change to jexl
// - columnar: compileColumnar over the columns
// - gather: the features' fields copied into columns by `get`, then
//   columnar — what a feature list pays to reach the columnar path
// - native: the loop written by hand, the floor
const N = 100_000

const jexl = new Jexl()
jexl.addFunction('log10', Math.log10)
jexl.addFunction('get', (feature, name) => feature.get(name))

class Feature {
  constructor(data) {
    this.data = data
  }

  get(name) {
    switch (name) {
      case 'subfeatures': {
        return undefined
      }
      case 'strand': {
        return this.data.strand
      }
      default: {
        return this.data[name]
      }
    }
  }

  id() {
    return this.data.uniqueId
  }
}

const featureTarget = Symbol('featureTarget')

function jexlFeatureProxy(feature) {
  return new Proxy(feature, {
    get(target, prop) {
      switch (prop) {
        case featureTarget: {
          return target
        }
        case 'get': {
          return target.get.bind(target)
        }
        default: {
          return typeof prop === 'string'
            ? target.get(prop)
            : Reflect.get(target, prop)
        }
      }
    }
  })
}

function buildJexlContext(args) {
  const context = {}
  for (const key in args) {
    const value = args[key]
    context[key] =
      typeof value?.get === 'function' ? jexlFeatureProxy(value) : value
  }
  return context
}

const columns = {
  pvalue: Float64Array.from(
    { length: N },
    (_, i) => ((i * 7919) % N) / N + 1e-9
  ),
  score: Float64Array.from({ length: N }, (_, i) => (i * 31) % 20),
  name: Array.from({ length: N }, (_, i) => `f${i}`)
}
const rows = Array.from({ length: N }, (_, i) => ({
  pvalue: columns.pvalue[i],
  score: columns.score[i],
  name: columns.name[i]
}))
const features = rows.map(
  (row, i) => new Feature({ ...row, uniqueId: `u${i}`, start: i, end: i + 1 })
)

const cursorContext = {}
let cursor = 0
for (const name of Object.keys(columns)) {
  const column = columns[name]
  Object.defineProperty(cursorContext, name, { get: () => column[cursor] })
}

const out = new Array(N)

const CASES = [
  {
    label: '-log10(pvalue)',
    bare: '-log10(pvalue)',
    feature: '-log10(feature.pvalue)',
    getter: '-log10(get(feature, "pvalue"))',
    fields: ['pvalue'],
    native: () => {
      const { pvalue } = columns
      for (let i = 0; i < N; i++) {
        out[i] = -Math.log10(pvalue[i])
      }
    }
  },
  {
    label: "score > 10 ? 'red' : 'blue'",
    bare: "score > 10 ? 'red' : 'blue'",
    feature: "feature.score > 10 ? 'red' : 'blue'",
    getter: "get(feature, 'score') > 10 ? 'red' : 'blue'",
    fields: ['score'],
    native: () => {
      const { score } = columns
      for (let i = 0; i < N; i++) {
        out[i] = score[i] > 10 ? 'red' : 'blue'
      }
    }
  },
  {
    label: 'template literal',
    bare: '`${name}:${score}`',
    feature: '`${feature.name}:${feature.score}`',
    getter: '`${get(feature, "name")}:${get(feature, "score")}`',
    fields: ['name', 'score'],
    native: () => {
      const { name, score } = columns
      for (let i = 0; i < N; i++) {
        out[i] = `${name[i]}:${score[i]}`
      }
    }
  }
]

export function columnarCases() {
  return CASES.map((c) => {
    const bare = jexl.compile(c.bare)
    const feature = jexl.compile(c.feature)
    const getter = jexl.compile(c.getter)
    const reused = { feature: undefined }
    const columnar = bare.compileColumnar()

    const arms = {
      proxy: () => {
        for (let i = 0; i < N; i++) {
          out[i] = feature.eval(buildJexlContext({ feature: features[i] }))
        }
      },
      getter: () => {
        for (let i = 0; i < N; i++) {
          reused.feature = features[i]
          out[i] = getter.eval(reused)
        }
      },
      object: () => {
        for (let i = 0; i < N; i++) {
          out[i] = bare.eval(rows[i])
        }
      },
      cursor: () => {
        for (cursor = 0; cursor < N; cursor++) {
          out[cursor] = bare.eval(cursorContext)
        }
      },
      columnar: () => {
        columnar(columns, N, out)
      },
      gather: () => {
        const gathered = {}
        for (const name of c.fields) {
          const column = new Array(N)
          for (let i = 0; i < N; i++) {
            column[i] = features[i].get(name)
          }
          gathered[name] = column
        }
        columnar(gathered, N, out)
      },
      native: c.native
    }
    return { label: c.label, arms }
  })
}

/** Runs every arm once and throws where one answers differently. */
export function checkAgreement({ label, arms }) {
  let reference
  for (const [arm, run] of Object.entries(arms)) {
    out.fill(undefined)
    run()
    const answer = JSON.stringify(out)
    reference ??= answer
    if (answer !== reference) {
      throw new Error(`${label}: the ${arm} arm answers differently`)
    }
  }
}

export { N }
