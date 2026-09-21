/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { bench, describe } from 'vitest'

import { Jexl } from '../src/index.ts'
import Parser from '../src/parser/Parser.ts'

// config callbacks as jbrowse writes them, compiled from scratch each time
const EXPRESSIONS = [
  "get(feature,'score') > 10 ? 'red' : 'blue'",
  "{CDS:'#d62728',exon:'#2ca02c',gene:'#1f77b4'}[feature.type] || 'gray'",
  '`${feature.name} (${feature.start}-${feature.end})`',
  "max(min(get(feature,'score'), 100), floor(get(feature,'end') / 1000))",
  "s = get(feature,'INFO').CLNSIG; ({'Benign':'blue','Pathogenic':'red'})[s] || 'purple'",
  "feature.type == 'gene' && (feature.strand == -1 || feature.score >= 5.5)",
  "refName.split(' ')[0] + ':' + (feature.start + 1)"
]

const inst = new Jexl()
const tokenized = EXPRESSIONS.map((expression) =>
  inst._lexer.tokenize(expression)
)

describe('parse and compile', () => {
  bench('realistic mix: lex, parse, compile', () => {
    for (const expression of EXPRESSIONS) {
      inst.compile(expression)
    }
  })
  bench('realistic mix: parse only', () => {
    for (const tokens of tokenized) {
      const parser = new Parser(inst._grammar, inst._lexer)
      parser.addTokens(tokens)
      parser.complete()
    }
  })
})
