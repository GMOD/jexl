/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type Lexer from '../Lexer.ts'
import type { Grammar } from '../grammar.ts'
import type {
  AstNode,
  AstNodeUnion,
  ConditionalExpression,
  Literal,
  ObjectLiteral,
  TemplateLiteral,
  TemplatePart,
  Token
} from '../types.ts'

const omittedAlternateBefore = new Set([
  'closeParen',
  'closeBracket',
  'closeCurl',
  'comma',
  'semicolon'
])

/**
 * Converts the tokens from the {@link Lexer} into an Abstract Syntax Tree, for
 * {@link compileAst} to lower to closures. A Pratt parser: each level of the
 * grammar is a method, from `_sequence` (loosest) down to `_primary`, and
 * binary operators are climbed by the precedence the grammar gives them, so
 * operators a host registers slot in without the parser knowing them.
 */
class Parser {
  _grammar: Grammar
  _lexer: Lexer
  _tokens: Token[] = []
  _pos = 0

  constructor(grammar: Grammar, lexer: Lexer) {
    this._grammar = grammar
    this._lexer = lexer
  }

  parse(source: string) {
    this.addTokens(this._lexer.tokenize(source))
    return this.complete()
  }

  addTokens(tokens: Token[]) {
    this._tokens = this._tokens.concat(tokens)
  }

  /**
   * @returns the expression tree, or null for an expression with no tokens
   * @throws {Error} if the tokens do not form exactly one expression
   */
  complete(): AstNodeUnion | null {
    if (this._tokens.length === 0) {
      return null
    }
    const ast = this._sequence()
    if (this._pos < this._tokens.length) {
      throw this._unexpected(this._pos)
    }
    return ast
  }

  _sequence(): AstNodeUnion {
    const first = this._assignment()
    if (this._peek()?.type !== 'semicolon') {
      return first
    }
    const expressions: AstNode[] = [first]
    while (this._eat('semicolon')) {
      const next = this._peek()
      if (!next || next.type === 'closeParen') {
        break
      }
      expressions.push(this._assignment())
    }
    return { type: 'SequenceExpression', expressions }
  }

  _assignment(): AstNodeUnion {
    const left = this._ternary()
    const token = this._peek()
    if (token?.type !== 'binaryOp' || token.value !== '=') {
      return left
    }
    if (left.type !== 'Identifier' || left.from) {
      throw new Error('Left side of assignment must be a variable name')
    }
    this._pos++
    return {
      type: 'AssignmentExpression',
      operator: '=',
      left,
      right: this._assignment()
    }
  }

  _ternary(): AstNodeUnion {
    const test = this._binary(-Infinity)
    if (!this._eat('question')) {
      return test
    }
    const node: ConditionalExpression = { type: 'ConditionalExpression', test }
    if (!this._eat('colon')) {
      node.consequent = this._assignment()
      this._expect('colon')
    }
    const next = this._peek()
    if (next && !omittedAlternateBefore.has(next.type)) {
      node.alternate = this._assignment()
    }
    return node
  }

  /**
   * Parses operands joined by binary operators that bind tighter than `floor`.
   * One exactly at `floor` binds only when it continues a right-associative
   * chain, which is how `a ^ b ^ c` groups from the right.
   */
  _binary(floor: number, rightAssociative = false): AstNodeUnion {
    let left = this._unary()
    for (;;) {
      const token = this._peek()
      if (token?.type !== 'binaryOp' || token.value === '=') {
        return left
      }
      const operator = token.value as string
      const op = this._grammar.elements[operator]!
      if (
        op.type !== 'binaryOp' ||
        op.precedence < floor ||
        (op.precedence === floor && !(rightAssociative && op.rightAssociative))
      ) {
        return left
      }
      this._pos++
      left = {
        type: 'BinaryExpression',
        operator,
        left,
        right: this._binary(op.precedence, op.rightAssociative)
      }
    }
  }

  _unary(): AstNodeUnion {
    const token = this._peek()
    if (token?.type !== 'unaryOp') {
      return this._postfix(this._primary())
    }
    this._pos++
    const operator = token.value as string
    const op = this._grammar.elements[operator]
    return {
      type: 'UnaryExpression',
      operator,
      right: this._binary(op?.type === 'unaryOp' ? op.precedence : Infinity)
    }
  }

