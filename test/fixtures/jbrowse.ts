/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type {
  Cardinality,
  FieldSchema,
  ParamType,
  Signature,
  Type
} from '../../src/check.ts'

/**
 * A header as `@gmod/vcf`'s `getMetadata()` returns it: gnomAD-style
 * frequencies, ClinVar significance, VEP's CSQ, a Jannovar ANN (which declares
 * `Number=1` and writes many), SV fields, and the pangenome `LV`.
 */
export const VCF_METADATA = {
  INFO: {
    DP: {
      Number: 1,
      Type: 'Integer',
      Description: 'Approximate read depth; some reads may have been filtered'
    },
    AF: {
      Number: 'A',
      Type: 'Float',
      Description:
        'Allele Frequency, for each ALT allele, in the same order as listed'
    },
    'AF.EAS': {
      Number: 'A',
      Type: 'Float',
      Description: 'Allele frequency in East Asian samples'
    },
    AC: {
      Number: 'A',
      Type: 'Integer',
      Description: 'Allele count in genotypes, for each ALT allele'
    },
    AN: {
      Number: 1,
      Type: 'Integer',
      Description: 'Total number of alleles in called genotypes'
    },
    MQ: { Number: 1, Type: 'Float', Description: 'RMS Mapping Quality' },
    DB: { Number: 0, Type: 'Flag', Description: 'dbSNP Membership' },
    CLNSIG: {
      Number: '.',
      Type: 'String',
      Description: 'Aggregate germline classification for this single variant'
    },
    SVTYPE: {
      Number: 1,
      Type: 'String',
      Description: 'Type of structural variant'
    },
    SVLEN: {
      Number: '.',
      Type: 'Integer',
      Description: 'Difference in length between REF and ALT alleles'
    },
    END: {
      Number: 1,
      Type: 'Integer',
      Description: 'End position of the variant described in this record'
    },
    LV: {
      Number: 1,
      Type: 'Integer',
      Description: 'Level in the snarl tree (0=top level)'
    },
    CSQ: {
      Number: '.',
      Type: 'String',
      Description:
        'Consequence annotations from Ensembl VEP. Format: Allele|Consequence|IMPACT|SYMBOL|Gene|Feature_type|Feature|BIOTYPE|EXON|INTRON|HGVSc|HGVSp|cDNA_position|CDS_position|Protein_position|Amino_acids|Codons|Existing_variation|DISTANCE|STRAND|FLAGS|SYMBOL_SOURCE|HGNC_ID|CANONICAL|SIFT|PolyPhen|gnomADe_AF'
    },
    ANN: {
      Number: 1,
      Type: 'String',
      Description:
        "Functional annotations: 'Allele | Annotation | Annotation_Impact | Gene_Name | Gene_ID | Feature_Type | Feature_ID | Transcript_BioType | Rank | HGVS.c | HGVS.p | cDNA.pos / cDNA.length | CDS.pos / CDS.length | AA.pos / AA.length | Distance | ERRORS / WARNINGS / INFO'"
    }
  },
  FORMAT: {
    GT: { Number: 1, Type: 'String', Description: 'Genotype' },
    AD: {
      Number: 'R',
      Type: 'Integer',
      Description:
        'Allelic depths for the ref and alt alleles in the order listed'
    },
    DP: { Number: 1, Type: 'Integer', Description: 'Approximate read depth' },
    GQ: { Number: 1, Type: 'Integer', Description: 'Genotype Quality' },
    PL: {
      Number: 'G',
      Type: 'Integer',
      Description: 'Normalized, Phred-scaled likelihoods for genotypes'
    }
  },
  FILTER: {
    PASS: { Description: 'All filters passed' },
    LowQual: { Description: 'Low quality' },
    AC0: { Description: 'Allele count is zero after filtering' }
  },
  ALT: {
    DEL: { Description: 'Deletion' },
    INS: { Description: 'Insertion' },
    DUP: { Description: 'Duplication' },
    INV: { Description: 'Inversion' },
    CNV: { Description: 'Copy number variable region' },
    BND: { Description: 'Breakend' }
  }
}

