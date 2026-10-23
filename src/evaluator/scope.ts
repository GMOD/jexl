/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { LAMBDA } from '../collections.ts'
import { sandboxed } from './members.ts'

import type { CompiledNode, Context } from './context.ts'
import type { Lambda } from '../collections.ts'
import type { Grammar } from '../grammar.ts'
import type { AstNode, JexlValue } from '../types.ts'

export function lambda(fn: Lambda) {
  fn[LAMBDA] = true
  return fn
}

export const unassigned = Symbol('unassigned')

/**
 * The slot each name an expression assigns is kept in, and the frame holding
 * those slots for the evaluation in progress.
 */
export interface Locals {
  slots: ReadonlyMap<string, number>
  frame: { locals: unknown[] }
}

/**
 * One call of a lambda. A name the lambda binds reads from `args`, a name bound
 * by a lambda around it from `outer`, a name the expression assigns from
 * `locals` — the evaluation's own, captured when the lambda was made, so a
 * lambda called after its evaluation ends still sees them — and any other name
 * from `context`.
 */
export class LambdaFrame {
  args: JexlValue[]
  outer: LambdaFrame | undefined
  context: Context
  locals: unknown[] | undefined

  constructor(
    args: JexlValue[],
    outer: LambdaFrame | undefined,
    context: Context,
    locals: unknown[] | undefined
  ) {
    this.args = args
    this.outer = outer
    this.context = context
    this.locals = locals
  }
}

/** The parameters of the lambdas around a node, innermost first. */
interface Params {
  names: string[]
  outer: Params | undefined
}

export interface Scope {
  locals?: Locals
  params?: Params
}

// the closures compiled inside a lambda are handed its LambdaFrame in place of
// the context, and only the ones that read a name, below, look inside it
export const asFrame = (env: Context) => env as unknown as LambdaFrame
export const asContext = (frame: LambdaFrame) => frame as unknown as Context

export function compileName(
  name: string,
  grammar: Grammar,
  scope: Scope
): CompiledNode {
  let hops = 0
  for (let p = scope.params; p; p = p.outer) {
    const index = p.names.indexOf(name)
    if (index !== -1) {
      return hops === 0 ? (env) => asFrame(env).args[index] : climb(hops, index)
    }
    hops++
  }
  const reader = grammar.variableReader?.(name)
  const read: CompiledNode = reader
    ? (ctx) => sandboxed(reader(ctx))
    : (ctx) => sandboxed(ctx[name])
  const fromContext: CompiledNode = scope.params
    ? (env) => read(asFrame(env).context)
    : read
  const slot = scope.locals?.slots.get(name)
  if (slot === undefined) {
    return fromContext
  }
  if (scope.params) {
    return (env) => {
      const local = asFrame(env).locals![slot]
      return local === unassigned ? fromContext(env) : (local as JexlValue)
    }
  }
  const { frame } = scope.locals!
  return (env) => {
    const local = frame.locals[slot]
    return local === unassigned ? fromContext(env) : (local as JexlValue)
  }
}

function climb(hops: number, index: number): CompiledNode {
  return (env) => {
    let frame = asFrame(env)
    for (let i = 0; i < hops; i++) {
      frame = frame.outer!
    }
    return frame.args[index]
  }
}

export function assignedNames(
  node: AstNode | undefined,
  names = new Set<string>()
) {
  switch (node?.type) {
    case 'AssignmentExpression': {
      names.add(node.left.value)
      assignedNames(node.right, names)
      break
    }
    case 'Identifier': {
      assignedNames(node.from, names)
      break
    }
    case 'BinaryExpression': {
      assignedNames(node.left, names)
      assignedNames(node.right, names)
      break
    }
    case 'UnaryExpression': {
      assignedNames(node.right, names)
      break
    }
    case 'ConditionalExpression': {
      assignedNames(node.test, names)
      assignedNames(node.consequent, names)
      assignedNames(node.alternate, names)
      break
    }
    case 'FilterExpression': {
      assignedNames(node.subject, names)
      assignedNames(node.expr, names)
      break
    }
    case 'ArrayLiteral':
    case 'FunctionCall':
    case 'SequenceExpression': {
      const children =
        node.type === 'ArrayLiteral'
          ? node.value
          : node.type === 'FunctionCall'
            ? node.args
            : node.expressions
      for (const child of children) {
        assignedNames(child, names)
      }
      break
    }
    case 'ObjectLiteral': {
      for (const child of Object.values(node.value)) {
        assignedNames(child, names)
      }
      break
    }
    case 'TemplateLiteral': {
      for (const part of node.parts) {
        if (part.type === 'expression') {
          assignedNames(part.value, names)
        }
      }
      break
    }
    case 'Lambda': {
      assignedNames(node.body, names)
      break
    }
  }
  return names
}