  _postfix(subject: AstNodeUnion): AstNodeUnion {
    let node = subject
    for (;;) {
      switch (this._peek()?.type) {
        case 'dot': {
          this._pos++
          node = {
            type: 'Identifier',
            value: this._expect('identifier').value as string,
            from: node
          }
          break
        }
        case 'openBracket': {
          this._pos++
          const expr = this._assignment()
          this._expect('closeBracket')
          node = { type: 'FilterExpression', expr, subject: node }
          break
        }
        case 'openParen': {
          if (
            node.type !== 'Identifier' ||
            this._tokens[this._pos - 1]!.type !== 'identifier'
          ) {
            throw this._error('Functions must be called by name', this._pos)
          }
          this._pos++
          const { from, value } = node
          const args = this._list('closeParen')
          node = {
            type: 'FunctionCall',
            name: value,
            args: from ? [from, ...args] : args
          }
          break
        }
        default: {
          return node
        }
      }
    }
  }

  _primary(): AstNodeUnion {
    const token = this._next()
    switch (token.type) {
      case 'literal': {
        return {
          type: 'Literal',
          value: token.value as string | number | boolean
        }
      }
      case 'identifier': {
        return { type: 'Identifier', value: token.value as string }
      }
      case 'templateString': {
        return this._template(token.value as TemplatePart[])
      }
      case 'openParen': {
        const node = this._sequence()
        this._expect('closeParen')
        return node
      }
      case 'openBracket': {
        return { type: 'ArrayLiteral', value: this._list('closeBracket') }
      }
      case 'openCurl': {
        return this._object()
      }
      case 'dot': {
        throw this._error('Relative paths are not supported', this._pos - 1)
      }
      default: {
        throw this._unexpected(this._pos - 1)
      }
    }
  }

  _list(close: string): AstNode[] {
    const items: AstNode[] = []
    while (!this._eat(close)) {
      items.push(this._assignment())
      if (!this._eat('comma')) {
        this._expect(close)
        break
      }
    }
    return items
  }

  _object(): ObjectLiteral {
    const node: ObjectLiteral = { type: 'ObjectLiteral', value: {} }
    while (!this._eat('closeCurl')) {
      const key = this._next()
      if (key.type !== 'identifier' && key.type !== 'literal') {
        throw this._unexpected(this._pos - 1)
      }
      this._expect('colon')
      // defined rather than assigned, so that "__proto__" is an ordinary key
      Object.defineProperty(node.value, String(key.value as Literal['value']), {
        value: this._assignment(),
        writable: true,
        enumerable: true,
        configurable: true
      })
      if (!this._eat('comma')) {
        this._expect('closeCurl')
        break
      }
    }
    return node
  }

  _template(tokenParts: TemplatePart[]): TemplateLiteral {
    const parts: TemplateLiteral['parts'] = tokenParts.map((part) => {
      if (part.type === 'static') {
        return {
          type: 'static',
          value: this._lexer._unescapeTemplateString(part.value)
        }
      }
      const value = new Parser(this._grammar, this._lexer).parse(part.value)
      if (!value) {
        throw new Error('Empty interpolation in template string')
      }
      return { type: 'expression', value }
    })
    return { type: 'TemplateLiteral', parts }
  }

  _peek(): Token | undefined {
    return this._tokens[this._pos]
  }

  _next(): Token {
    const token = this._tokens[this._pos]
    if (!token) {
      throw this._error('Unexpected end of expression', this._pos)
    }
    this._pos++
    return token
  }

  _eat(type: string) {
    if (this._tokens[this._pos]?.type !== type) {
      return false
    }
    this._pos++
    return true
  }

  _expect(type: string): Token {
    const token = this._next()
    if (token.type !== type) {
      throw this._unexpected(this._pos - 1)
    }
    return token
  }

  _unexpected(index: number) {
    const { raw, type } = this._tokens[index]!
    return this._error(`Token ${raw} (${type}) unexpected in expression`, index)
  }

  _error(message: string, index: number) {
    const source = this._tokens
      .slice(0, index + 1)
      .map((token) => token.raw)
      .join('')
    return new Error(`${message}: ${source}`)
  }
}

export default Parser
