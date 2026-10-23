/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { JexlValue } from '../types.ts'

/** The variables an expression is evaluated against. */
export type Context = Record<string, JexlValue>

/**
 * An AST node lowered to a closure. Calling it with a context produces the
 * node's value. The grammar is captured when the closure is built, so it is not
 * a parameter.
 */
export type CompiledNode = (context: Context) => JexlValue
