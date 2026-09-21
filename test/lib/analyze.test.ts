/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { describe, expect, it } from 'vitest'

import { Jexl } from '../../src/Jexl.ts'
import { analyze } from '../../src/analyze.ts'

import type {
  AnalyzeOptions,
  Call,
  CallArg,
  Field,
  Read
} from '../../src/analyze.ts'

const jexl = new Jexl()

const JBROWSE: AnalyzeOptions = {
  accessors: { get: [], getInherited: [], getTag: ['tags'] },
  row: 'feature'
}

const showPath = (keys: readonly (string | number)[], dynamic?: true) =>
  keys.join('.') + (dynamic ? '[*]' : '')
const showRead = ({ root, path, dynamic }: Read) =>
  showPath([root, ...path], dynamic)
const showField = ({ path, dynamic }: Field) => showPath(path, dynamic)
const showArg = (arg: CallArg) =>
  arg.type === 'literal'
    ? JSON.stringify(arg.value)
    : arg.type === 'path'
      ? showRead(arg.read)
      : '?'
const showCall = ({ name, args }: Call) =>
  `${name}(${args.map(showArg).join(', ')})`

type Summary = Partial<
  Record<
    'variables' | 'reads' | 'fields' | 'returns' | 'calls' | 'assigned',
    string[]
  >
> & { bare?: true }

function summary(expr: string, options = JBROWSE): Summary {
  const a = analyze(jexl.parse(expr), options)
  const shown = {
    variables: a.variables,
    reads: a.reads.map(showRead),
    fields: a.fields.map(showField),
    returns: a.returns.map(showRead),
    calls: a.calls.map(showCall),
    assigned: a.assigned
  }
  return {
    ...Object.fromEntries(
      Object.entries(shown).filter(([, list]) => list.length > 0)
    ),
    ...(a.bare ? { bare: true } : {})
  }
}

