/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'

let inst

const site = (INFO, rest = {}) => ({ feature: { INFO, ...rest } })

describe('list operands', () => {
  beforeEach(() => {
    inst = new Jexl()
  })

  describe('comparisons hold when they hold for any value', () => {
    it('compares each value of a multi-valued field', () => {
      expect(
        inst.eval('feature.INFO.AF > 0.05', site({ AF: [0.01, 0.2] }))
      ).toBe(true)
      expect(
        inst.eval('feature.INFO.AF > 0.05', site({ AF: [0.01, 0.02] }))
      ).toBe(false)
      expect(
        inst.eval(
          "feature.INFO.CLNSIG == 'Pathogenic'",
          site({ CLNSIG: ['Benign', 'Pathogenic'] })
        )
      ).toBe(true)
    })
    it('reads a list of one as its value, as single-valued fields are', () => {
      expect(inst.eval('feature.INFO.DP > 20', site({ DP: [25] }))).toBe(true)
      expect(
        inst.eval("feature.INFO.SVTYPE == 'DEL'", site({ SVTYPE: ['DEL'] }))
      ).toBe(true)
    })
    it('is false for an empty list', () => {
      expect(inst.eval('xs == 1', { xs: [] })).toBe(false)
      expect(inst.eval('xs < 1', { xs: [] })).toBe(false)
    })
    it('pairs any value of one list with any of another', () => {
      expect(inst.eval('[1, 2] == [2, 3]')).toBe(true)
      expect(inst.eval('[1, 2] == [3, 4]')).toBe(false)
    })
    it('leaves a comparison of two single values as it was', () => {
      expect(inst.eval('1 == "1"')).toBe(true)
      expect(inst.eval('2 > 1')).toBe(true)
      expect(inst.eval('null == undefined')).toBe(true)
    })
  })

  describe('!= and !~ hold when no value matches', () => {
    it('reads FILTER != "PASS" as "did not pass"', () => {
      const expr = inst.compile("feature.FILTER != 'PASS'")
      expect(expr.eval(site({}, { FILTER: ['PASS'] }))).toBe(false)
      expect(expr.eval(site({}, { FILTER: ['q10', 's50'] }))).toBe(true)
      expect(expr.eval(site({}, { FILTER: ['PASS', 'q10'] }))).toBe(false)
    })
    it('is the negation of == for every operand', () => {
      for (const xs of [[], [1], [1, 2], [2, 3], 1, 2, null]) {
        expect(inst.eval('xs != 1', { xs })).toBe(!inst.eval('xs == 1', { xs }))
      }
    })
  })

  describe('in', () => {
    it('finds any value of a list on its left', () => {
      expect(
        inst.eval(
          "feature.INFO.SVTYPE in ['DEL', 'INS']",
          site({ SVTYPE: ['DEL'] })
        )
      ).toBe(true)
      expect(inst.eval("['DUP'] in ['DEL', 'INS']")).toBe(false)
    })
    it('looks up a key of an object', () => {
      expect(inst.eval("'DP' in feature.INFO", site({ DP: [25] }))).toBe(true)
      expect(inst.eval("'AF' in feature.INFO", site({ DP: [25] }))).toBe(false)
      expect(inst.eval("'toString' in feature.INFO", site({}))).toBe(false)
    })
    it('looks up a member of a Set or a key of a Map', () => {
      // bcftools reads a list of IDs from a file with ID=@file; a host hands
      // jexl the loaded list as a Set
      const genes = new Set(['BRCA1', 'TP53'])
      expect(inst.eval('name in genes', { name: 'TP53', genes })).toBe(true)
      expect(inst.eval('name in genes', { name: 'EGFR', genes })).toBe(false)
      const lengths = new Map([['chr1', 248956422]])
      expect(inst.eval("'chr1' in lengths", { lengths })).toBe(true)
    })
    it('still finds a substring and a list member', () => {
      expect(inst.eval('"a" in "abc"')).toBe(true)
      expect(inst.eval('missing in "abc"')).toBe(false)
      expect(inst.eval('1 in [1, 2]')).toBe(true)
    })
  })

  describe('~ and !~ match a regular expression', () => {
    const csq = [
      'T|missense_variant|MODERATE|BRCA1',
      'T|synonymous_variant|LOW|BRCA1'
    ]
    it('matches any value of a list', () => {
      expect(
        inst.eval("feature.INFO.CSQ ~ 'missense_variant'", site({ CSQ: csq }))
      ).toBe(true)
      expect(
        inst.eval("feature.INFO.CSQ ~ 'stop_gained'", site({ CSQ: csq }))
      ).toBe(false)
      expect(
        inst.eval(
          "feature.INFO.CSQ ~ 'missense_variant.*MODERATE'",
          site({ CSQ: csq })
        )
      ).toBe(true)
    })
    it('negates to "no value matches"', () => {
      expect(
        inst.eval("feature.INFO.CSQ !~ 'stop_gained'", site({ CSQ: csq }))
      ).toBe(true)
      expect(
        inst.eval("feature.INFO.CSQ !~ 'missense'", site({ CSQ: csq }))
      ).toBe(false)
    })
    it('ignores case after a leading (?i)', () => {
      expect(inst.eval("'NEEDless' ~ '(?i)^needless$'")).toBe(true)
      expect(inst.eval("'NEEDless' ~ '^needless$'")).toBe(false)
    })
    it('matches the text of a number, and nothing that has none', () => {
      expect(inst.eval("pos ~ '^12'", { pos: 12345 })).toBe(true)
      expect(inst.eval("missing ~ '.*'")).toBe(false)
      expect(inst.eval('chrom ~ pattern', { chrom: 'chr1', pattern: 1 })).toBe(
        false
      )
    })
    it('binds like a comparison', () => {
      expect(inst.eval("a ~ 'x' && b ~ 'y'", { a: 'x', b: 'y' })).toBe(true)
    })
  })

  describe('arithmetic applies value by value', () => {
    it('divides a per-allele count by a total', () => {
      expect(
        inst.eval(
          'feature.INFO.AC / feature.INFO.AN',
          site({ AC: [2, 4], AN: [10] })
        )
      ).toEqual([0.2, 0.4])
    })
    it('pairs equal-length lists element by element', () => {
      expect(inst.eval('[1, 2] + [10, 20]')).toEqual([11, 22])
      expect(inst.eval('-[1, 2]')).toEqual([-1, -2])
    })
    it('adds to a list of one rather than joining it as text', () => {
      expect(inst.eval('feature.INFO.DP + 1', site({ DP: [25] }))).toEqual([26])
    })
    it('has no answer for lists of two other lengths', () => {
      expect(inst.eval('[1, 2] + [1, 2, 3]')).toBeUndefined()
    })
    it('leaves arithmetic on single values as it was', () => {
      expect(inst.eval('"chr" + 1')).toBe('chr1')
      expect(inst.eval('7 // 2')).toBe(3)
    })
  })

  describe('aggregates', () => {
    const context = { xs: [3, 1, 4, 1, 5], gaps: [1, null, 3, undefined] }
    it('sums, averages and finds the median', () => {
      expect(inst.eval('sum(xs)', context)).toBe(14)
      expect(inst.eval('mean(xs)', context)).toBe(2.8)
      expect(inst.eval('median(xs)', context)).toBe(3)
      expect(inst.eval('median([1, 2, 3, 4])')).toBe(2.5)
    })
    it('skips missing values, as bcftools does', () => {
      expect(inst.eval('sum(gaps)', context)).toBe(4)
      expect(inst.eval('mean(gaps)', context)).toBe(2)
    })
    it('answers undefined for the mean of nothing', () => {
      expect(inst.eval('mean([])')).toBeUndefined()
      expect(inst.eval('max([])')).toBeUndefined()
      expect(inst.eval('sum([])')).toBe(0)
    })
    it('takes min and max of a list or of several values', () => {
      expect(inst.eval('max(xs)', context)).toBe(5)
      expect(inst.eval('min(xs)', context)).toBe(1)
      expect(inst.eval('max(3, 9, 2)')).toBe(9)
      expect(inst.eval('max(xs, 7)', context)).toBe(7)
    })
    it('reads each value through a lambda', () => {
      const samples = [
        { GT: '0/1', GQ: 99, DP: 30 },
        { GT: '1/1', GQ: 80, DP: 12 },
        { GT: './.', GQ: 0, DP: 0 }
      ]
      // bcftools: AVG(GQ)>50, SMPL_MAX(DP)>20, N_PASS(GQ>90)
      expect(inst.eval('mean(samples, s => s.GQ)', { samples })).toBeCloseTo(
        59.67,
        2
      )
      expect(inst.eval('max(samples, s => s.DP)', { samples })).toBe(30)
      expect(inst.eval('count(samples, s => s.GQ > 90)', { samples })).toBe(1)
      // bcftools: F_PASS(GQ>50 & GT!="mis") > 0.5
      expect(
        inst.eval("mean(samples, s => s.GQ > 50 && s.GT != './.')", { samples })
      ).toBeCloseTo(2 / 3)
    })
    it('combines with value-by-value arithmetic', () => {
      // bcftools: MIN(DV/DP)>0.3
      expect(
        inst.eval('min(DV / DP) > 0.3', { DV: [4, 9], DP: [10, 20] })
      ).toBe(true)
    })
  })
})
