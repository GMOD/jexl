/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import Lexer from './Lexer.ts'
import Evaluator from './evaluator/Evaluator.ts'
import Parser from './parser/Parser.ts'

import type { Grammar } from './grammar.ts'
import type { AstNode } from './types.ts'

class Expression {
  _grammar: Grammar
  _exprStr: string
  _ast: AstNode | null
  _lexer: Lexer
  _compiled = false

  /**
   * @param {{}} grammar The grammar to compile and evaluate against
   * @param {string} exprStr The Jexl expression string
   * @param {Lexer} [lexer] A Lexer to reuse. Lexers memoize the regex used to
   *      split expressions, which is expensive to build, so passing a shared
   *      one avoids paying that cost per expression. It must be invalidated
   *      via {@link Lexer#_clearCache} whenever the grammar's elements change.
   */
  constructor(grammar: Grammar, exprStr: string, lexer?: Lexer) {
    this._grammar = grammar
    this._exprStr = exprStr
    this._ast = null
    this._lexer = lexer ?? new Lexer(grammar)
  }

  /**
   * Forces a compilation of the expression string that this Expression object
   * was constructed with. This function can be called multiple times; useful
   * if the language elements of the associated Jexl instance change.
   * @returns {Expression} this Expression instance, for convenience
   */
  compile() {
    const parser = new Parser(this._grammar, this._lexer)
    const tokens = this._lexer.tokenize(this._exprStr)
    parser.addTokens(tokens)
    this._ast = parser.complete()
    this._compiled = true
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
    // an expression with no tokens (empty or whitespace-only) has no AST
    if (!ast) {
      return undefined
    }
    const evaluator = new Evaluator(this._grammar, context)
    return evaluator.eval(ast)
  }

  _getAst() {
    // tracked separately from _ast, which is legitimately null for an
    // expression with no tokens and would otherwise recompile on every eval
    if (!this._compiled) {
      this.compile()
    }
    return this._ast
  }
}

export default Expression
