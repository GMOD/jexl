/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { infer } from './infer.ts'
import { recordOf } from './schema.ts'
import { UNDEFINED, UNKNOWN } from './types.ts'

import type { Checker } from './context.ts'
import type { CheckOptions, CheckResult } from './types.ts'
import type { AstNode } from '../types.ts'

/**
 * Checks an expression against the fields a host's data declares and the
 * functions it registers, without evaluating it, and infers what it answers.
 */
export function check(
  ast: AstNode | null,
  { schema, functions, accessors = {}, row, env }: CheckOptions = {}
): CheckResult {
  const c: Checker = {
    root: schema ? recordOf(schema) : UNKNOWN,
    diagnostics: [],
    scope: new Map(),
    functions,
    accessors,
    row,
    env,
    report(code, severity, node, message, suggestions) {
      c.diagnostics.push({
        code,
        severity,
        message,
        node,
        ...(suggestions?.length ? { suggestions } : {})
      })
    },
    infer: (node) => infer(c, node)
  }
  const type = ast ? c.infer(ast) : UNDEFINED
  return { diagnostics: c.diagnostics, type }
}