interface Declaration {
  Number?: number | string
  Type?: string
  Description?: string
}

type Metadata = Record<string, Record<string, Declaration>>

export const IMPACTS = ['HIGH', 'MODERATE', 'LOW', 'MODIFIER']

export const SO_CONSEQUENCES = [
  'transcript_ablation',
  'splice_acceptor_variant',
  'splice_donor_variant',
  'stop_gained',
  'frameshift_variant',
  'stop_lost',
  'start_lost',
  'transcript_amplification',
  'inframe_insertion',
  'inframe_deletion',
  'missense_variant',
  'protein_altering_variant',
  'splice_region_variant',
  'splice_donor_5th_base_variant',
  'splice_donor_region_variant',
  'splice_polypyrimidine_tract_variant',
  'incomplete_terminal_codon_variant',
  'start_retained_variant',
  'stop_retained_variant',
  'synonymous_variant',
  'coding_sequence_variant',
  'mature_miRNA_variant',
  '5_prime_UTR_variant',
  '3_prime_UTR_variant',
  'non_coding_transcript_exon_variant',
  'intron_variant',
  'NMD_transcript_variant',
  'non_coding_transcript_variant',
  'upstream_gene_variant',
  'downstream_gene_variant',
  'TFBS_ablation',
  'TF_binding_site_variant',
  'regulatory_region_variant',
  'intergenic_variant',
  'sequence_variant'
]

function cardinalityOf(number: Declaration['Number']): Cardinality {
  switch (number) {
    case 1: {
      return 'one'
    }
    case 'A': {
      return 'perAlt'
    }
    case 'R': {
      return 'perAllele'
    }
    case 'G': {
      return 'perGenotype'
    }
    case undefined:
    case '.': {
      return 'many'
    }
    default: {
      return typeof number === 'number' ? number : 'many'
    }
  }
}

function subfieldsOf(description = '') {
  const listed =
    /Format:\s*([^"]*)/.exec(description)?.[1] ??
    /Functional annotations:\s*'([^']*)'/.exec(description)?.[1]
  return listed?.split('|').map((name) => name.trim())
}

function subfield(parent: string[], name: string): FieldSchema {
  const path = [...parent, name]
  if (name === 'Consequence' || name === 'Annotation') {
    return {
      path,
      type: 'string',
      cardinality: 'many',
      categories: SO_CONSEQUENCES
    }
  }
  if (name === 'IMPACT' || name === 'Annotation_Impact') {
    return { path, type: 'string', categories: IMPACTS }
  }
  if (/(^|_)AF$|^DISTANCE$|^Distance$|^STRAND$/.test(name)) {
    return { path, type: 'number' }
  }
  return { path, type: 'string' }
}

function declared(
  path: string[],
  { Number: number, Type: type, Description: description }: Declaration,
  model: 'v4' | 'v5',
  categories?: readonly string[]
): FieldSchema[] {
  const meta = {
    ...(description && { description }),
    ...(categories && { categories })
  }
  if (type === 'Flag') {
    return [{ path, type: 'flag', ...meta }]
  }
  const subfields = subfieldsOf(description)
  if (subfields) {
    return model === 'v4'
      ? [{ path, type: 'string', cardinality: 'many', ...meta }]
      : [
          { path, type: 'record', cardinality: 'many', ...meta },
          ...subfields.map((name) => subfield(path, name))
        ]
  }
  const cardinality = cardinalityOf(number)
  return [
    {
      path,
      type: type === 'Integer' || type === 'Float' ? 'number' : 'string',
      ...(type === 'Integer' && { integer: true }),
      cardinality: model === 'v4' && cardinality === 'one' ? 1 : cardinality,
      ...meta
    }
  ]
}

/**
 * The fields of a VCF feature, read off its header: what the JBrowse variant
 * adapter would answer. `v5` is the proposed data model, with `Number=1`
 * fields as scalars and CSQ/ANN entries as records split on the header's
 * `Format:`; `v4` is today's, where every INFO value is a list.
 */
