/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { AnalyzeOptions } from '../analyze.ts'
import type { AstNode } from '../types.ts'

/**
 * How many values a field holds: one, a list of exactly that many when a
 * number, or a list whose length follows the record, as VCF's `Number=A`, `R`,
 * `G` and `.` do.
 */
export type Cardinality =
  | 'one'
  | 'perAlt'
  | 'perAllele'
  | 'perGenotype'
  | 'many'
  | number

/**
 * One field of a row, as a file header declares it. A `record` field's own
 * fields are further entries whose path extends its path, including when the
 * record is a list of them. A path key of `*` stands for every key of a map,
 * such as a VCF record's sample names. An entry with an empty path describes
 * the row itself.
 */
export interface FieldSchema {
  path: readonly string[]
  type: 'number' | 'string' | 'boolean' | 'flag' | 'record'
  cardinality?: Cardinality
  integer?: boolean
  description?: string
  /** Every value the field takes, where the header enumerates them. */
  categories?: readonly string[]
  domain?: readonly [number, number]
  /** For a record: its fields were observed in data rather than declared. */
  open?: boolean
}

export interface FromField {
  field?: FieldSchema
}

export type Type =
  | { kind: 'unknown' }
  | { kind: 'undefined' }
  | (FromField & {
      kind: 'number'
      values?: readonly number[]
      domain?: readonly [number, number]
    })
  | (FromField & { kind: 'string'; values?: readonly string[] })
  | (FromField & { kind: 'boolean' })
  | (FromField & {
      kind: 'list'
      of: Type
      cardinality: Exclude<Cardinality, 'one'>
    })
  | (FromField & {
      kind: 'record'
      fields: ReadonlyMap<string, Type>
      each?: Type
      open: boolean
    })
  | { kind: 'union'; of: readonly Type[] }
  | { kind: 'lambda'; returns: Type }

export type Kind = Type['kind']
export type OfKind<K extends Kind> = Extract<Type, { kind: K }>

export type ParamType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'list'
  | 'record'
  | 'any'
  | 'member'
  | 'lambda'

export interface Signature {
  params: readonly (ParamType | readonly ParamType[])[]
  /** How many trailing params a call may leave out. */
  optional?: number
  /** Whether the last param repeats. */
  variadic?: boolean
  returns?:
    | 'number'
    | 'string'
    | 'boolean'
    | Type
    | ((args: readonly Type[]) => Type)
}

export type Severity = 'error' | 'warning' | 'info'

export type DiagnosticCode =
  | 'unknown-variable'
  | 'unknown-field'
  | 'unknown-function'
  | 'arity'
  | 'argument-type'
  | 'list-operand'
  | 'list-lengths'
  | 'invalid-pattern'
  | 'string-numeric'
  | 'never-equal'
  | 'unknown-category'
  | 'index-scalar'
  | 'index-range'
  | 'dot-through-list'
  | 'dotted-key'

export interface Diagnostic {
  code: DiagnosticCode
  severity: Severity
  message: string
  node: AstNode
  /** Replacements for `node`'s text, best first. */
  suggestions?: string[]
}

export interface CheckOptions {
  schema?: readonly FieldSchema[]
  functions?: Readonly<Record<string, Signature>>
  accessors?: AnalyzeOptions['accessors']
  /** The variable holding the row. Without one, every free name is a field. */
  row?: string
  /**
   * The other variables the host binds, and their types. When given, any name
   * that is neither these, the row nor a field is reported.
   */
  env?: Readonly<Record<string, Type>>
}

export interface CheckResult {
  diagnostics: Diagnostic[]
  type: Type
}

export const UNKNOWN: Type = { kind: 'unknown' }
export const UNDEFINED: Type = { kind: 'undefined' }
export const BOOLEAN: Type = { kind: 'boolean' }
export const NUMBER: Type = { kind: 'number' }
export const STRING: Type = { kind: 'string' }
export const MAX_VALUES = 64

export const ARITHMETIC = new Set(['-', '*', '/', '//', '%', '^', '&'])
export const ORDER = new Set(['<', '<=', '>', '>='])
export const EQUALITY = new Set(['==', '!='])
