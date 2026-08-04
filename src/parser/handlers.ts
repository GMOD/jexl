/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { precedenceOf } from '../grammar.ts'

import type {
  ArrayLiteral,
  AssignmentExpression,
  AstNode,
  BinaryExpression,
  ConditionalExpression,
  FilterExpression,
  FunctionCall,
  Identifier,
  Literal,
  ObjectLiteral,
  TemplateLiteral,
  Token,
  UnaryExpression
} from '../types.ts'
import type Parser from './Parser.ts'

/**
 * Handles a subexpression that's used to define a transform argument's value.
 * @param {{type: <string>}} ast The subexpression tree
 */
export function argVal(this: Parser, ast: AstNode | null) {
  if (ast) {
    ;(this._cursor as FunctionCall).args.push(ast)
  }
}

/**
 * Handles new array literals by adding them as a new node in the AST,
 * initialized with an empty array.
 */
export function arrayStart(this: Parser) {
  const node: ArrayLiteral = {
    type: 'ArrayLiteral',
    value: []
  }
  this._placeAtCursor(node)
}

/**
 * Handles a subexpression representing an element of an array literal.
 * @param {{type: <string>}} ast The subexpression tree
 */
export function arrayVal(this: Parser, ast: AstNode | null) {
  if (ast) {
    ;(this._cursor as ArrayLiteral).value.push(ast)
  }
}

/**
 * Handles tokens of type 'binaryOp', indicating an operation that has two
 * inputs: a left side and a right side.
 * @param {{type: <string>}} token A token object
 */
export function binaryOp(this: Parser, token: Token) {
  if (token.value === '=') {
    if (this._cursor?.type !== 'Identifier') {
      throw new Error('Left side of assignment must be a variable name')
    }

    const node: AssignmentExpression = {
      type: 'AssignmentExpression',
      operator: '=',
      left: this._cursor as Identifier
    }
    this._cursor = this._cursor._parent
    this._placeAtCursor(node)
    return
  }

  const tokenValue = token.value as string
  const precedence = precedenceOf(this._grammar.elements[tokenValue])
  let parent = this._cursor?._parent
  while (parent) {
    const parentExpr = parent as BinaryExpression
    if (!parentExpr.operator) {
      break
    }
    if (
      precedenceOf(this._grammar.elements[parentExpr.operator]) < precedence
    ) {
      break
    }
    this._cursor = parent
    parent = parent._parent
  }
  const node: BinaryExpression = {
    type: 'BinaryExpression',
    operator: tokenValue,
    left: this._cursor!
  }
  this._setParent(this._cursor!, node)
  this._cursor = parent
  this._placeAtCursor(node)
}

/**
 * Handles successive nodes in an identifier chain.  More specifically, it
 * sets values that determine how the following identifier gets placed in the
 * AST.
 */
export function dot(this: Parser) {
  const isBinaryExprWithRight = (node: AstNode) =>
    node.type === 'BinaryExpression' && (node as BinaryExpression).right

  this._nextIdentEncapsulate =
    !!this._cursor &&
    this._cursor.type !== 'UnaryExpression' &&
    (this._cursor.type !== 'BinaryExpression' ||
      !!isBinaryExprWithRight(this._cursor))

  this._nextIdentRelative = !this._cursor || !this._nextIdentEncapsulate
  if (this._nextIdentRelative) {
    this._relative = true
  }
}

/**
 * Handles a subexpression used for filtering an array returned by an
 * identifier chain.
 * @param {{type: <string>}} ast The subexpression tree
 */
export function filter(this: Parser, ast: AstNode | null) {
  const node: FilterExpression = {
    type: 'FilterExpression',
    expr: ast!,
    relative: this._subParser!.isRelative(),
    subject: this._cursor!
  }
  this._placeBeforeCursor(node)
}

/**
 * Handles identifier tokens when used to indicate the name of a function to
 * be called.
 * @param {{type: <string>}} token A token object
 */
export function functionCall(this: Parser) {
  const node: FunctionCall = {
    type: 'FunctionCall',
    name: (this._cursor as Identifier).value,
    args: [],
    pool: 'functions'
  }
  this._placeBeforeCursor(node)
}

/**
 * Handles identifier tokens by adding them as a new node in the AST.
 * @param {{type: <string>}} token A token object
 */
