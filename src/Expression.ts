/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import Lexer from './Lexer.ts'
import Evaluator from './evaluator/Evaluator.ts'
import Parser from './parser/Parser.ts'

import type { AstNode } from './types.ts'

interface Grammar {
  elements: Record<string, any>
  [key: string]: any
}

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
   * Evaluates the expression within an optional context.
   * @param {Object} [context] A mapping of variables to values, which will be
   *      made accessible to the Jexl expression when evaluating it
   * @returns {*} the result of the evaluation.
   * @throws {*} on error
   */
  eval(context = {}) {
    const ast = this._getAst()
    const evaluator = new Evaluator(this._grammar, context)
    return evaluator.eval(ast!)
  }

  _getAst() {
    if (!this._ast) {
      this.compile()
    }
    return this._ast
  }
}

export default Expression
