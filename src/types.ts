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
  | JexlFunction

/** What a lambda evaluates to, for a registered function to call. */
export type JexlFunction = (...args: JexlValue[]) => JexlValue

export interface Token {
  type: string
  value: string | number | boolean | null | TemplatePart[]
  raw: string
}

export interface Literal {
  type: 'Literal'
  value: string | number | boolean | null
}

export interface Identifier {
  type: 'Identifier'
  value: string
  from?: AstNode
}

export interface BinaryExpression {
  type: 'BinaryExpression'
  operator: string
  left: AstNode
  right: AstNode
}

export interface UnaryExpression {
  type: 'UnaryExpression'
  operator: string
  right: AstNode
}

export interface ArrayLiteral {
  type: 'ArrayLiteral'
  value: AstNode[]
}

export interface ObjectLiteral {
  type: 'ObjectLiteral'
  value: Record<string, AstNode>
}

export type TemplateLiteralPart =
  | { type: 'static'; value: string }
  | { type: 'expression'; value: AstNode }

export interface TemplateLiteral {
  type: 'TemplateLiteral'
  parts: TemplateLiteralPart[]
}

export interface FunctionCall {
  type: 'FunctionCall'
  name: string
  args: AstNode[]
}

export interface FilterExpression {
  type: 'FilterExpression'
  expr: AstNode
  subject: AstNode
}

export interface ConditionalExpression {
  type: 'ConditionalExpression'
  test: AstNode
  consequent?: AstNode
  alternate?: AstNode
}

export interface SequenceExpression {
  type: 'SequenceExpression'
  expressions: AstNode[]
}

export interface AssignmentExpression {
  type: 'AssignmentExpression'
  operator: '='
  left: Identifier
  right: AstNode
}

export interface Lambda {
  type: 'Lambda'
  params: string[]
  body: AstNode
}

export type AstNode =
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
  | Lambda

export type NodeByType<T extends AstNode['type']> = Extract<
  AstNode,
  { type: T }
>
