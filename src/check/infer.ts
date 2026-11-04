/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { literalValue } from '../analyze.ts'
import { unknownNode } from '../errors.ts'
import { print, quote } from '../print.ts'
import { call, lambda } from './calls.ts'
import { binary, chain } from './compare.ts'
import { dottedKey, field, index, variable } from './fields.ts'
import {
  isMulti,
  negate,
  textValues,
  truthyPart,
  union,
  unionAll
} from './lattice.ts'
import { BOOLEAN, MAX_VALUES, STRING, UNDEFINED, UNKNOWN } from './types.ts'
import { describe, holding } from './words.ts'

import type { AstNode } from '../types.ts'
import type { Checker } from './context.ts'
import type { Type } from './types.ts'

export function infer(c: Checker, node: AstNode): Type {
  switch (node.type) {
    case 'Literal': {
      const { value } = node
      return typeof value === 'number'
        ? { kind: 'number', values: [value] }
        : typeof value === 'string'
          ? { kind: 'string', values: [value] }
          : value === null
            ? UNDEFINED
            : BOOLEAN
    }
    case 'Identifier': {
      if (!node.from) {
        return variable(c, node)
      }
      const dotted = dottedKey(c, node)
      if (dotted) {
        return dotted
      }
      return field(c, c.infer(node.from), node.value, node, node.from)
    }
    case 'FilterExpression': {
      const subject = c.infer(node.subject)
      const at = literalValue(node.expr)
      if (typeof at === 'number') {
        return index(c, subject, at, node, node.subject)
      }
      if (typeof at === 'string') {
        if (subject.kind === 'list' && at !== 'length') {
          c.report(
            'unknown-field',
            'warning',
            node,
            `${print(node.subject)} is ${describe(subject)}, so [${quote(at)}] reads nothing`
          )
          return UNDEFINED
        }
        return field(c, subject, at, node, node.subject)
      }
      const by = c.infer(node.expr)
      if (isMulti(by)) {
        c.report(
          'list-operand',
          'warning',
          node,
          `${print(node.expr)} ${holding(by)}, so indexing by it finds an entry only when there is exactly one`
        )
      }
      if (subject.kind === 'record') {
        return unionAll([...subject.fields.values(), subject.each ?? UNDEFINED])
      }
      return subject.kind === 'list' ? subject.of : UNKNOWN
    }
    case 'BinaryExpression': {
      return binary(c, node)
    }
    case 'ComparisonChain': {
      return chain(c, node)
    }
    case 'UnaryExpression': {
      const right = c.infer(node.right)
      if (node.operator === '!') {
        return BOOLEAN
      }
      if (node.operator === '-') {
        return negate(right)
      }
      return UNKNOWN
    }
    case 'ConditionalExpression': {
      const test = c.infer(node.test)
      const consequent = node.consequent
        ? c.infer(node.consequent)
        : truthyPart(test)
      const alternate = node.alternate ? c.infer(node.alternate) : UNDEFINED
      return union(consequent, alternate)
    }
    case 'FunctionCall': {
      return call(c, node)
    }
    case 'ArrayLiteral': {
      const items = node.value.map(c.infer)
      return {
        kind: 'list',
        of: unionAll(items),
        cardinality: items.length
      }
    }
    case 'ObjectLiteral': {
      return {
        kind: 'record',
        fields: new Map(
          Object.entries(node.value).map(([name, value]) => [
            name,
            c.infer(value)
          ])
        ),
        open: false
      }
    }
    case 'TemplateLiteral': {
      let values: string[] | undefined = ['']
      for (const part of node.parts) {
        if (part.type === 'static') {
          values = values?.map((value) => value + part.value)
        } else {
          const options = textValues(c.infer(part.value))
          values =
            values && options && values.length * options.length <= MAX_VALUES
              ? values.flatMap((value) =>
                  options.map((option) => value + option)
                )
              : undefined
        }
      }
      return values ? { kind: 'string', values } : STRING
    }
    case 'SequenceExpression': {
      let last: Type = UNDEFINED
      for (const expr of node.expressions) {
        last = c.infer(expr)
      }
      return last
    }
    case 'AssignmentExpression': {
      const value = c.infer(node.right)
      c.scope.set(node.left.value, value)
      return value
    }
    case 'Lambda': {
      return lambda(c, node)
    }
    default: {
      return unknownNode(node)
    }
  }
}
