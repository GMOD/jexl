/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { key, print } from '../print.ts'
import { STRING, UNDEFINED, UNKNOWN } from './types.ts'
import {
  describe,
  firstAbsentIndex,
  holding,
  nearest,
  paramName
} from './words.ts'

import type { AstNode, Identifier } from '../types.ts'
import type { Checker } from './context.ts'
import type { Type } from './types.ts'

export function text(node: AstNode | undefined, name: string) {
  return node ? print(node) + key(name) : name
}

export function field(
  c: Checker,
  subject: Type,
  name: string,
  node: AstNode,
  subjectNode: AstNode | undefined,
  spell = (candidate: string) => text(subjectNode, candidate)
): Type {
  const where = subjectNode ? print(subjectNode) : 'the row'
  switch (subject.kind) {
    case 'record': {
      const found = subject.fields.get(name) ?? subject.each
      if (found) {
        return found
      }
      if (!subject.open) {
        const near = nearest(name, subject.fields.keys())
        c.report(
          'unknown-field',
          'warning',
          node,
          `${where} has no field ${name}` +
            (near.length ? `; did you mean ${near.join(', ')}?` : ''),
          near.map(spell)
        )
      }
      return UNKNOWN
    }
    case 'list': {
      if (name === 'length') {
        return { kind: 'number', domain: [0, Infinity] }
      }
      const item = subject.of
      const entriesHave =
        item.kind === 'unknown' ||
        (item.kind === 'record' &&
          (item.open || !!item.each || item.fields.has(name)))
      const suggestions: string[] = []
      if (entriesHave && subjectNode && node.type === 'Identifier') {
        const list = print(subjectNode)
        const param = paramName(subjectNode, node)
        suggestions.push(`${list}[0]${key(name)}`)
        if (c.functions?.map) {
          suggestions.push(`map(${list}, ${param} => ${param}${key(name)})`)
        }
      }
      c.report(
        'dot-through-list',
        'warning',
        node,
        `${where} is a list, so ${key(name)} is undefined` +
          (entriesHave
            ? `; [0]${key(name)} reads the first entry's` +
              (c.functions?.any ? ', and any() tests each' : '')
            : ''),
        suggestions
      )
      return UNDEFINED
    }
    case 'string': {
      if (name === 'length') {
        return { kind: 'number', domain: [0, Infinity] }
      }
      break
    }
    case 'number':
    case 'boolean': {
      break
    }
    default: {
      return UNKNOWN
    }
  }
  c.report(
    'unknown-field',
    'warning',
    node,
    `${where} is ${describe(subject)}, which has no field ${name}`
  )
  return UNKNOWN
}

export function index(
  c: Checker,
  subject: Type,
  at: number,
  node: AstNode,
  subjectNode: AstNode
): Type {
  const where = print(subjectNode)
  switch (subject.kind) {
    case 'list': {
      const absent = firstAbsentIndex(subject.cardinality)
      if (at >= absent) {
        const fixed = typeof subject.cardinality === 'number'
        c.report(
          'index-range',
          'warning',
          node,
          fixed
            ? `${where} ${holding(subject)}, so [${at}] is always undefined`
            : `${where} ${holding(subject)}, so [${at}] is undefined on every biallelic record`,
          subject.cardinality === 'perAlt' ? [`${where}[0]`] : []
        )
      }
      return subject.of
    }
    case 'record': {
      return field(c, subject, String(at), node, subjectNode)
    }
    case 'string': {
      c.report(
        'index-scalar',
        'warning',
        node,
        `${where} holds one string, so [${at}] reads a single character`,
        [where]
      )
      return STRING
    }
    case 'number':
    case 'boolean': {
      c.report(
        'index-scalar',
        'warning',
        node,
        `${where} holds one value, so [${at}] reads nothing`,
        [where]
      )
      return UNDEFINED
    }
    default: {
      return UNKNOWN
    }
  }
}

