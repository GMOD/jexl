/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import Evaluator from './evaluator/Evaluator'
import Lexer from './Lexer'
import Parser from './parser/Parser'
import PromiseSync from './PromiseSync'
import type { AstNode } from './types'

interface Grammar {
  elements: {
    [key: string]: any
  }
  [key: string]: any
}

type PromiseConstructor = typeof Promise | typeof PromiseSync

class Expression {
  _grammar: Grammar
  _exprStr: string
  _ast: AstNode | null

  constructor(grammar: Grammar, exprStr: string) {
    this._grammar = grammar
    this._exprStr = exprStr
    this._ast = null
  }

  /**
   * Forces a compilation of the expression string that this Expression object
   * was constructed with. This function can be called multiple times; useful
   * if the language elements of the associated Jexl instance change.
   * @returns {Expression} this Expression instance, for convenience
   */
  compile() {
    const lexer = new Lexer(this._grammar)
    const parser = new Parser(this._grammar, lexer)
    const tokens = lexer.tokenize(this._exprStr)
    parser.addTokens(tokens)
    this._ast = parser.complete()
    return this
  }

  /**
   * Asynchronously evaluates the expression within an optional context.
   * @param {Object} [context] A mapping of variables to values, which will be
   *      made accessible to the Jexl expression when evaluating it
   * @returns {Promise<*>} resolves with the result of the evaluation.
   */
  eval(context = {}) {
    return this._eval(context, Promise)
  }

  /**
   * Synchronously evaluates the expression within an optional context.
   * @param {Object} [context] A mapping of variables to values, which will be
   *      made accessible to the Jexl expression when evaluating it
   * @returns {*} the result of the evaluation.
   * @throws {*} on error
   */
  evalSync(context = {}) {
    const res = this._eval(context, PromiseSync as any) as PromiseSync
    if (res.error) throw res.error
    return res.value
  }

  _eval(context: any, promise: PromiseConstructor) {
    return promise.resolve().then(() => {
      const ast = this._getAst()
      const evaluator = new Evaluator(
        this._grammar,
        context,
        undefined,
        promise
      )
      return evaluator.eval(ast!)
    })
  }

  _getAst() {
    if (!this._ast) this.compile()
    return this._ast
  }
}

export default Expression
