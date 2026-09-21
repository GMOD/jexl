/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { AstNode, AstNodeUnion, BinaryExpression } from './types.ts'

type Node = AstNodeUnion

const PRECEDENCE: Record<string, number> = {
  '=': 2,
  '||': 10,
  '??': 10,
  '&&': 11,
  '==': 20,
  '!=': 20,
  '~': 20,
  '!~': 20,
  '<': 20,
  '<=': 20,
  '>': 20,
  '>=': 20,
  in: 20,
  '+': 30,
  '-': 30,
  '*': 40,
  '/': 40,
  '//': 40,
  '%': 50,
  '^': 50
}

const RIGHT_ASSOCIATIVE = new Set(['^'])
const LOGICAL = new Set(['||', '&&'])

// how tightly each form binds, mirroring the Parser's levels: `;`, then `=`
// and lambdas, then `?:`, then binary operators, then prefix operators
const SEQUENCE = 0
const ASSIGNMENT = 1
const CONDITIONAL = 2
const CUSTOM_BINARY = 3
const UNARY = 100

const letter = String.raw`a-zA-Zа-яА-Я_À-ÖØ-öø-ÿ$`
const IDENTIFIER = new RegExp(`^[${letter}][${letter}0-9]*$`)
const WORDS = new Set(['in', 'true', 'false', 'null'])

export function isName(text: string) {
  return IDENTIFIER.test(text) && !WORDS.has(text)
}

export function key(name: string) {
  return isName(name) ? `.${name}` : `[${quote(name)}]`
}

export function quote(text: string) {
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", String.raw`\'`)}'`
}

function precedenceOf(node: Node) {
  switch (node.type) {
    case 'SequenceExpression': {
      return SEQUENCE
    }
    case 'AssignmentExpression':
    case 'Lambda': {
      return ASSIGNMENT
    }
    case 'ConditionalExpression': {
      // with no alternate, it ends only before `)`, `]`, `}`, `,`, `;` or the end
      return node.alternate ? CONDITIONAL : SEQUENCE
    }
    case 'BinaryExpression': {
      return PRECEDENCE[node.operator] ?? CUSTOM_BINARY
    }
    case 'UnaryExpression': {
      return UNARY
    }
    default: {
      return Infinity
    }
  }
}

function within(ast: AstNode, least: number) {
  const text = print(ast)
  return precedenceOf(ast as Node) < least ? `(${text})` : text
}

function binaryOperand(parent: BinaryExpression, ast: AstNode, left: boolean) {
  const own = PRECEDENCE[parent.operator]
  if (own === undefined) {
    return within(ast, UNARY)
  }
  const child = ast as Node
  const theirs = precedenceOf(child)
  const chained =
    child.type === 'BinaryExpression' &&
    RIGHT_ASSOCIATIVE.has(parent.operator) &&
    RIGHT_ASSOCIATIVE.has(child.operator)
  const mixesNullish =
    child.type === 'BinaryExpression' &&
    ((parent.operator === '??' && LOGICAL.has(child.operator)) ||
      (child.operator === '??' && LOGICAL.has(parent.operator)))
  const text = print(ast)
  return theirs < own || (theirs === own && left === chained) || mixesNullish
    ? `(${text})`
    : text
}

/**
 * Renders a tree back to expression text, for messages and suggestions. The
 * text parses back to the same tree.
 */
export function print(ast: AstNode): string {
  const node = ast as Node
  switch (node.type) {
    case 'Literal': {
      const { value } = node
      return typeof value === 'string'
        ? quote(value)
        : Object.is(value, -0)
          ? '-0'
          : String(value)
    }
    case 'Identifier': {
      return node.from
        ? within(node.from, Infinity) + key(node.value)
        : node.value
    }
    case 'FilterExpression': {
      return `${within(node.subject, Infinity)}[${within(node.expr, ASSIGNMENT)}]`
    }
    case 'BinaryExpression': {
      return `${binaryOperand(node, node.left, true)} ${node.operator} ${binaryOperand(node, node.right!, false)}`
    }
    case 'UnaryExpression': {
      const { operator } = node
      const right = within(node.right!, UNARY)
      // the Lexer folds a minus before a digit into the number
      if (operator === '-' && /^\d/.test(right)) {
        return `-(${right})`
      }
      return IDENTIFIER.test(operator)
        ? `${operator} ${right}`
        : operator + right
    }
    case 'ConditionalExpression': {
      const test = within(node.test, CUSTOM_BINARY)
      const consequent = node.consequent
        ? ` ${within(node.consequent, ASSIGNMENT)} `
        : ''
      const alternate = node.alternate
        ? ` ${within(node.alternate, ASSIGNMENT)}`
        : ''
      return `${test} ?${consequent}:${alternate}`
    }
    case 'FunctionCall': {
      const args = node.args.map((arg) => within(arg, ASSIGNMENT))
      return `${node.name}(${args.join(', ')})`
    }
    case 'ArrayLiteral': {
      const items = node.value.map((item) => within(item, ASSIGNMENT))
      return `[${items.join(', ')}]`
    }
    case 'ObjectLiteral': {
      const entries = Object.entries(node.value).map(
        ([name, value]) =>
          `${isName(name) ? name : quote(name)}: ${within(value, ASSIGNMENT)}`
      )
      return `{${entries.join(', ')}}`
    }
    case 'TemplateLiteral': {
      const parts = node.parts.map((part) =>
        part.type === 'static'
          ? part.value
              .replaceAll('\\', '\\\\')
              .replaceAll('`', '\\`')
              .replaceAll('${', '\\${')
          : `\${${print(part.value)}}`
      )
      return `\`${parts.join('')}\``
    }
    case 'SequenceExpression': {
      const { expressions } = node
      const text = expressions
        .map((expr) => within(expr, ASSIGNMENT))
        .join('; ')
      return expressions.length === 1 ? `${text};` : text
    }
    case 'AssignmentExpression': {
      return `${node.left.value} = ${within(node.right!, ASSIGNMENT)}`
    }
    case 'Lambda': {
      const params =
        node.params.length === 1
          ? node.params[0]
          : `(${node.params.join(', ')})`
      return `${params} => ${within(node.body, ASSIGNMENT)}`
    }
    default: {
      return '?'
    }
  }
}
