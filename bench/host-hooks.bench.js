/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { bench, describe } from 'vitest'

import { Jexl } from '../src/index.ts'
import { compileAst } from '../src/evaluator/compile.ts'

// JBrowse evaluates one compiled expression per feature. Today it wraps each
// feature in a Proxy that forwards `feature.x` to `feature.get('x')` and builds
// a context around it; `getMember` resolves the member instead, which lets one
// context serve a whole region. The last two groups price where assignments
// go once that context is reused.

// jbrowse's SimpleFeature, as far as an expression can see it
class Feature {
  #data
  #parent
  #uniqueId

  constructor(uniqueId, data, parent) {
    this.#uniqueId = uniqueId
    this.#data = data
    this.#parent = parent
  }

  get(name) {
    switch (name) {
      case 'parent': {
        return this.#parent
      }
      case 'strand': {
        return this.#data.strand ?? this.#parent?.get('strand')
      }
      default: {
        return this.#data[name]
      }
    }
  }

  id() {
    return this.#uniqueId
  }

  parent() {
    return this.#parent
  }

  toJSON() {
    return { ...this.#data, uniqueId: this.#uniqueId }
  }
}

const featureTarget = Symbol('featureTarget')

function isFeature(thing) {
  return (
    typeof thing === 'object' &&
    thing !== null &&
    typeof thing.get === 'function' &&
    (typeof thing.id === 'function' || featureTarget in thing)
  )
}

// jbrowse's jexlFeatureProxy and buildJexlContext, verbatim in behaviour
function jexlFeatureProxy(feature) {
  return feature[featureTarget]
    ? feature
    : new Proxy(feature, {
        has(target, prop) {
          return prop === featureTarget || Reflect.has(target, prop)
        },
        get(target, prop) {
          switch (prop) {
            case featureTarget: {
              return target
            }
            case 'get': {
              return target.get.bind(target)
            }
            case 'toJSON': {
              return target.toJSON.bind(target)
            }
            case 'uniqueId': {
              return target.id()
            }
            case 'parent': {
              const p = target.parent?.()
              return p ? jexlFeatureProxy(p) : undefined
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
    context[key] = isFeature(value) ? jexlFeatureProxy(value) : value
  }
  return context
}

function getMember(subject, key) {
  if (!isFeature(subject)) {
    return subject[key]
  }
  switch (key) {
    case 'uniqueId': {
      return subject.id()
    }
    case 'parent': {
      return subject.parent()
    }
    default: {
      return subject.get(key)
    }
  }
}

// the most a key fixed at compile time could save: no switch on it at all
function getMemberUnswitched(subject, key) {
  return isFeature(subject) ? subject.get(key) : subject[key]
}

const contextNames = new Set(['feature', 'track', 'parent', 'depth'])

function maskReader(name) {
  return contextNames.has(name)
    ? undefined
    : (context) => {
        const value = context.feature.get(name)
        return value === undefined ? context[name] : value
      }
}

// the same mask, deciding per evaluation what the reader above decides once
function runtimeMaskReader(name) {
  return (context) => {
    if (contextNames.has(name)) {
      return context[name]
    }
    const value = context.feature.get(name)
    return value === undefined ? context[name] : value
  }
}

const CLNSIG = ['Benign', 'Pathogenic', 'Uncertain_significance', 'Other']
const gene = new Feature('gene', { type: 'gene', strand: 1 })
const features = Array.from(
  { length: 10_000 },
  (_, i) =>
    new Feature(
      `f${i}`,
      {
        refName: 'chr1',
        start: i * 100,
        end: i * 100 + 50,
        name: `rs${i}`,
        type: 'SNV',
        score: i % 20,
        INFO: { DP: i % 40, CLNSIG: [CLNSIG[i % 4]] }
      },
      gene
    )
)

const plain = new Jexl()
const hooked = new Jexl({ getMember })
const unswitched = new Jexl({ getMember: getMemberUnswitched })
const masked = new Jexl({ getMember, variableReader: maskReader })
const runtimeMasked = new Jexl({
  getMember,
  variableReader: runtimeMaskReader
})
for (const inst of [plain, hooked, unswitched, masked, runtimeMasked]) {
  inst.addFunction('get', (feature, key) => feature.get(key))
}

// Every arm runs through this one loop, so none has a call site of its own for
// V8 to inline a whole expression into; a host evaluating many expressions
// never gets that either.
function arm(compiled, contextFor) {
  return () => {
    for (const feature of features) {
      compiled.eval(contextFor(feature))
    }
  }
}

const proxyContext = (feature) => buildJexlContext({ feature })
const freshContext = (feature) => ({ feature })
function reusedContext() {
  const context = { feature: undefined }
  return (feature) => {
    context.feature = feature
    return context
  }
}

const today = (expr) => arm(plain.compile(expr), proxyContext)
const reused = (inst, expr) => arm(inst.compile(expr), reusedContext())

// the expression lowered with no scope, so an assignment writes into whatever
// context it is handed, as in 4.0
function unscoped(inst, expr, wrap) {
  const compiled = inst.compile(expr)
  compiled._fn = wrap(compileAst(compiled._ast, compiled._grammar))
  return compiled
}
const intoContext = (fn) => fn
const prototypeLayer = (fn) => (ctx) => fn(Object.create(ctx))

const native = {
  eval: ({ feature }) => (feature.get('score') > 10 ? 'red' : 'blue')
}

const COLOUR = "feature.score > 10 ? 'red' : 'blue'"
const TEMPLATE = '`${feature.name}:${feature.start}-${feature.end}`'
const LOOKUP =
  "s = feature.INFO.CLNSIG; ({Benign: 'blue', Pathogenic: 'red'})[s] || 'purple'"

const suites = {
  [COLOUR]: {
    'today: proxy + context per feature': today(COLOUR),
    'hook, context per feature': arm(hooked.compile(COLOUR), freshContext),
    'hook, one reused context': reused(hooked, COLOUR),
    'hook without a key switch, reused context': reused(unswitched, COLOUR),
    'native get(), reused context': arm(native, reusedContext())
  },
  "get(feature,'score') * 2": {
    'today: proxy + context per feature': today("get(feature,'score') * 2"),
    'hook, one reused context': reused(hooked, "get(feature,'score') * 2")
  },
  'feature.INFO.DP > 20': {
    'today: proxy + context per feature': today('feature.INFO.DP > 20'),
    'hook, one reused context': reused(hooked, 'feature.INFO.DP > 20')
  },
  [TEMPLATE]: {
    'today: proxy + context per feature': today(TEMPLATE),
    'hook, one reused context': reused(hooked, TEMPLATE)
  },
  'feature.parent.type': {
    'today: proxy + context per feature': today('feature.parent.type'),
    'hook, one reused context': reused(hooked, 'feature.parent.type')
  },
  "mask: score > 10 ? 'red' : 'blue'": {
    'feature.score through the hook': reused(hooked, COLOUR),
    'bare score, reader chosen at compile time': reused(
      masked,
      "score > 10 ? 'red' : 'blue'"
    ),
    'bare score, reader deciding per evaluation': reused(
      runtimeMasked,
      "score > 10 ? 'red' : 'blue'"
    )
  },
  [LOOKUP]: {
    'today, writing into the context': arm(
      unscoped(plain, LOOKUP, intoContext),
      proxyContext
    ),
    'today, slots': today(LOOKUP),
    'today, prototype layer': arm(
      unscoped(plain, LOOKUP, prototypeLayer),
      proxyContext
    ),
    'hook + reused context, writing into it': arm(
      unscoped(hooked, LOOKUP, intoContext),
      reusedContext()
    ),
    'hook + reused context, slots': reused(hooked, LOOKUP),
    'hook + reused context, prototype layer': arm(
      unscoped(hooked, LOOKUP, prototypeLayer),
      reusedContext()
    )
  },
  [`${COLOUR}, which assigns nothing`]: {
    'reused context, no scope': reused(hooked, COLOUR),
    'reused context, prototype layer anyway': arm(
      unscoped(hooked, COLOUR, prototypeLayer),
      reusedContext()
    ),
    'context per feature, no scope': arm(hooked.compile(COLOUR), freshContext),
    'context per feature, prototype layer anyway': arm(
      unscoped(hooked, COLOUR, prototypeLayer),
      freshContext
    )
  }
}

// every arm runs before any is timed, so each is measured against the same
// shared compiler closures a host running many expressions would have
for (let round = 0; round < 20; round++) {
  for (const arms of Object.values(suites)) {
    for (const run of Object.values(arms)) {
      run()
    }
  }
}

for (const [title, arms] of Object.entries(suites)) {
  describe(`${title}, 10k features`, () => {
    for (const [name, run] of Object.entries(arms)) {
      bench(name, run)
    }
  })
}