export function dottedKey(c: Checker, node: Identifier): Type | undefined {
  const names = [node.value]
  let base = node
  while (base.from) {
    if (base.from.type !== 'Identifier') {
      return undefined
    }
    base = base.from
    names.unshift(base.value)
  }
  if (base === node) {
    return undefined
  }
  let type = variable(c, base, false)
  let subjectNode: AstNode = base
  for (let i = 1; i < names.length; i++) {
    const record = type.kind === 'record' ? type : undefined
    if (!record) {
      return undefined
    }
    for (let j = names.length; j > i + 1; j--) {
      const whole = names.slice(i, j).join('.')
      const step = record.fields.get(names[i]!)
      const stepReaches =
        step?.kind === 'record' &&
        (step.fields.has(names[i + 1]!) || !!step.each)
      if (record.fields.has(whole) && !stepReaches) {
        const fixed = print(subjectNode) + key(whole)
        c.report(
          'dotted-key',
          'warning',
          node,
          `${whole} is one field of ${print(subjectNode)}; jexl reads ${names.slice(i, j).join(' then ')}`,
          [[fixed, ...names.slice(j).map((name) => key(name))].join('')]
        )
        let resolved = record.fields.get(whole)!
        for (const name of names.slice(j)) {
          resolved = field(c, resolved, name, node, undefined)
        }
        return resolved
      }
    }
    const next = record.fields.get(names[i]!)
    if (!next) {
      return undefined
    }
    type = next
    subjectNode = {
      type: 'Identifier',
      value: names[i]!,
      from: subjectNode
    }
  }
  return undefined
}

export function variable(c: Checker, node: Identifier, diagnose = true): Type {
  const name = node.value
  const local = c.scope.get(name)
  if (local) {
    return local
  }
  if (name === c.row) {
    return c.root
  }
  if (c.env && Object.hasOwn(c.env, name)) {
    return c.env[name]!
  }
  if (name === 'undefined') {
    return UNDEFINED
  }
  if (c.row === undefined && c.root.kind === 'record') {
    return diagnose
      ? field(c, c.root, name, node, undefined)
      : (c.root.fields.get(name) ?? UNKNOWN)
  }
  if (c.env && diagnose) {
    const known = [
      ...(c.row ? [c.row] : []),
      ...Object.keys(c.env),
      ...c.scope.keys()
    ]
    const near = nearest(name, known)
    c.report(
      'unknown-variable',
      'error',
      node,
      `${name} is not defined here` +
        (near.length ? `; did you mean ${near.join(', ')}?` : ''),
      near
    )
  }
  return UNKNOWN
}

export function hyphenated(c: Checker, node: AstNode): Type | undefined {
  if (
    node.type !== 'BinaryExpression' ||
    node.operator !== '-' ||
    node.left.type !== 'Identifier' ||
    node.right.type !== 'Identifier' ||
    node.right.from
  ) {
    return undefined
  }
  const left = node.left
  const name = left.value
  if (
    !left.from &&
    (c.scope.has(name) ||
      name === c.row ||
      (c.env && Object.hasOwn(c.env, name)))
  ) {
    return undefined
  }
  const reported = c.diagnostics.length
  const subject = left.from ? c.infer(left.from) : c.root
  c.diagnostics.length = reported
  if (subject.kind !== 'record' || subject.fields.has(name)) {
    return undefined
  }
  const whole = `${name}-${node.right.value}`
  const found = subject.fields.get(whole)
  if (!found) {
    return undefined
  }
  // a bare name can't hold a hyphen, so only a row variable can spell it
  const holder: AstNode | undefined =
    left.from ??
    (c.row === undefined ? undefined : { type: 'Identifier', value: c.row })
  c.report(
    'unknown-field',
    'warning',
    node,
    `${print(node)} subtracts; ${whole} is one field`,
    holder ? [text(holder, whole)] : []
  )
  return found
}
