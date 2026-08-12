/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { compileAst } from './compile.ts'

import type { Grammar } from '../grammar.ts'
import type { AstNode, JexlValue } from '../types.ts'

/**
 * The Evaluator carries everything an expression is evaluated against: the
 * grammar, the context, and a relative context to be used as the root for
 * relative identifiers. When any of these change, a new instance is required.
 * However, a single instance can be used to evaluate many different
 * expressions, and does not have to be reinstantiated for each.
 *
 * The work of evaluation itself lives in {@link compileAst}, which lowers a
 * tree to closures. Prefer compiling once and reusing the result — that is what
 * {@link Expression} does — over calling {@link #eval}, which compiles the tree
 * it is given every time.
 *
 * @param {{}} grammar A grammar object against which to evaluate the expression
 *      tree
 * @param {{}} [context] A map of variable keys to their values. This will be
 *      accessed to resolve the value of each non-relative identifier.
 * @param {{}|Array<{}|Array>} [relativeContext] A map or array to be accessed
 *      to resolve the value of a relative identifier.
 */
class Evaluator {
  _grammar: Grammar
  _context: Record<string, JexlValue>
  _relContext: Record<string, JexlValue>

  constructor(
    grammar: Grammar,
    context?: Record<string, JexlValue>,
    relativeContext?: Record<string, JexlValue>
  ) {
    this._grammar = grammar
    this._context = context || {}
    this._relContext = relativeContext || this._context
  }

  /**
   * Compiles and evaluates an expression tree within the configured context.
   * Convenient for a one-shot evaluation; for repeated evaluation of the same
   * tree, hold onto the closure from {@link compileAst} instead so the tree is
   * only lowered once.
   * @param {{}} ast An expression tree object
   * @returns {*} the resulting value of the expression.
   */
  eval(ast: AstNode): JexlValue {
    return compileAst(ast, this._grammar)(this)
  }
}

export default Evaluator
