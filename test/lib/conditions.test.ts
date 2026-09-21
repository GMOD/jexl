/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'
import {
  callSubject,
  conditions,
  fromConditions,
  pathSubject
} from '../../src/conditions.ts'

import type { Condition, ConditionOptions } from '../../src/conditions.ts'

const CALLS = [
  'maf',
  'missingness',
  'genotypeCount',
  'nAlt',
  'alleleLength',
  'svType',
  'impact',
  'consequences'
]
const OPTIONS: ConditionOptions = {
  row: 'feature',
  accessors: { get: [] },
  calls: CALLS
}

const jexl = new Jexl()
for (const name of CALLS) {
  jexl.addFunction(name, (f: Record<string, unknown>, arg?: string) =>
    name === 'genotypeCount'
      ? ((f.gc as Record<string, number> | undefined)?.[arg!] ?? 0)
      : f[name]
  )
}
jexl.addFunction('get', (f: Record<string, unknown>, key: string) => f[key])

const records = [
  {
    QUAL: 50,
    FILTER: 'PASS',
    INFO: {
      DP: 25,
      AF: [0.2, 0.01],
      SVTYPE: 'DEL',
      CSQ: ['A|missense_variant|x'],
      DB: true,
      'AF.EAS': [0.02]
    },
    maf: 0.1,
    nAlt: 2,
    alleleLength: 60,
    svType: 'DEL',
    impact: 'HIGH',
    consequences: ['missense_variant'],
    gc: { het: 3 },
    name: 'BRCA1',
    score: 500
  },
  {
    QUAL: 10,
    FILTER: ['q10'],
    INFO: { DP: 5, SVTYPE: 'DUP', AF: [0.001] },
    maf: 0.01,
    nAlt: 1,
    alleleLength: 1,
    svType: 'DUP',
    impact: 'LOW',
    consequences: [],
    gc: {},
    name: 'X',
    score: 1
  },
  { INFO: {}, nAlt: 1 }
]

const read = (line: string) => conditions(jexl.parse(line), OPTIONS)
const show = (list: Condition[]) =>
  list.map((c) =>
    [
      c.subject.kind === 'path'
        ? c.subject.path.join('.')
        : `${c.subject.name}(${c.subject.args.join(',')})`,
      c.op,
      'value' in c ? JSON.stringify(c.value) : ''
    ]
      .join(' ')
      .trim()
  )

describe('conditions', () => {
  it.each([
    ['feature.QUAL > 30', ['QUAL > 30']],
    ["feature.FILTER == 'PASS'", ['FILTER == "PASS"']],
    ["'PASS' in feature.FILTER", ['FILTER has "PASS"']],
    ['feature.INFO.DP >= 25', ['INFO.DP >= 25']],
    ['30 < feature.QUAL', ['QUAL > 30']],
    ["feature.INFO.SVTYPE != 'DEL'", ['INFO.SVTYPE != "DEL"']],
    ["feature.INFO.SVTYPE in ['DEL', 'DUP']", ['INFO.SVTYPE in ["DEL","DUP"]']],
    ["!(feature.INFO.SVTYPE in ['DEL'])", ['INFO.SVTYPE !in ["DEL"]']],
    [
      "feature.INFO.CSQ ~ 'missense_variant'",
      ['INFO.CSQ ~ "missense_variant"']
    ],
    ["'DB' in feature.INFO", ['INFO has "DB"']],
    ["!('DB' in feature.INFO)", ['INFO !has "DB"']],
    ['feature.INFO.DB', ['INFO.DB set']],
    ['!feature.INFO.DB', ['INFO.DB !set']],
    ["feature.INFO['AF.EAS'] > 0.01", ['INFO.AF.EAS > 0.01']],
    ["get(feature,'score') > 400", ['score > 400']],
    ['maf(feature) > 0.05', ['maf() > 0.05']],
    ["genotypeCount(feature,'het') > 0", ['genotypeCount(het) > 0']],
    [
      "'missense_variant' in consequences(feature)",
      ['consequences() has "missense_variant"']
    ],
    [
      "feature.QUAL > 30 && feature.FILTER == 'PASS' && maf(feature) < 0.01",
      ['QUAL > 30', 'FILTER == "PASS"', 'maf() < 0.01']
    ]
  ])('reads %s', (line, expected) => {
    expect(show(read(line)!)).toEqual(expected)
  })

  it.each([
    'feature.QUAL > 30 || feature.INFO.DP > 20',
    '!(feature.QUAL > 30)',
    'feature.INFO.AC / feature.INFO.AN > 0.1',
    'any(feature.INFO.AF, af => af > 0.05)',
    'feature.INFO[k] > 1',
    'feature.QUAL > feature.INFO.DP',
    'unknownFn(feature) > 1',
    "get(feature,'end') - get(feature,'start') < 1000000",
    ''
  ])('leaves %s as text', (line) => {
    expect(conditions(line ? jexl.parse(line) : null, OPTIONS)).toBeUndefined()
  })

  describe('written back', () => {
    const lines = [
      'feature.QUAL > 30',
      "'PASS' in feature.FILTER",
      '30 < feature.QUAL',
      "feature.INFO.SVTYPE in ['DEL', 'DUP']",
      "!(feature.INFO.SVTYPE in ['DEL'])",
      "feature.INFO.CSQ ~ 'missense_variant'",
      "!('DB' in feature.INFO)",
      '!feature.INFO.DB',
      "feature.INFO['AF.EAS'] > 0.01",
      "get(feature,'score') >= 400",
      "genotypeCount(feature,'het') > 0",
      'feature.INFO.AF >= 0.05 && nAlt(feature) == 1'
    ]
    it.each(lines)('%s reads back as the same conditions', (line) => {
      const text = fromConditions(read(line)!)
      expect(show(read(text)!)).toEqual(show(read(line)!))
      expect(fromConditions(read(text)!)).toBe(text)
    })
    it.each(lines)('%s evaluates the same once written back', (line) => {
      const text = fromConditions(read(line)!)
      for (const feature of records) {
        expect(!!jexl.eval(text, { feature })).toBe(
          !!jexl.eval(line, { feature })
        )
      }
    })
  })

  it('builds subjects a picker chose', () => {
    const rows: Condition[] = [
      { subject: pathSubject('feature', ['INFO', 'DP']), op: '>=', value: 25 },
      {
        subject: pathSubject('feature', ['INFO', 'AF.EAS']),
        op: '>',
        value: 0.01
      },
      { subject: pathSubject('feature', ['INFO', 'in']), op: 'set' },
      {
        subject: callSubject('feature', 'genotypeCount', ['het']),
        op: '>',
        value: 0
      },
      { subject: callSubject('feature', 'maf'), op: '<', value: 0.01 }
    ]
    const text = fromConditions(rows)
    expect(text).toBe(
      "feature.INFO.DP >= 25 && feature.INFO['AF.EAS'] > 0.01 && feature.INFO['in'] && genotypeCount(feature, 'het') > 0 && maf(feature) < 0.01"
    )
    expect(show(read(text)!)).toEqual(show(rows))
  })

  it('writes rows a filter editor built', () => {
    const [dp] = read('feature.INFO.DP > 1')!
    const rows: Condition[] = [
      { ...dp!, op: '>=', value: 25 },
      { subject: dp!.subject, op: 'in', value: [10, 20] }
    ]
    expect(fromConditions(rows)).toBe(
      'feature.INFO.DP >= 25 && feature.INFO.DP in [10, 20]'
    )
  })
})