export function vcfFieldSchema(
  metadata: Metadata,
  model: 'v4' | 'v5' = 'v5'
): FieldSchema[] {
  const filters = Object.keys(metadata.FILTER ?? {})
  const svTypes = Object.keys(metadata.ALT ?? {})
  return [
    { path: [], type: 'record' },
    { path: ['refName'], type: 'string' },
    { path: ['start'], type: 'number', integer: true },
    { path: ['end'], type: 'number', integer: true },
    { path: ['name'], type: 'string' },
    { path: ['type'], type: 'string' },
    { path: ['description'], type: 'string' },
    { path: ['CHROM'], type: 'string' },
    { path: ['POS'], type: 'number', integer: true },
    { path: ['ID'], type: 'string', cardinality: 'many' },
    { path: ['REF'], type: 'string' },
    { path: ['ALT'], type: 'string', cardinality: 'perAlt' },
    { path: ['QUAL'], type: 'number', domain: [0, Infinity] },
    {
      path: ['FILTER'],
      type: 'string',
      cardinality: 'many',
      categories: filters
    },
    { path: ['INFO'], type: 'record' },
    ...Object.entries(metadata.INFO ?? {}).flatMap(([id, declaration]) =>
      declared(
        ['INFO', id],
        declaration,
        model,
        id === 'SVTYPE' ? svTypes : undefined
      )
    ),
    { path: ['samples'], type: 'record' },
    { path: ['samples', '*'], type: 'record' },
    ...Object.entries(metadata.FORMAT ?? {}).flatMap(([id, declaration]) =>
      declared(['samples', '*', id], declaration, model)
    ),
    { path: ['genotypes'], type: 'record' },
    { path: ['genotypes', '*'], type: 'string' }
  ]
}

/** A GFF3 feature, whose attributes JBrowse observes rather than reads. */
export const GFF3_SCHEMA: FieldSchema[] = [
  { path: [], type: 'record', open: true },
  { path: ['start'], type: 'number', integer: true },
  { path: ['end'], type: 'number', integer: true },
  { path: ['type'], type: 'string' },
  { path: ['score'], type: 'number' },
  { path: ['strand'], type: 'number' },
  { path: ['collection-date'], type: 'string' },
  { path: ['dif'], type: 'string' }
]

/** A bigBed whose autoSql declares a column named with a space. */
export const BED_SCHEMA: FieldSchema[] = [
  { path: [], type: 'record' },
  { path: ['refName'], type: 'string' },
  { path: ['start'], type: 'number', integer: true },
  { path: ['end'], type: 'number', integer: true },
  { path: ['name'], type: 'string' },
  { path: ['score'], type: 'number', integer: true, domain: [0, 1000] },
  { path: ['strand'], type: 'number' },
  { path: ['Study ID'], type: 'string', description: 'GWAS catalog study' },
  {
    path: ['pvalue'],
    type: 'number',
    domain: [0, 1],
    description: 'Association p-value'
  }
]

export const BAM_SCHEMA: FieldSchema[] = [
  { path: [], type: 'record' },
  { path: ['start'], type: 'number', integer: true },
  { path: ['end'], type: 'number', integer: true },
  { path: ['name'], type: 'string' },
  { path: ['strand'], type: 'number' },
  { path: ['tags'], type: 'record', open: true },
  { path: ['tags', 'HP'], type: 'number', integer: true },
  { path: ['tags', 'RG'], type: 'string', categories: ['rg1', 'rg2'] }
]

function signature(
  params: readonly (ParamType | readonly ParamType[])[],
  returns: Signature['returns'],
  extra: Partial<Signature> = {}
): Signature {
  return { params, returns, ...extra }
}

function log10(args: readonly Type[]): Type {
  const [arg] = args
  const domain = arg?.kind === 'number' ? arg.domain : undefined
  return domain
    ? {
        kind: 'number',
        domain: [Math.log10(domain[0]), Math.log10(domain[1])]
      }
    : { kind: 'number' }
}

