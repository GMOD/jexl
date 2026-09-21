/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'
import { check, print, recordOf } from '../../src/check.ts'
import {
  BAM_SCHEMA,
  BED_SCHEMA,
  GFF3_SCHEMA,
  JBROWSE_ACCESSORS,
  JBROWSE_FUNCTIONS,
  VCF_METADATA,
  vcfFieldSchema
} from '../fixtures/jbrowse.ts'

import type {
  CheckOptions,
  Diagnostic,
  FieldSchema,
  Type
} from '../../src/check.ts'
import type { AstNode, FunctionCall } from '../../src/types.ts'

const jexl = new Jexl()

const parse = (expr: string) => jexl.compile(expr)._ast!

const JBROWSE = {
  functions: JBROWSE_FUNCTIONS,
  accessors: JBROWSE_ACCESSORS,
  row: 'feature'
}
const V5: CheckOptions = { ...JBROWSE, schema: vcfFieldSchema(VCF_METADATA) }
const V4: CheckOptions = {
  ...JBROWSE,
  schema: vcfFieldSchema(VCF_METADATA, 'v4')
}

function showType(type: Type): string {
  switch (type.kind) {
    case 'number': {
      return type.values
        ? `number{${type.values.join(',')}}`
        : type.domain
          ? `number[${type.domain.join(',')}]`
          : 'number'
    }
    case 'string': {
      return type.values ? `string{${type.values.join(',')}}` : 'string'
    }
    case 'list': {
      return `list<${showType(type.of)}>/${type.cardinality}`
    }
    case 'union': {
      return type.of.map(showType).join('|')
    }
    case 'lambda': {
      return `=> ${showType(type.returns)}`
    }
    default: {
      return type.kind
    }
  }
}

const showDiagnostic = ({ code, node, suggestions }: Diagnostic) =>
  `${code} @ ${print(node)}` +
  (suggestions ? ` → ${suggestions.join(' | ')}` : '')

function summary(ast: string | AstNode, options: CheckOptions) {
  const { diagnostics, type } = check(
    typeof ast === 'string' ? parse(ast) : ast,
    options
  )
  return { type: showType(type), diagnostics: diagnostics.map(showDiagnostic) }
}

function messages(ast: string | AstNode, options: CheckOptions) {
  return check(
    typeof ast === 'string' ? parse(ast) : ast,
    options
  ).diagnostics.map(({ severity, message }) => `${severity}: ${message}`)
}

/**
 * `name(list, param => body)`, built by hand: the parser here has no lambdas
 * yet, and this is the node a Pratt parser with them would produce.
 */
function lambdaCall(
  name: string,
  list: string,
  param: string,
  body: string
): AstNode {
  const lambda = { type: 'Lambda', params: [param], body: parse(body) }
  const node: FunctionCall = {
    type: 'FunctionCall',
    name,
    args: [parse(list), lambda]
  }
  return node
}

