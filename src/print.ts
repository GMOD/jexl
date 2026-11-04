/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { identRegex } from './Lexer.ts'
import { COMPARISONS, getGrammar } from './grammar.ts'

import type { AstNode, BinaryExpression, Literal } from './types.ts'

const { elements } = getGrammar()

// print knows where only the built-in operators bind, so a host's own ones
// print with their operands parenthesized
function builtIn(operator: string) {
  const element = elements[operator]
  return element?.type === 'binaryOp' ? element : undefined
}

const LOGICAL = new Set(['||', '&&'])

// how tightly each form binds, mirroring the Parser's levels: `;`, then `=`
// and lambdas, then `?:`, then binary operators, then prefix operators
const SEQUENCE = 0
const ASSIGNMENT = 1
const CONDITIONAL = 2
const CUSTOM_BINARY = 3
const UNARY = 100
const COMPARISON = builtIn('<')!.precedence

const WORDS = new Set([
  'true',
  'false',
  'null',
  ...Object.keys(elements).filter((word) => identRegex.test(word))
])

export function isName(text: string) {
  return identRegex.test(text) && !WORDS.has(text)
}

export function key(name: string) {
  return isName(name) ? `.${name}` : `[${quote(name)}]`
}

export function quote(text: string) {
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", String.raw`\'`)}'`
}

function precedenceOf(node: AstNode) {
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
      return builtIn(node.operator)?.precedence ?? CUSTOM_BINARY
    }
    case 'ComparisonChain': {
      return COMPARISON
    }
    case 'UnaryExpression': {
      return UNARY
    }
    default: {
      return Infinity
    }
  }
}

function within(node: AstNode, least: number) {
  const text = print(node)
  return precedenceOf(node) < least ? `(${text})` : text
}

function isSigned(node: AstNode) {
  return (
    node.type === 'UnaryExpression' ||
    (node.type === 'Literal' &&
      typeof node.value === 'number' &&
      (node.value < 0 || Object.is(node.value, -0)))
  )
}

function binaryOperand(
  parent: BinaryExpression,
  child: AstNode,
  left: boolean
) {
  const op = builtIn(parent.operator)
  // a prefix operator's operand runs on through `^`, and through a host's
  // operator, which may group from the right too
  if (left && (!op || op.rightAssociative) && isSigned(child)) {
    return `(${print(child)})`
  }
  if (!op) {
    return within(child, UNARY)
  }
  const own = op.precedence
  const theirs = precedenceOf(child)
  const chained =
    child.type === 'BinaryExpression' &&
    !!op.rightAssociative &&
    !!builtIn(child.operator)?.rightAssociative
  const mixesNullish =
    child.type === 'BinaryExpression' &&
    ((parent.operator === '??' && LOGICAL.has(child.operator)) ||
      (child.operator === '??' && LOGICAL.has(parent.operator)))
  // `(a < b) < c` would print as a chain, which is a range test
  const comparesComparison = theirs === own && COMPARISONS.has(parent.operator)
  const text = print(child)
  return theirs < own ||
    (theirs === own && left === chained) ||
    mixesNullish ||
    comparesComparison
    ? `(${text})`
    : text
}

/**
 * Renders a tree back to expression text, for messages and suggestions. The
 * text parses back to the same tree.
 */
export function print(node: AstNode): string {
  switch (node.type) {
    case 'Literal': {
      const { value } = node
      if (typeof value === 'string') {
        return quote(value)
      }
      // a number too large for a double reads as Infinity, which is a name
      return Object.is(value, -0)
        ? '-0'
        : value === Infinity
          ? '1e999'
          : value === -Infinity
            ? '-1e999'
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
      return `${binaryOperand(node, node.left, true)} ${node.operator} ${binaryOperand(node, node.right, false)}`
    }
    case 'ComparisonChain': {
      return node.operands
        .map((operand, i) => {
          const text = within(operand, COMPARISON + 1)
          return i === 0 ? text : ` ${node.operators[i - 1]} ${text}`
        })
        .join('')
    }
    case 'UnaryExpression': {
      const { operator } = node
      const right = within(node.right, UNARY)
      // the Lexer folds a minus before a digit into the number
      if (operator === '-' && /^\d/.test(right)) {
        return `-(${right})`
      }
      return identRegex.test(operator)
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
      return `${node.left.value} = ${within(node.right, ASSIGNMENT)}`
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

/**
 * Writes a value as expression text that evaluates to it, as `JSON.stringify`
 * writes it as JSON. JSON's own text won't do: jexl reads the `\n` in
 * `"a\nb"` as a backslash and an n.
 */
export function printValue(value: unknown): string | undefined {
  const json = JSON.stringify(value) as string | undefined
  return json === undefined ? undefined : printJson(JSON.parse(json))
}

function printJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(printJson).join(', ')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(
      ([name, item]) =>
        `${isName(name) ? name : quote(name)}: ${printJson(item)}`
    )
    return `{${entries.join(', ')}}`
  }
  return print({ type: 'Literal', value: value as Literal['value'] })
}
