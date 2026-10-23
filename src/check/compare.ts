/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { key, print, quote } from '../print.ts'
import { hyphenated } from './fields.ts'
import {
  arithmetic,
  falsyPart,
  isNumberish,
  joined,
  pairs,
  truthyPart,
  union
} from './lattice.ts'
import { ARITHMETIC, BOOLEAN, EQUALITY, ORDER, UNKNOWN } from './types.ts'
import {
  describe,
  holding,
  isPattern,
  literalOf,
  nearest,
  paramName
} from './words.ts'

import type { AstNode, BinaryExpression } from '../types.ts'
import type { Checker } from './context.ts'
import type { OfKind, Type } from './types.ts'

export function memberFor(
  c: Checker,
  element: Type,
  value: Type,
  valueNode: AstNode,
  listNode: AstNode,
  node: AstNode
) {
  const literal = literalOf(value)
  if (literal === undefined) {
    return
  }
  if (element.kind === 'record' && typeof literal === 'string') {
    const holder = [...element.fields].find(([, type]) => {
      const scalar = type.kind === 'list' ? type.of : type
      return scalar.kind === 'string' && scalar.values?.includes(literal)
    })
    c.report(
      'never-equal',
      'warning',
      node,
      `${print(listNode)} holds records, so no entry equals ${quote(literal)}` +
        (holder ? `; it is a value of their ${holder[0]} field` : ''),
      holder && c.functions?.any
        ? [
            `any(${print(listNode)}, ${paramName(listNode, node)} => ${print(valueNode)} in ${paramName(listNode, node)}${key(holder[0])})`
          ]
        : []
    )
    return
  }
  compareLiteral(c, element, literal, node)
}

export function compareLiteral(
  c: Checker,
  type: Type,
  literal: string | number,
  node: AstNode
) {
  if (
    type.kind === 'number' &&
    typeof literal === 'string' &&
    Number.isNaN(Number(literal))
  ) {
    c.report(
      'never-equal',
      'warning',
      node,
      `${quote(literal)} is not a number, so it never equals ${describe(type)}`
    )
  } else if (type.kind === 'boolean' && typeof literal === 'string') {
    c.report(
      'never-equal',
      'warning',
      node,
      `${describe(type)} never equals the text ${quote(literal)}`,
      literal === 'true' || literal === 'false' ? [literal] : []
    )
  } else if (
    type.kind === 'string' &&
    type.field?.categories &&
    typeof literal === 'string' &&
    !type.field.categories.includes(literal)
  ) {
    const near = nearest(literal, type.field.categories)
    c.report(
      'unknown-category',
      'warning',
      node,
      `${quote(literal)} is not one of the values the header declares for ${type.field.path.join('.')}` +
        (near.length ? `; did you mean ${near.map(quote).join(', ')}?` : ''),
      near.map(quote)
    )
  } else if (type.kind === 'record') {
    c.report(
      'never-equal',
      'warning',
      node,
      `a record never equals ${quote(String(literal))}`
    )
  }
}

export function binary(c: Checker, node: BinaryExpression): Type {
  const { operator } = node
  const rightNode = node.right
  if (operator === '&&' || operator === '||' || operator === '??') {
    const left = c.infer(node.left)
    const right = c.infer(rightNode)
    if (operator === '&&') {
      return union(falsyPart(left), right)
    }
    return union(operator === '||' ? truthyPart(left) : left, right)
  }
  const hyphen = hyphenated(c, node)
  if (hyphen) {
    return hyphen
  }
  const left = c.infer(node.left)
  const right = c.infer(rightNode)

  if (operator === '~' || operator === '!~') {
    const pattern = literalOf(right)
    if (typeof pattern === 'string' && !isPattern(pattern)) {
      c.report(
        'invalid-pattern',
        'error',
        node,
        `${quote(pattern)} is not a valid regular expression`
      )
    }
    return BOOLEAN
  }

  const leftItem = left.kind === 'list' ? left.of : left
  const rightItem = right.kind === 'list' ? right.of : right
  if (
    operator === '+' &&
    (leftItem.kind === 'string' || rightItem.kind === 'string')
  ) {
    return joined(left, right)
  }

  const lists = [left, right].filter(
    (type): type is OfKind<'list'> => type.kind === 'list'
  )
  const [first, second] = lists
  if (
    first &&
    second &&
    (ARITHMETIC.has(operator) || operator === '+') &&
    !pairs(first.cardinality, second.cardinality)
  ) {
    c.report(
      'list-lengths',
      'warning',
      node,
      `${print(node.left)} ${holding(first)} and ${print(rightNode)} ${holding(second)}, so ${operator} pairs them only where both hold one value`
    )
  }
  const eachOf = (item: Type): Type =>
    first ? { kind: 'list', of: item, cardinality: first.cardinality } : item

  if (operator === '+') {
    return isNumberish(leftItem) && isNumberish(rightItem)
      ? eachOf(arithmetic('+', leftItem, rightItem))
      : UNKNOWN
  }

  if (ARITHMETIC.has(operator) || ORDER.has(operator)) {
    for (const [type, typeNode, other] of [
      [leftItem, node.left, rightItem],
      [rightItem, rightNode, leftItem]
    ] as const) {
      const numericOther = ARITHMETIC.has(operator) || isNumberish(other)
      if (type.kind === 'string' && type.field && numericOther) {
        c.report(
          'string-numeric',
          'warning',
          node,
          `${print(typeNode)} is text, so ${operator} converts it to a number, ${ORDER.has(operator) ? 'answering false' : 'giving NaN'} wherever it is not one`,
          c.functions?.parseFloat
            ? [
                print(node).replace(
                  print(typeNode),
                  `parseFloat(${print(typeNode)})`
                )
              ]
            : []
        )
      }
    }
    return ORDER.has(operator)
      ? BOOLEAN
      : eachOf(arithmetic(operator, leftItem, rightItem))
  }

  if (EQUALITY.has(operator)) {
    const leftLiteral = literalOf(leftItem)
    const rightLiteral = literalOf(rightItem)
    if (rightLiteral !== undefined && node.right.type === 'Literal') {
      compareLiteral(c, leftItem, rightLiteral, node)
    } else if (leftLiteral !== undefined && node.left.type === 'Literal') {
      compareLiteral(c, rightItem, leftLiteral, node)
    }
    return BOOLEAN
  }

  if (operator === 'in') {
    if (right.kind === 'list') {
      memberFor(c, right.of, leftItem, node.left, rightNode, node)
    } else if (right.kind === 'number' || right.kind === 'boolean') {
      c.report(
        'never-equal',
        'warning',
        node,
        `in tests a list, text, a Set, a Map or an object's keys, and ${print(rightNode)} is ${describe(right)}`
      )
    }
    return BOOLEAN
  }
  return UNKNOWN
}