describe('analyze', () => {
  describe('jbrowse expressions', () => {
    it.each([
      [
        'cookbook colour by strand',
        "feature.strand==1?'tomato':feature.strand==-1?'cornflowerblue':'goldenrod'",
        {
          variables: ['feature'],
          reads: ['feature.strand'],
          fields: ['strand']
        }
      ],
      [
        'cookbook hsl template',
        '`hsl(${feature.score*3},50%,50%)`',
        {
          variables: ['feature'],
          reads: ['feature.score'],
          fields: ['score']
        }
      ],
      [
        'cookbook SV type lookup',
        "{DEL:'red',INS:'blue',DUP:'green',INV:'orange'}[feature.INFO.SVTYPE[0]] || 'gray'",
        {
          variables: ['feature'],
          reads: ['feature.INFO.SVTYPE.0'],
          fields: ['INFO.SVTYPE.0']
        }
      ],
      [
        'cookbook jexlFilters length',
        'feature.end - feature.start > 1000',
        {
          variables: ['feature'],
          reads: ['feature.end', 'feature.start'],
          fields: ['end', 'start']
        }
      ],
      [
        'formatDetails link, hiding a field with undefined',
        "{NCBI:'https://www.ncbi.nlm.nih.gov/gene/?term='+feature.name, type:undefined}",
        {
          variables: ['feature', 'undefined'],
          reads: ['feature.name', 'undefined'],
          fields: ['name']
        }
      ],
      [
        'formatDetails reading the track',
        "{ncbi:'https://www.ncbi.nlm.nih.gov/gene/?term='+feature.name+'+'+track.assemblyNames[0]}",
        {
          variables: ['feature', 'track'],
          reads: ['feature.name', 'track.assemblyNames.0'],
          fields: ['name']
        }
      ],
      [
        'formatDetails subfeature reading its parent',
        '{gene:parent.name}',
        { variables: ['parent'], reads: ['parent.name'] }
      ],
      [
        'multi-row partitionField',
        "split(split(feature.name,'#')[1],'/')[0]",
        {
          variables: ['feature'],
          reads: ['feature.name'],
          fields: ['name'],
          calls: ['split(?, "/")', 'split(feature.name, "#")']
        }
      ],
      [
        'DTU tutorial colour',
        "feature.parent.dtu=='muscle'?(parseFloat(feature.parent.dif)>0.6?'#901e21':parseFloat(feature.parent.dif)>0.3?'#c63335':'#d5716a'):feature.parent.dtu=='liver'?(parseFloat(feature.parent.dif)<-0.6?'#124f95':parseFloat(feature.parent.dif)<-0.3?'#2370cc':'#6394d5'):'#b2b1ac'",
        {
          variables: ['feature'],
          reads: ['feature.parent.dtu', 'feature.parent.dif'],
          fields: ['parent.dtu', 'parent.dif'],
          calls: [
            'parseFloat(feature.parent.dif)',
            'parseFloat(feature.parent.dif)',
            'parseFloat(feature.parent.dif)',
            'parseFloat(feature.parent.dif)'
          ]
        }
      ],
      [
        'graph genome colour by position',
        "feature.rank>0 ? 'rgb(60,65,72)' : `hsl(${min(300, max(0, ((feature.start+feature.end)/2 - 4050000) / 50000 * 300))},70%,50%)`",
        {
          variables: ['feature'],
          reads: ['feature.rank', 'feature.start', 'feature.end'],
          fields: ['rank', 'start', 'end'],
          calls: ['min(300, ?)', 'max(0, ?)']
        }
      ],
      [
        'synteny colour by name prefix',
        "feature.name && (startsWith(feature.name,'paa') || startsWith(feature.name,'fea') || feature.name == 'tynA') ? '#d62728' : 'goldenrod'",
        {
          variables: ['feature'],
          reads: ['feature.name'],
          fields: ['name'],
          calls: [
            'startsWith(feature.name, "paa")',
            'startsWith(feature.name, "fea")'
          ]
        }
      ],
      [
        'synteny colour through get',
        "randomColor(get(feature,'gene'))",
        {
          variables: ['feature'],
          reads: ['feature.gene'],
          fields: ['gene'],
          calls: ['randomColor(feature.gene)', 'get(feature, "gene")']
        }
      ],
      [
        'mark display y',
        '-log10(feature.pvalue)',
        {
          variables: ['feature'],
          reads: ['feature.pvalue'],
          fields: ['pvalue'],
          calls: ['log10(feature.pvalue)']
        }
      ],
      [
        'mark formula reading a BAM tag',
        "getTag(feature,'HP')",
        {
          variables: ['feature'],
          reads: ['feature.tags.HP'],
          fields: ['tags.HP'],
          returns: ['feature.tags.HP'],
          calls: ['getTag(feature, "HP")']
        }
      ],
      [
        'variant colour by allele frequency',
        "maf(feature)<0.01?'#ccc':maf(feature)<0.05?'#74a9cf':'#045a8d'",
        {
          variables: ['feature'],
          reads: ['feature'],
          fields: [''],
          calls: ['maf(feature)', 'maf(feature)']
        }
      ],
      [
        'pangenome SV filter',
        'feature.INFO.LV[0]==0 && alleleLength(feature)>=50',
        {
          variables: ['feature'],
          reads: ['feature.INFO.LV.0', 'feature'],
          fields: ['INFO.LV.0', ''],
          calls: ['alleleLength(feature)']
        }
      ],
      [
        'ClinVar colour through a local',
        "s = feature.INFO.CLNSIG; ({'Benign':'blue','Likely_benign':'deepskyblue','Pathogenic':'red'})[s] || 'purple'",
        {
          variables: ['feature'],
          reads: ['feature.INFO.CLNSIG'],
          fields: ['INFO.CLNSIG'],
          assigned: ['s']
        }
      ],
      [
        'sars-cov2 label fallbacks',
        "get(feature,'product') || get(feature,'name') || get(feature,'id')",
        {
          variables: ['feature'],
          reads: ['feature.product', 'feature.name', 'feature.id'],
          fields: ['product', 'name', 'id'],
          calls: [
            'get(feature, "product")',
            'get(feature, "name")',
            'get(feature, "id")'
          ]
        }
      ],
      [
        'variant filter preset on FILTER',
        "'PASS' in feature.FILTER",
        {
          variables: ['feature'],
          reads: ['feature.FILTER'],
          fields: ['FILTER']
        }
      ],
      [
        'variant filter preset on consequences',
        "'missense_variant' in consequences(feature)",
        {
          variables: ['feature'],
          reads: ['feature'],
          fields: [''],
          calls: ['consequences(feature)']
        }
      ],
      [
        'chord colour reading INFO through get',
        "get(feature,'INFO').SVTYPE=='BND'?'#d95f02':'rgba(255,133,0,0.32)'",
        {
          variables: ['feature'],
          reads: ['feature.INFO.SVTYPE'],
          fields: ['INFO.SVTYPE'],
          calls: ['get(feature, "INFO")']
        }
      ],
      [
        'arc height default',
        "log10(get(feature,'end')-get(feature,'start'))*50",
        {
          variables: ['feature'],
          reads: ['feature.end', 'feature.start'],
          fields: ['end', 'start'],
          calls: ['log10(?)', 'get(feature, "end")', 'get(feature, "start")']
        }
      ],
      [
        'paired arc colour reading a second variable',
        'defaultPairedArcColor(feature,alt)',
        {
          variables: ['feature', 'alt'],
          reads: ['feature', 'alt'],
          fields: [''],
          calls: ['defaultPairedArcColor(feature, alt)']
        }
      ],
      [
        'FASTA refName rewrite',
        "split(refName, ' ')[0]",
        {
          variables: ['refName'],
          reads: ['refName'],
          calls: ['split(refName, " ")']
        }
      ],
      [
        'GWAS scoreTransform',
        '-log10(score)',
        {
          variables: ['score'],
          reads: ['score'],
          calls: ['log10(score)']
        }
      ],
      [
        'mouseover default',
        "get(feature,'_mouseOver')||get(feature,'name')||get(feature,'function')||get(feature,'id')",
        {
          variables: ['feature'],
          reads: [
            'feature._mouseOver',
            'feature.name',
            'feature.function',
            'feature.id'
          ],
          fields: ['_mouseOver', 'name', 'function', 'id'],
          calls: [
            'get(feature, "_mouseOver")',
            'get(feature, "name")',
            'get(feature, "function")',
            'get(feature, "id")'
          ]
        }
      ],
      ['constant colour', "'#0068d1'", {}]
    ])('%s', (_source, expr, expected) => {
      expect(summary(expr)).toEqual(expected)
    })
  })

  describe('paths', () => {
    it('reads the same field through a dot, get and a method call', () => {
      for (const expr of [
        'feature.x',
        "get(feature,'x')",
        "feature.get('x')"
      ]) {
        expect(summary(expr).reads).toEqual(['feature.x'])
      }
    })

    it('reads the whole subject of a function that is not an accessor', () => {
      expect(summary("get(feature,'x')", {})).toEqual({
        variables: ['feature'],
        reads: ['feature'],
        calls: ['get(feature, "x")']
      })
    })

    it('ignores accessors inherited from Object.prototype', () => {
      expect(summary('toString(feature)').reads).toEqual(['feature'])
    })

    it('folds literal subscripts, including a static template', () => {
      expect(summary("feature['a'][0][true][`b`]").reads).toEqual([
        'feature.a.0.true.b'
      ])
    })

    it('marks a computed subscript dynamic and stops the path there', () => {
      expect(summary('feature.INFO[key].x')).toEqual({
        variables: ['key', 'feature'],
        reads: ['key', 'feature.INFO[*]'],
        fields: ['INFO[*]'],
        returns: ['feature.INFO[*]']
      })
    })

    it('marks an accessor with a computed key dynamic', () => {
      expect(summary('get(feature, key).z').reads).toEqual([
        'key',
        'feature[*]'
      ])
    })

    it('extends a path through a call written against a value', () => {
      expect(summary("feature.get('INFO').DP[0] > 10").reads).toEqual([
        'feature.INFO.DP.0'
      ])
    })

    it('reads nothing from a member of a literal', () => {
      expect(summary("{a: feature.x}.a + 'abc'.length").reads).toEqual([
        'feature.x'
      ])
    })
  })

  describe('conditionals', () => {
    it('returns either branch', () => {
      expect(summary('feature.strand > 0 ? feature.a : feature.b')).toEqual({
        variables: ['feature'],
        reads: ['feature.strand', 'feature.a', 'feature.b'],
        fields: ['strand', 'a', 'b'],
        returns: ['feature.a', 'feature.b']
      })
    })

    it('returns the test where the consequent is omitted', () => {
      expect(summary('feature.a ?: feature.b').returns).toEqual([
        'feature.a',
        'feature.b'
      ])
    })
  })

  describe('locals', () => {
    it('reads through a local rather than from the context', () => {
      expect(summary('x = feature.score; x > 1')).toEqual({
        variables: ['feature'],
        reads: ['feature.score'],
        fields: ['score'],
        assigned: ['x']
      })
    })

    it('extends a path through an aliased local', () => {
      expect(summary('f = feature; f.INFO.DP > 10').reads).toEqual([
        'feature.INFO.DP'
      ])
    })

    it('reads the context for a name before it is assigned', () => {
      expect(summary('x = x + 1')).toEqual({
        variables: ['x'],
        reads: ['x'],
        assigned: ['x']
      })
    })

    it('reports what a local held though nothing read it', () => {
      expect(summary('x = feature.a; x = feature.b; 1').reads).toEqual([
        'feature.a',
        'feature.b'
      ])
    })

    it('binds nothing past a branch that may not run', () => {
      expect(summary('c ? (x = feature.a) : 0; x.b')).toEqual({
        variables: ['c', 'feature', 'x'],
        reads: ['c', 'feature.a', 'x.b'],
        fields: ['a'],
        returns: ['x.b'],
        assigned: ['x']
      })
    })

    it('binds nothing past the right side of a binary operator', () => {
      expect(summary('ok && (x = feature.a); x').variables).toEqual([
        'ok',
        'feature',
        'x'
      ])
    })
  })

  describe('fields', () => {
    const MASK: AnalyzeOptions = { row: 'feature', env: ['track'] }

    it('reads a bare name as a field under a data mask', () => {
      expect(summary('-log10(pvalue)', MASK).fields).toEqual(['pvalue'])
      expect(summary('-log10(feature.pvalue)', MASK).fields).toEqual(['pvalue'])
    })

    it('counts each field once whichever way it is spelt', () => {
      expect(
        summary('pvalue < 0.05 && feature.pvalue > 0', MASK).fields
      ).toEqual(['pvalue'])
    })

    it('leaves the host variables out of the fields', () => {
      expect(summary("track.name + ':' + INFO.SVTYPE", MASK)).toEqual({
        variables: ['track', 'INFO'],
        reads: ['track.name', 'INFO.SVTYPE'],
        fields: ['INFO.SVTYPE']
      })
    })

    it('lists no fields without a row or a mask', () => {
      expect(summary('feature.score', {}).fields).toBeUndefined()
    })
  })

  describe('bare paths', () => {
    it.each(['score', 'INFO.SVTYPE', 'feature.INFO.DP[0]', "a['b c']"])(
      '%s is a bare path',
      (expr) => {
        expect(summary(expr).bare).toBe(true)
      }
    )

    it.each([
      "get(feature,'score')",
      'feature[k]',
      '-score',
      "'score'",
      'x = score; x',
      '(a ? b : c).d'
    ])('%s is not a bare path', (expr) => {
      expect(summary(expr).bare).toBeUndefined()
    })

    it('reads its path from the row under a data mask', () => {
      const a = analyze(jexl.parse('INFO.DP[0]'), { env: [] })
      expect(a.bare).toBe(true)
      expect(a.fields).toEqual([{ path: ['INFO', 'DP', 0] }])
    })
  })

  describe('calls', () => {
    it('classifies each argument', () => {
      const { calls } = analyze(jexl.parse("f('a', 2, feature.x, g(), [1])"))
      expect(calls[0]!.args).toEqual([
        { type: 'literal', value: 'a' },
        { type: 'literal', value: 2 },
        { type: 'path', read: { root: 'feature', path: ['x'] } },
        { type: 'dynamic' },
        { type: 'dynamic' }
      ])
    })
  })

  describe('lambdas', () => {
    it('binds a parameter rather than reading the context', () => {
      expect(summary('any(feature.INFO.AF, af => af > 0.05)')).toEqual({
        variables: ['feature'],
        reads: ['feature.INFO.AF'],
        fields: ['INFO.AF'],
        calls: ['any(feature.INFO.AF, ?)']
      })
    })
    it('reads the free names of its body from the context', () => {
      expect(summary('map(xs, x => x.y + t)')).toEqual({
        variables: ['xs', 't'],
        reads: ['xs', 't'],
        calls: ['map(xs, ?)']
      })
    })
    it('lets a parameter shadow a local of the same name', () => {
      expect(summary('x = feature.score; map(xs, x => x * 2)')).toEqual({
        variables: ['xs', 'feature'],
        reads: ['xs', 'feature.score'],
        fields: ['score'],
        calls: ['map(xs, ?)'],
        assigned: ['x']
      })
    })
  })

  it('reports nothing for an empty expression', () => {
    expect(analyze(null)).toEqual({
      variables: [],
      reads: [],
      fields: [],
      returns: [],
      bare: false,
      calls: [],
      assigned: []
    })
  })

  it('reads the tree of an expression not yet compiled', () => {
    const expr = jexl.createExpression('feature.score')
    expect(analyze(expr.ast).variables).toEqual(['feature'])
  })
})
