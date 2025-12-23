/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

export interface Token {
  type: string
  value: any
  raw: string
}

export interface AstNode {
  type: string
  _parent?: AstNode
}

export interface Literal extends AstNode {
  type: 'Literal'
  value: string | number | boolean
}

export interface Identifier extends AstNode {
  type: 'Identifier'
  value: string
  from?: AstNode
  relative?: boolean
}

export interface BinaryExpression extends AstNode {
  type: 'BinaryExpression'
  operator: string
  left: AstNode
  right?: AstNode
}

export interface UnaryExpression extends AstNode {
  type: 'UnaryExpression'
  operator: string
  right?: AstNode
}

export interface ArrayLiteral extends AstNode {
  type: 'ArrayLiteral'
  value: AstNode[]
}

export interface ObjectLiteral extends AstNode {
  type: 'ObjectLiteral'
  value: {
    [key: string]: AstNode
  }
}

export interface FunctionCall extends AstNode {
  type: 'FunctionCall'
  name: string
  args: AstNode[]
  pool: 'functions' | 'transforms'
}

export interface FilterExpression extends AstNode {
  type: 'FilterExpression'
  expr: AstNode
  relative: boolean
  subject: AstNode
}

export interface ConditionalExpression extends AstNode {
  type: 'ConditionalExpression'
  test: AstNode
  consequent?: AstNode
  alternate?: AstNode
}