describe('check', () => {
  describe('jbrowse expressions against a VCF header, v5 data model', () => {
    it.each([
      ['filter dialog: INFO by name', 'feature.INFO.DP > 20', 'boolean', []],
      ['arithmetic on a Number=1 field', 'feature.INFO.DP + 1', 'number', []],
      [
        'filter dialog hint: second ALT of a Number=A field',
        'feature.INFO.AF[1] > 0.5',
        'boolean',
        ['index-range @ feature.INFO.AF[1] → feature.INFO.AF[0]']
      ],
      [
        'consequence test that never matches',
        "includes(feature.INFO.CSQ,'missense_variant')",
        'boolean',
        [
          "never-equal @ includes(feature.INFO.CSQ, 'missense_variant') → any(feature.INFO.CSQ, csq => 'missense_variant' in csq.Consequence)"
        ]
      ],
      [
        'cookbook SV colour, indexing a scalar',
        "{DEL:'red',INS:'blue',DUP:'green',INV:'orange'}[feature.INFO.SVTYPE[0]] || 'gray'",
        'string{red,blue,green,orange,gray}',
        ['index-scalar @ feature.INFO.SVTYPE[0] → feature.INFO.SVTYPE']
      ],
      [
        'pangenome SV filter, indexing a scalar',
        'feature.INFO.LV[0]==0 && alleleLength(feature)>=50',
        'boolean',
        ['index-scalar @ feature.INFO.LV[0] → feature.INFO.LV']
      ],
      [
        'ALT count, now that length counts the list',
        'feature.ALT.length > 1',
        'boolean',
        []
      ],
      [
        'a scalar operator on a Number=A field',
        'feature.INFO.AF > 0.1',
        'boolean',
        [
          'list-operand @ feature.INFO.AF > 0.1 → any(feature.INFO.AF, af => af > 0.1)'
        ]
      ],
      [
        'ClinVar significance, which is Number=.',
        "feature.INFO.CLNSIG == 'Pathogenic' ? 'red' : 'blue'",
        'string{red,blue}',
        [
          "list-operand @ feature.INFO.CLNSIG == 'Pathogenic' → 'Pathogenic' in feature.INFO.CLNSIG | any(feature.INFO.CLNSIG, clnsig => clnsig == 'Pathogenic')"
        ]
      ],
      [
        'ClinVar colour through a local',
        "s = feature.INFO.CLNSIG; ({'Benign':'blue','Pathogenic':'red'})[s] || 'purple'",
        'string{blue,red,purple}',
        ["list-operand @ {Benign: 'blue', Pathogenic: 'red'}[s]"]
      ],
      [
        'misspelt field',
        'feature.INFO.DPP > 20',
        'boolean',
        ['unknown-field @ feature.INFO.DPP → feature.INFO.DP']
      ],
      [
        'a dotted INFO key',
        'feature.INFO.AF.EAS[0] > 0.01',
        'boolean',
        ["dotted-key @ feature.INFO.AF.EAS → feature.INFO['AF.EAS']"]
      ],
      [
        'a flag compared with text',
        "feature.INFO.DB == 'true'",
        'boolean',
        ["never-equal @ feature.INFO.DB == 'true' → true"]
      ],
      [
        'an SV type the header does not declare',
        "feature.INFO.SVTYPE == 'DUPL'",
        'boolean',
        ["unknown-category @ feature.INFO.SVTYPE == 'DUPL' → 'DUP'"]
      ],
      ['FILTER preset', "'PASS' in feature.FILTER", 'boolean', []],
      [
        'a FILTER the header does not declare',
        "'LowQaul' in feature.FILTER",
        'boolean',
        ["unknown-category @ 'LowQaul' in feature.FILTER → 'LowQual'"]
      ],
      [
        'the first transcript only',
        "feature.INFO.CSQ.IMPACT == 'HIGH'",
        'boolean',
        ['dot-through-list @ feature.INFO.CSQ.IMPACT']
      ],
      [
        'chord colour through get',
        "get(feature,'INFO').SVTYPE=='BND'?'#d95f02':'rgba(255,133,0,0.32)'",
        'string{#d95f02,rgba(255,133,0,0.32)}',
        []
      ],
      [
        'a misspelt key through get',
        "get(feature,'INFO').SVTPYE",
        'unknown',
        [
          "unknown-field @ get(feature, 'INFO').SVTPYE → get(feature, 'INFO').SVTYPE"
        ]
      ],
      [
        'a misspelt key inside get',
        "get(feature,'QAUL')",
        'unknown',
        ["unknown-field @ 'QAUL' → 'QUAL'"]
      ],
      [
        'the method spelling of get',
        "feature.get('INFO').SVTYPE == 'BND'",
        'boolean',
        []
      ],
      [
        'a per-sample FORMAT field',
        "feature.samples.NA12878.GT == '0|1'",
        'boolean',
        []
      ],
      [
        'a Number=R FORMAT field used whole',
        'feature.samples.NA12878.AD > 10',
        'boolean',
        [
          'list-operand @ feature.samples.NA12878.AD > 10 → any(feature.samples.NA12878.AD, ad => ad > 10)'
        ]
      ],
      [
        'the first ALT of a Number=R field',
        'feature.samples.NA12878.AD[1] > 10',
        'boolean',
        []
      ],
      [
        'consequences preset',
        "'missense_variant' in consequences(feature)",
        'boolean',
        []
      ],
      [
        'allele frequency colour',
        "maf(feature)<0.01?'#ccc':maf(feature)<0.05?'#74a9cf':'#045a8d'",
        'string{#ccc,#74a9cf,#045a8d}',
        []
      ],
      [
        'wrong arity',
        'nAlt(feature, 2)',
        'number',
        ['arity @ nAlt(feature, 2)']
      ],
      [
        'misspelt function',
        'consequnces(feature)',
        'unknown',
        [
          'unknown-function @ consequnces(feature) → consequences(feature) | consequence(feature)'
        ]
      ],
      [
        'text where a number belongs',
        'log10(feature.INFO.CLNSIG)',
        'number',
        ['list-operand @ feature.INFO.CLNSIG']
      ]
    ])('%s: %s', (_, expr, type, diagnostics) => {
      expect(summary(expr, V5)).toEqual({ type, diagnostics })
    })

    it('explains itself', () => {
      expect(messages('feature.INFO.AF[1] > 0.5', V5)).toEqual([
        'warning: feature.INFO.AF holds one value per ALT allele, so [1] is undefined on every biallelic record'
      ])
      expect(
        messages("includes(feature.INFO.CSQ,'missense_variant')", V5)
      ).toEqual([
        "warning: feature.INFO.CSQ holds records, so no entry equals 'missense_variant'; it is a value of their Consequence field"
      ])
      expect(messages('feature.INFO.SVTYPE[0]', V5)).toEqual([
        'warning: feature.INFO.SVTYPE holds one string, so [0] reads a single character'
      ])
      expect(messages('feature.INFO.LV[0]', V5)).toEqual([
        'warning: feature.INFO.LV holds one value, so [0] reads nothing'
      ])
      expect(messages('feature.INFO.AF > 0.1', V5)).toEqual([
        'warning: feature.INFO.AF holds one value per ALT allele, so > compares the whole list and only answers correctly when there is exactly one'
      ])
      expect(messages('feature.INFO.DPP', V5)).toEqual([
        'warning: feature.INFO has no field DPP; did you mean DP?'
      ])
      expect(messages('feature.INFO.AF.EAS', V5)).toEqual([
        'warning: AF.EAS is one field of feature.INFO; jexl reads AF then EAS'
      ])
      expect(messages("feature.INFO.DB == 'true'", V5)).toEqual([
        "warning: a flag never equals the text 'true'"
      ])
      expect(messages('nAlt(feature, 2)', V5)).toEqual([
        'error: nAlt takes 1 argument, not 2'
      ])
      expect(messages('consequnces(feature)', V5)).toEqual([
        'error: no function consequnces; did you mean consequences, consequence?'
      ])
    })
  })

  describe('lambdas over CSQ records', () => {
    it('binds the parameter to one record', () => {
      expect(
        summary(
          lambdaCall(
            'any',
            'feature.INFO.CSQ',
            'c',
            "'missense_variant' in c.Consequence && c.IMPACT == 'HIGH'"
          ),
          V5
        )
      ).toEqual({ type: 'boolean', diagnostics: [] })
    })

    it('knows Consequence holds several terms joined by &', () => {
      expect(
        summary(
          lambdaCall(
            'any',
            'feature.INFO.CSQ',
            'c',
            "c.Consequence == 'missense_variant'"
          ),
          V5
        ).diagnostics
      ).toEqual([
        "list-operand @ c.Consequence == 'missense_variant' → 'missense_variant' in c.Consequence | any(c.Consequence, consequence => consequence == 'missense_variant')"
      ])
    })

    it('checks a subfield against its categories and its name', () => {
      expect(
        summary(
          lambdaCall(
            'any',
            'feature.INFO.CSQ',
            'c',
            "c.IMPACT == 'HIGHT' || c.Symbol == 'BRCA1'"
          ),
          V5
        ).diagnostics
      ).toEqual([
        "unknown-category @ c.IMPACT == 'HIGHT' → 'HIGH'",
        'unknown-field @ c.Symbol → c.SYMBOL'
      ])
    })

    it("reads ANN's subfields off its quoted list, whatever Number says", () => {
      expect(
        summary(
          lambdaCall(
            'any',
            'feature.INFO.ANN',
            'a',
            "a['HGVS.p'] != '' && a.Annotation_Impact == 'HIGH'"
          ),
          V5
        )
      ).toEqual({ type: 'boolean', diagnostics: [] })
    })

    it('rewrites a list operand as any', () => {
      expect(
        summary(lambdaCall('any', 'feature.INFO.AF', 'af', 'af > 0.05'), V5)
      ).toEqual({ type: 'boolean', diagnostics: [] })
    })

    it('wants a function where the signature says lambda', () => {
      expect(summary('any(feature.INFO.AF, 0.05)', V5).diagnostics).toEqual([
        'argument-type @ 0.05'
      ])
    })
  })

  describe('migrating from the v4 data model', () => {
    it.each([
      [
        'feature.INFO.DP + 1',
        'string',
        ['list-operand @ feature.INFO.DP + 1 → feature.INFO.DP[0] + 1']
      ],
      ['feature.INFO.DP > 20', 'boolean', []],
      ['feature.INFO.SVTYPE[0]', 'string{DEL,INS,DUP,INV,CNV,BND}', []],
      ['feature.INFO.LV[0] == 0', 'boolean', []]
    ])('v4 %s', (expr, type, diagnostics) => {
      expect(summary(expr, V4)).toEqual({ type, diagnostics })
    })

    it('flags every [0] that v5 makes wrong', () => {
      const corpus = [
        "{DEL:'red',INS:'blue'}[feature.INFO.SVTYPE[0]] || 'gray'",
        '(feature.INFO.LV[0]==0 || feature.start==32517421) && alleleLength(feature)>=50',
        "({'Benign':'blue'})[feature.INFO.CLNSIG[0]] || 'purple'",
        'feature.INFO.AF[0]>0.05'
      ]
      expect(
        corpus.map((expr) =>
          check(parse(expr), V5)
            .diagnostics.filter(({ code }) => code === 'index-scalar')
            .map(({ suggestions }) => suggestions?.[0])
        )
      ).toEqual([['feature.INFO.SVTYPE'], ['feature.INFO.LV'], [], []])
    })
  })

  describe('other adapters', () => {
    const gff = { ...JBROWSE, schema: GFF3_SCHEMA }
    const bed = { ...JBROWSE, schema: BED_SCHEMA }
    const bam = { ...JBROWSE, schema: BAM_SCHEMA }

    it.each([
      [
        'a hyphenated GFF3 attribute',
        "feature.collection-date == '2020'",
        gff,
        'boolean',
        [
          "unknown-field @ feature.collection - date → feature['collection-date']"
        ]
      ],
      [
        'an observed attribute compared numerically',
        'feature.dif > 0.6',
        gff,
        'boolean',
        ['string-numeric @ feature.dif > 0.6 → parseFloat(feature.dif) > 0.6']
      ],
      [
        'DTU tutorial spelling',
        'parseFloat(feature.dif) > 0.6',
        gff,
        'boolean',
        []
      ],
      [
        'an attribute nobody has seen, on an open record',
        "feature.Note == 'x'",
        gff,
        'boolean',
        []
      ],
      [
        'a BED header column with a space',
        "feature.Study == 'GCST1'",
        bed,
        'boolean',
        ["unknown-field @ feature.Study → feature['Study ID']"]
      ],
      [
        'mark display y',
        '-log10(feature.pvalue)',
        bed,
        'number[0,Infinity]',
        []
      ],
      [
        'a score in autoSql bounds',
        'feature.score*3',
        bed,
        'number[0,3000]',
        []
      ],
      [
        'mark formula reading a BAM tag',
        "getTag(feature,'HP')",
        bam,
        'number',
        []
      ],
      [
        'a read group the header does not declare',
        "getTag(feature,'RG') == 'rg3'",
        bam,
        'boolean',
        ["unknown-category @ getTag(feature, 'RG') == 'rg3' → 'rg1' | 'rg2'"]
      ],
      [
        'cookbook colour by strand',
        "feature.strand==1?'tomato':feature.strand==-1?'cornflowerblue':'goldenrod'",
        bam,
        'string{tomato,cornflowerblue,goldenrod}',
        []
      ]
    ])('%s: %s', (_, expr, options, type, diagnostics) => {
      expect(summary(expr, options)).toEqual({ type, diagnostics })
    })

    it('reads bare names as fields when the host binds the row itself', () => {
      expect(
        summary('-log10(pvalue)', {
          functions: JBROWSE_FUNCTIONS,
          schema: BED_SCHEMA
        })
      ).toEqual({ type: 'number[0,Infinity]', diagnostics: [] })
      expect(
        summary('-log10(pvalu)', {
          functions: JBROWSE_FUNCTIONS,
          schema: BED_SCHEMA
        }).diagnostics
      ).toEqual(['unknown-field @ pvalu → pvalue'])
    })
  })

  describe('the host context', () => {
    it('reports a variable the slot does not bind', () => {
      expect(
        summary('trak.assemblyNames[0]', {
          ...JBROWSE,
          env: { track: { kind: 'unknown' } }
        }).diagnostics
      ).toEqual(['unknown-variable @ trak → track'])
    })

    it('treats undefined as a name every context has', () => {
      expect(
        summary('{name: feature.name, type: undefined}', {
          ...V5,
          env: {}
        }).diagnostics
      ).toEqual([])
    })

    it('says nothing of functions or fields it was not told about', () => {
      expect(check(parse('whatever(feature.x.y) > 1')).diagnostics).toEqual([])
    })

    it('counts optional and variadic params', () => {
      expect(summary('startsWith(feature.name, "a")', V5).diagnostics).toEqual(
        []
      )
      expect(summary('startsWith(feature.name)', V5).diagnostics).toEqual([
        'arity @ startsWith(feature.name)'
      ])
      expect(summary('max(1, 2, 3, feature.QUAL)', V5).diagnostics).toEqual([])
    })
  })

  describe('the inferred type', () => {
    it('carries the field it read, for axis and legend titles', () => {
      const { type } = check(parse('feature.INFO.DP'), V5)
      expect(type.kind === 'number' && type.field?.description).toBe(
        'Approximate read depth; some reads may have been filtered'
      )
    })

    it('carries header categories as the values a legend lists', () => {
      expect(summary('feature.INFO.SVTYPE', V5).type).toBe(
        'string{DEL,INS,DUP,INV,CNV,BND}'
      )
      expect(summary("feature.INFO.DB ? 'dbSNP' : 'novel'", V5).type).toBe(
        'string{dbSNP,novel}'
      )
    })

    it('unions what each branch answers', () => {
      expect(
        summary("feature.INFO.DP > 20 ? feature.INFO.MQ : 'low'", V5).type
      ).toBe('number|string{low}')
    })

    it('answers every value a template can render', () => {
      expect(
        summary(
          "`${feature.INFO.DB ? 'known' : 'novel'}-${feature.INFO.SVTYPE}`",
          V5
        ).type
      ).toBe(
        'string{known-DEL,known-INS,known-DUP,known-INV,known-CNV,known-BND,novel-DEL,novel-INS,novel-DUP,novel-INV,novel-CNV,novel-BND}'
      )
    })
  })

  describe('recordOf', () => {
    it('nests fields under records, lists of records and maps', () => {
      const schema: FieldSchema[] = [
        { path: ['CSQ'], type: 'record', cardinality: 'many' },
        { path: ['CSQ', 'IMPACT'], type: 'string' },
        { path: ['samples', '*', 'GT'], type: 'string' }
      ]
      const root = recordOf(schema)
      expect(root.kind === 'record' && [...root.fields.keys()]).toEqual([
        'CSQ',
        'samples'
      ])
      const csq = root.kind === 'record' ? root.fields.get('CSQ') : undefined
      expect(csq && showType(csq)).toBe('list<record>/many')
      expect(summary('x.samples.anyone.GT', { schema, row: 'x' })).toEqual({
        type: 'string',
        diagnostics: []
      })
    })
  })

  describe('print', () => {
    it.each([
      "{DEL:'red',INS:'blue'}[feature.INFO.SVTYPE[0]] || 'gray'",
      "feature.strand==1?'tomato':feature.strand==-1?'cornflowerblue':'goldenrod'",
      '(feature.INFO.LV[0]==0 || feature.start==32517421) && alleleLength(feature)>=50',
      "s = feature.INFO.CLNSIG; ({'Benign':'blue'})[s] || 'purple'",
      '`hsl(${feature.score*3},50%,50%)`',
      "feature['collection-date'] + (1 - 2) * 3",
      '-log10(feature.pvalue) ^ 2',
      "a ?: 'b'"
    ])('%s parses back to the same tree', (expr) => {
      const strip = (ast: AstNode) =>
        JSON.stringify(ast, (name, value: unknown) =>
          name === '_parent' ? undefined : value
        )
      expect(strip(parse(print(parse(expr))))).toBe(strip(parse(expr)))
    })
  })
})
