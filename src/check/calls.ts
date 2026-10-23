/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { literalValue } from '../analyze.ts'
import { print, quote } from '../print.ts'
import { memberFor } from './compare.ts'
import { field } from './fields.ts'
import { isMulti } from './lattice.ts'
import { NUMBER, UNKNOWN } from './types.ts'
import { describe, nearest } from './words.ts'

import type { AstNode, FunctionCall, Lambda } from '../types.ts'
import type { Checker } from './context.ts'
import type { ParamType, Type } from './types.ts'

const PASSES_INDEX = new Set(['map', 'filter', 'any', 'all', 'count', 'find'])

function lambdaParams(name: string, item: Type): Type[] {
  switch (name) {
    case 'sort': {
      return [item, item]
    }
    case 'reduce': {
      return [UNKNOWN, item]
    }
    default: {
      return PASSES_INDEX.has(name) ? [item, NUMBER] : [item]
    }
  }
}

function argumentProblem(
  param: ParamType,
  type: Type
): string | undefined {
  switch (param) {
    case 'any':
    case 'boolean':
    case 'member':
    case 'lambda': {
      return undefined
    }
    case 'number': {
      if (type.kind === 'string' && type.field) {
        return 'is text'
      }
      return isMulti(type) || type.kind === 'record'
        ? `is ${describe(type)}`
        : undefined
    }
    case 'string': {
      return isMulti(type) || type.kind === 'record'
        ? `is ${describe(type)}`
        : undefined
    }
    case 'list': {
      return ['number', 'string', 'boolean', 'record'].includes(type.kind)
        ? `is ${describe(type)}`
        : undefined
    }
    case 'record': {
      return ['number', 'string', 'boolean', 'list'].includes(type.kind)
        ? `is ${describe(type)}`
        : undefined
    }
  }
}

export function lambda(
  c: Checker,
  node: Lambda,
  types: readonly Type[] = []
): Type {
  const saved = node.params.map((name) => [name, c.scope.get(name)] as const)
  node.params.forEach((name, i) => {
    c.scope.set(name, types[i] ?? UNKNOWN)
  })
  const returns = c.infer(node.body)
  for (const [name, previous] of saved) {
    if (previous) {
      c.scope.set(name, previous)
    } else {
      c.scope.delete(name)
    }
  }
  return { kind: 'lambda', returns }
}

export function call(c: Checker, node: FunctionCall): Type {
  const { name, args } = node
  const prefix = Object.hasOwn(c.accessors, name)
    ? c.accessors[name]
    : undefined
  if (prefix && args[0]) {
    const [subjectArg, ...keyArgs] = args as [AstNode, ...AstNode[]]
    let type = c.infer(subjectArg)
    let subjectNode = subjectArg
    const step = (name: string, at: AstNode, spell?: typeof quote) => {
      type = field(c, type, name, at, subjectNode, spell)
      subjectNode = {
        type: 'Identifier',
        value: name,
        from: subjectNode
      }
    }
    for (const name of prefix) {
      step(String(name), node)
    }
    for (const arg of keyArgs) {
      const name = literalValue(arg)
      if (typeof name !== 'string' && typeof name !== 'number') {
        keyArgs.forEach(c.infer)
        return UNKNOWN
      }
      step(String(name), arg, quote)
    }
    return type
  }
  const signature =
    c.functions && Object.hasOwn(c.functions, name)
      ? c.functions[name]
      : undefined
  if (!signature) {
    args.forEach(c.infer)
    if (c.functions) {
      const near = nearest(name, Object.keys(c.functions))
      c.report(
        'unknown-function',
        'error',
        node,
        `no function ${name}` +
          (near.length ? `; did you mean ${near.join(', ')}?` : ''),
        near.map((candidate) => print({ ...node, name: candidate }))
      )
    }
    return UNKNOWN
  }
  const { params, optional = 0, variadic = false } = signature
  const least = params.length - optional - (variadic ? 1 : 0)
  const most = variadic ? Infinity : params.length
  if (args.length < least || args.length > most) {
    c.report(
      'arity',
      'error',
      node,
      `${name} takes ${least === most ? least : most === Infinity ? `at least ${least}` : `${least} to ${most}`} argument${most === 1 ? '' : 's'}, not ${args.length}`
    )
  }
  const types: Type[] = []
  let lastCollection: Type | undefined
  let lastCollectionNode: AstNode | undefined
  for (const [i, arg] of args.entries()) {
    const declared = params[Math.min(i, params.length - 1)]
    if (declared === undefined || (!variadic && i >= params.length)) {
      types.push(c.infer(arg))
      continue
    }
    const accepted: readonly ParamType[] =
      typeof declared === 'string' ? [declared] : declared
    if (arg.type === 'Lambda') {
      const item = lastCollection?.kind === 'list' ? lastCollection.of : UNKNOWN
      types.push(lambda(c, arg, lambdaParams(name, item)))
      continue
    }
    const type = c.infer(arg)
    types.push(type)
    if (accepted.includes('lambda')) {
      c.report(
        'argument-type',
        'error',
        arg,
        `${name} expects a function such as x => …, not ${print(arg)}`
      )
      continue
    }
    if (accepted.includes('member') && lastCollection && lastCollectionNode) {
      if (lastCollection.kind === 'list') {
        memberFor(c, lastCollection.of, type, arg, lastCollectionNode, node)
      }
      continue
    }
    const problems = accepted.map((param) => argumentProblem(param, type))
    if (problems.every(Boolean)) {
      c.report(
        isMulti(type)
          ? 'list-operand'
          : type.kind === 'string'
            ? 'string-numeric'
            : 'argument-type',
        'warning',
        arg,
        `${name} expects ${accepted.join(' or ')} as argument ${i + 1}, but ${print(arg)} ${problems[0]}`
      )
    }
    if (accepted.includes('list')) {
      lastCollection = type
      lastCollectionNode = arg
    }
  }
  const { returns } = signature
  if (typeof returns === 'function') {
    return returns(types)
  }
  if (typeof returns === 'string') {
    return { kind: returns }
  }
  return returns ?? UNKNOWN
}
