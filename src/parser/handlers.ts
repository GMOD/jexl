/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { AstNode, Token } from '../types'
import type Parser from './Parser'

/**
 * Handles a subexpression that's used to define a transform argument's value.
 * @param {{type: <string>}} ast The subexpression tree
 */
export function argVal(this: Parser, ast: AstNode | null) {
  if (ast) (this._cursor as any).args.push(ast)
}

/**
 * Handles new array literals by adding them as a new node in the AST,
 * initialized with an empty array.
 */
export function arrayStart(this: Parser) {
  this._placeAtCursor({
    type: 'ArrayLiteral',
    value: []
  } as any)
}

/**
 * Handles a subexpression representing an element of an array literal.
 * @param {{type: <string>}} ast The subexpression tree
 */
export function arrayVal(this: Parser, ast: AstNode | null) {
  if (ast) {
    (this._cursor as any).value.push(ast)
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

    const node: any = {
      type: 'AssignmentExpression',
      operator: '=',
      left: this._cursor
    }
    this._cursor = this._cursor._parent
    this._placeAtCursor(node)
    return
  }

  const precedence = (this._grammar.elements[token.value] as any).precedence || 0
  let parent = this._cursor?._parent
  while (
    parent &&
    (parent as any).operator &&
    (this._grammar.elements[(parent as any).operator] as any).precedence >= precedence
  ) {
    this._cursor = parent
    parent = parent._parent
  }
  const node: any = {
    type: 'BinaryExpression',
    operator: token.value,
    left: this._cursor
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
    node.type === 'BinaryExpression' && (node as any).right

  this._nextIdentEncapsulate =
    this._cursor &&
    this._cursor.type !== 'UnaryExpression' &&
    (this._cursor.type !== 'BinaryExpression' || isBinaryExprWithRight(this._cursor))

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
  this._placeBeforeCursor({
    type: 'FilterExpression',
    expr: ast,
    relative: this._subParser!.isRelative(),
    subject: this._cursor
  } as any)
}

/**
 * Handles identifier tokens when used to indicate the name of a function to
 * be called.
 * @param {{type: <string>}} token A token object
 */
export function functionCall(this: Parser) {
  this._placeBeforeCursor({
    type: 'FunctionCall',
    name: (this._cursor as any).value,
    args: [],
    pool: 'functions'
  } as any)
}

/**
 * Handles identifier tokens by adding them as a new node in the AST.
 * @param {{type: <string>}} token A token object
 */
export function identifier(this: Parser, token: Token) {
  const node: any = {
    type: 'Identifier',
    value: token.value
  }
  if (this._nextIdentEncapsulate) {
    node.from = this._cursor
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
  this._placeAtCursor({
    type: 'Literal',
    value: token.value
  } as any)
}

/**
 * Queues a new object literal key to be written once a value is collected.
 * @param {{type: <string>}} token A token object
 */
export function objKey(this: Parser, token: Token) {
  this._curObjKey = token.value
}

/**
 * Handles new object literals by adding them as a new node in the AST,
 * initialized with an empty object.
 */
export function objStart(this: Parser) {
  this._placeAtCursor({
    type: 'ObjectLiteral',
    value: {}
  } as any)
}

/**
 * Handles an object value by adding its AST to the queued key on the object
 * literal node currently at the cursor.
 * @param {{type: <string>}} ast The subexpression tree
 */
export function objVal(this: Parser, ast: AstNode | null) {
  (this._cursor as any).value[this._curObjKey!] = ast
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
  (this._cursor as any).alternate = ast
}

/**
 * Handles a completed consequent subexpression of a ternary operator.
 * @param {{type: <string>}} ast The subexpression tree
 */
export function ternaryMid(this: Parser, ast: AstNode | null) {
  (this._cursor as any).consequent = ast
}

/**
 * Handles the start of a new ternary expression by encapsulating the entire
 * AST in a ConditionalExpression node, and using the existing tree as the
 * test element.
 */
export function ternaryStart(this: Parser) {
  this._tree = {
    type: 'ConditionalExpression',
    test: this._tree
  } as any
  this._cursor = this._tree
}

/**
 * Handles identifier tokens when used to indicate the name of a transform to
 * be applied.
 * @param {{type: <string>}} token A token object
 */
export function transform(this: Parser, token: Token) {
  this._placeBeforeCursor({
    type: 'FunctionCall',
    name: token.value,
    args: [this._cursor],
    pool: 'transforms'
  } as any)
}

/**
 * Handles token of type 'unaryOp', indicating that the operation has only
 * one input: a right side.
 * @param {{type: <string>}} token A token object
 */
export function unaryOp(this: Parser, token: Token) {
  this._placeAtCursor({
    type: 'UnaryExpression',
    operator: token.value
  } as any)
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
