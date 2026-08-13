/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

export interface TemplatePart {
  type: 'static' | 'interpolation'
  value: string
}

export type JexlValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JexlValue[]
  | { [key: string]: JexlValue }

export interface Token {
  type: string
  value: string | number | boolean | TemplatePart[]
  raw: string
}

export interface AstNode {
  type: string
  _parent?: AstNode
  right?: AstNode
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
  value: Record<string, AstNode>
}

export type TemplateLiteralPart =
  | { type: 'static'; value: string }
  | { type: 'expression'; value: AstNode }

export interface TemplateLiteral extends AstNode {
  type: 'TemplateLiteral'
  parts: TemplateLiteralPart[]
}

export interface FunctionCall extends AstNode {
  type: 'FunctionCall'
  name: string
  args: AstNode[]
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

export interface SequenceExpression extends AstNode {
  type: 'SequenceExpression'
  expressions: AstNode[]
}

export interface AssignmentExpression extends AstNode {
  type: 'AssignmentExpression'
  operator: '='
  left: Identifier
}

export type AstNodeUnion =
  | Literal
  | Identifier
  | BinaryExpression
  | UnaryExpression
  | ArrayLiteral
  | ObjectLiteral
  | TemplateLiteral
  | FunctionCall
  | FilterExpression
  | ConditionalExpression
  | SequenceExpression
  | AssignmentExpression

export type NodeByType<T extends AstNodeUnion['type']> = Extract<
  AstNodeUnion,
  { type: T }
>
