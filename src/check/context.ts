/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type {
  CheckOptions,
  Diagnostic,
  DiagnosticCode,
  Severity,
  Type
} from './types.ts'
import type { AstNode } from '../types.ts'

/** One check in progress: what it reads from and reports into. */
export interface Checker {
  root: Type
  diagnostics: Diagnostic[]
  scope: Map<string, Type>
  functions: CheckOptions['functions']
  accessors: NonNullable<CheckOptions['accessors']>
  row: string | undefined
  env: CheckOptions['env']
  report: (
    code: DiagnosticCode,
    severity: Severity,
    node: AstNode,
    message: string,
    suggestions?: string[]
  ) => void
  infer: (node: AstNode) => Type
}