const text: Type = { kind: 'string' }
const numbers = signature(['number'], 'number')
const strings = signature(['string'], 'string')

/**
 * What JBrowse registers, as the signatures its `#jexlFunction` doc tags would
 * declare, plus the `any` and `all` a lambda-capable parser brings.
 */
export const JBROWSE_FUNCTIONS: Record<string, Signature> = {
  parent: signature(['record'], { kind: 'unknown' }),
  id: signature(['record'], 'string'),
  cast: signature(['any'], { kind: 'unknown' }),
  max: signature(['number'], 'number', { variadic: true }),
  min: signature(['number'], 'number', { variadic: true }),
  sqrt: numbers,
  ceil: numbers,
  floor: numbers,
  round: numbers,
  abs: numbers,
  log10: signature(['number'], log10),
  log: numbers,
  parseInt: signature(['any'], 'number'),
  parseFloat: signature(['any'], 'number'),
  charAt: signature(['string', 'number'], 'string'),
  charCodeAt: signature(['string', 'number'], 'number'),
  codePointAt: signature(['string', 'number'], 'number'),
  repeat: signature(['string', 'number'], 'string'),
  padStart: signature(['string', 'number', 'string'], 'string', {
    optional: 1
  }),
  padEnd: signature(['string', 'number', 'string'], 'string', { optional: 1 }),
  slice: signature(['string', 'number', 'number'], 'string', { optional: 1 }),
  replaceAll: signature(['string', 'string', 'string'], 'string'),
  trimStart: strings,
  trimEnd: strings,
  jsonParse: signature(['string'], { kind: 'unknown' }),
  hsl: signature(['any'], 'string'),
  colorString: signature(['any'], 'string'),
  interpolate: signature(['number', 'any'], 'string'),
  includes: signature([['list', 'string'], 'member'], 'boolean'),
  split: signature(['string', 'string'], {
    kind: 'list',
    of: text,
    cardinality: 'many'
  }),
  startsWith: signature(['string', 'string', 'number'], 'boolean', {
    optional: 1
  }),
  endsWith: signature(['string', 'string', 'number'], 'boolean', {
    optional: 1
  }),
  substring: signature(['string', 'number', 'number'], 'string', {
    optional: 1
  }),
  replace: signature(['string', 'string', 'string'], 'string'),
  trim: strings,
  toUpperCase: strings,
  toLowerCase: strings,
  join: signature(['string', 'any'], 'string', { variadic: true }),
  randomColor: signature(['any'], 'string'),
  categoricalColor: signature(['any', 'list', 'list'], 'string', {
    optional: 1
  }),
  alpha: signature(['string', 'number'], 'string'),
  maf: signature(['record'], { kind: 'number', domain: [0, 0.5] }),
  missingness: signature(['record'], { kind: 'number', domain: [0, 1] }),
  impact: signature(['record'], { kind: 'string', values: IMPACTS }),
  consequence: signature(['record'], {
    kind: 'string',
    values: SO_CONSEQUENCES
  }),
  consequences: signature(['record'], {
    kind: 'list',
    of: { kind: 'string', values: SO_CONSEQUENCES },
    cardinality: 'many'
  }),
  impactColor: signature(['record'], 'string'),
  svTypeColor: signature(['record'], 'string'),
  alleleLength: signature(['record'], 'number'),
  svType: signature(['record'], 'string'),
  nAlt: signature(['record'], 'number'),
  genotypeCount: signature(['record', 'string'], 'number'),
  logThickness: signature(['record', 'string'], 'number'),
  defaultPairedArcColor: signature(['record', 'any'], 'string'),
  lgvSyntenyTooltip: signature(['record'], 'string'),
  defaultOnChordClick: signature(['record', 'any', 'any'], { kind: 'unknown' }),
  svChordColor: signature(['record'], 'string'),
  any: signature(['list', 'lambda'], 'boolean'),
  all: signature(['list', 'lambda'], 'boolean')
}

export const JBROWSE_ACCESSORS = {
  get: [],
  getInherited: [],
  getTag: ['tags']
}
