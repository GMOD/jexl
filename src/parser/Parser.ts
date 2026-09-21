/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { JexlSyntaxError } from '../errors.ts'

import type Lexer from '../Lexer.ts'
import type { Grammar } from '../grammar.ts'
import type {
  AstNode,
  AstNodeUnion,
  ConditionalExpression,
  Lambda,
  Literal,
  ObjectLiteral,
  TemplateLiteral,
  TemplatePart,
  Token
} from '../types.ts'

const logical = new Set(['&&', '||'])

const omittedAlternateBefore = new Set([
  'closeParen',
  'closeBracket',
  'closeCurl',
  'comma',
  'semicolon'
])

export { JexlSyntaxError } from '../errors.ts'

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
  _offset: number
  _grouped?: WeakSet<AstNode>
  _lambdaDepth = 0

  /**
   * @param offset where the tokens start in the source, so that an error
   *      inside a template interpolation reports its place in the whole
   */
  constructor(grammar: Grammar, lexer: Lexer, offset = 0) {
    this._grammar = grammar
    this._lexer = lexer
    this._offset = offset
  }

  parse(source: string) {
    const start = this._offset
    this._offset += source.length - source.trimStart().length
    try {
      this.addTokens(this._lexer.tokenize(source))
    } catch (error) {
      if (error instanceof JexlSyntaxError) {
        error.offset += start
      }
      throw error
    }
    return this.complete()
  }

  addTokens(tokens: Token[]) {
    this._tokens = this._tokens.concat(tokens)
  }

  /**
   * @returns the expression tree, or null for an expression with no tokens
   * @throws {JexlSyntaxError} if the tokens do not form exactly one expression
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
    if (this._atLambda()) {
      return this._lambda()
    }
    const left = this._ternary()
    const token = this._peek()
    if (token?.type !== 'binaryOp' || token.value !== '=') {
      return left
    }
    if (left.type !== 'Identifier' || left.from) {
      throw this._error(
        'Left side of assignment must be a variable name',
        this._pos
      )
    }
    if (this._lambdaDepth > 0) {
      throw this._error('Assignment is not supported in a lambda', this._pos)
    }
    this._pos++
    return {
      type: 'AssignmentExpression',
      operator: '=',
      left,
      right: this._assignment()
    }
  }

  _atLambda() {
    let i = this._pos
    if (this._tokens[i]?.type === 'identifier') {
      return this._tokens[i + 1]?.type === 'arrow'
    }
    if (this._tokens[i]?.type !== 'openParen') {
      return false
    }
    i++
    while (this._tokens[i]?.type === 'identifier') {
      i++
      if (this._tokens[i]?.type !== 'comma') {
        break
      }
      i++
    }
    return (
      this._tokens[i]?.type === 'closeParen' &&
      this._tokens[i + 1]?.type === 'arrow'
    )
  }

  /** Parses the lambda {@link _atLambda} found, whose shape it has checked. */
  _lambda(): Lambda {
    const params: string[] = []
    if (this._eat('openParen')) {
      while (!this._eat('closeParen')) {
        params.push(this._next().value as string)
        this._eat('comma')
      }
    } else {
      params.push(this._next().value as string)
    }
    if (new Set(params).size < params.length) {
      throw this._error('Duplicate lambda parameter name', this._pos)
    }
    this._pos++
    this._lambdaDepth++
    const body = this._assignment()
    this._lambdaDepth--
    return { type: 'Lambda', params, body }
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
      const at = this._pos++
      const right = this._binary(op.precedence, op.rightAssociative)
      if (this._mixesNullish(operator, left, right)) {
        throw this._error('Parenthesize ?? when mixing it with && or ||', at)
      }
      left = { type: 'BinaryExpression', operator, left, right }
    }
  }

  /** `a ?? b || c` has no grouping a reader can guess; JS refuses it too. */
  _mixesNullish(operator: string, ...operands: AstNodeUnion[]) {
    return operands.some(
      (operand) =>
        operand.type === 'BinaryExpression' &&
        !this._grouped?.has(operand) &&
        (operator === '??'
          ? logical.has(operand.operator)
          : logical.has(operator) && operand.operator === '??')
    )
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
        return this._template(token.value as TemplatePart[], this._pos - 1)
      }
      case 'openParen': {
        const node = this._sequence()
        this._expect('closeParen')
        this._grouped ??= new WeakSet()
        this._grouped.add(node)
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

  _template(tokenParts: TemplatePart[], index: number): TemplateLiteral {
    let offset = this._offsetOf(index) + '`'.length
    const parts: TemplateLiteral['parts'] = tokenParts.map((part) => {
      if (part.type === 'static') {
        offset += part.value.length
        return {
          type: 'static',
          value: this._lexer._unescapeTemplateString(part.value)
        }
      }
      const start = offset + '${'.length
      offset = start + part.value.length + '}'.length
      const sub = new Parser(this._grammar, this._lexer, start)
      sub._lambdaDepth = this._lambdaDepth
      const value = sub.parse(part.value)
      if (!value) {
        throw new JexlSyntaxError(
          'Empty interpolation in template string',
          start
        )
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
    return new JexlSyntaxError(`${message}: ${source}`, this._offsetOf(index))
  }

  _offsetOf(index: number) {
    let offset = this._offset
    for (let i = 0; i < index; i++) {
      offset += this._tokens[i]!.raw.length
    }
    return offset
  }
}

export default Parser