export function identifier(this: Parser, token: Token) {
  const node: Identifier = {
    type: 'Identifier',
    value: token.value as string
  }
  if (this._nextIdentEncapsulate) {
    node.from = this._cursor!
    this._placeBeforeCursor(node)
    this._nextIdentEncapsulate = false
  } else {
    if (this._nextIdentRelative) {
      node.relative = true
      this._nextIdentRelative = false
    }
    this._placeAtCursor(node)
  }
}

/**
 * Handles literal values, such as strings, booleans, and numerics, by adding
 * them as a new node in the AST.
 * @param {{type: <string>}} token A token object
 */
export function literal(this: Parser, token: Token) {
  const node: Literal = {
    type: 'Literal',
    value: token.value as string | number | boolean
  }
  this._placeAtCursor(node)
}

/**
 * Handles template string tokens by parsing their interpolation expressions
 * and creating a TemplateLiteral AST node.
 * @param {{type: <string>}} token A token object
 */
export function templateString(this: Parser, token: Token) {
  const parts: TemplateLiteral['parts'] = []
  const tokenParts = Array.isArray(token.value) ? token.value : []

  for (const part of tokenParts) {
    if (part.type === 'static') {
      parts.push({
        type: 'static',
        value: this._lexer._unescapeTemplateString(part.value)
      })
    } else {
      const subTokens = this._lexer.tokenize(part.value)
      const ParserClass = this.constructor as new (
        grammar: typeof this._grammar,
        lexer: typeof this._lexer
      ) => Parser
      const subParser = new ParserClass(this._grammar, this._lexer)
      subParser.addTokens(subTokens)
      const subAst = subParser.complete()

      if (!subAst) {
        throw new Error('Empty interpolation in template string')
      }

      parts.push({
        type: 'expression',
        value: subAst
      })
    }
  }

  const node: TemplateLiteral = {
    type: 'TemplateLiteral',
    parts
  }
  this._placeAtCursor(node)
}

/**
 * Queues a new object literal key to be written once a value is collected.
 * @param {{type: <string>}} token A token object
 */
export function objKey(this: Parser, token: Token) {
  this._curObjKey = token.value as string
}

/**
 * Handles new object literals by adding them as a new node in the AST,
 * initialized with an empty object.
 */
export function objStart(this: Parser) {
  const node: ObjectLiteral = {
    type: 'ObjectLiteral',
    value: {}
  }
  this._placeAtCursor(node)
}

/**
 * Handles an object value by adding its AST to the queued key on the object
 * literal node currently at the cursor.
 * @param {{type: <string>}} ast The subexpression tree
 */
export function objVal(this: Parser, ast: AstNode | null) {
  ;(this._cursor as ObjectLiteral).value[this._curObjKey!] = ast!
}

/**
 * Handles traditional subexpressions, delineated with the groupStart and
 * groupEnd elements.
 * @param {{type: <string>}} ast The subexpression tree
 */
export function subExpression(this: Parser, ast: AstNode | null) {
  this._placeAtCursor(ast!)
}

/**
 * Handles a completed alternate subexpression of a ternary operator.
 * @param {{type: <string>}} ast The subexpression tree
 */
export function ternaryEnd(this: Parser, ast: AstNode | null) {
  ;(this._cursor as ConditionalExpression).alternate = ast ?? undefined
}

/**
 * Handles a completed consequent subexpression of a ternary operator.
 * @param {{type: <string>}} ast The subexpression tree
 */
export function ternaryMid(this: Parser, ast: AstNode | null) {
  ;(this._cursor as ConditionalExpression).consequent = ast ?? undefined
}

/**
 * Handles the start of a new ternary expression by encapsulating the entire
 * AST in a ConditionalExpression node, and using the existing tree as the
 * test element.
 */
export function ternaryStart(this: Parser) {
  const node: ConditionalExpression = {
    type: 'ConditionalExpression',
    test: this._tree!
  }
  this._tree = node
  this._cursor = this._tree
}

/**
 * Handles token of type 'unaryOp', indicating that the operation has only
 * one input: a right side.
 * @param {{type: <string>}} token A token object
 */
export function unaryOp(this: Parser, token: Token) {
  const node: UnaryExpression = {
    type: 'UnaryExpression',
    operator: token.value as string
  }
  this._placeAtCursor(node)
}

/**
 * Handles semicolon separator between expressions
 */
export function semicolon(this: Parser) {
  if (!this._sequenceExpressions) {
    this._sequenceExpressions = [this._tree!]
  } else {
    this._sequenceExpressions.push(this._tree!)
  }

  this._tree = null
  this._cursor = null
  this._state = 'expectOperand'
}
