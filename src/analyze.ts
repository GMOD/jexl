/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { AstNode, AstNodeUnion, FunctionCall } from './types.ts'

export type PathKey = string | number

/**
 * A value the expression reads out of its context: the variable `root`, then
 * each literal key in `path`. `dynamic` means a computed key followed, so the
 * read reaches somewhere under `path` that only evaluation can name.
 *
 * A dot and a bracket both add a key.
 */
export interface Read {
  root: string
  path: PathKey[]
  dynamic?: true
}

export type CallArg =
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'path'; read: Read }
  | { type: 'dynamic' }

/** A path under the row, the record a per-row expression is evaluated for. */
export interface Field {
  path: PathKey[]
  dynamic?: true
}

export interface Call {
  name: string
  args: CallArg[]
}

export interface Analysis {
  /** The context variables read, in the order first read. */
  variables: string[]
  /**
   * Every path whose value the expression uses, in the order first used. A
   * path only extended, as `feature` is in `feature.score`, is not a use.
   */
  reads: Read[]
  /** The reads that are fields of the row, as `row` and `env` say. */
  fields: Field[]
  /** The paths whose value the expression returns as is. */
  returns: Read[]
  /**
   * Whether the expression is only a path: a name, then dots and literal
   * subscripts, as in `score` or `feature.INFO.DP[0]`. Its one read is then
   * its value, which a host can read without jexl.
   */
  bare: boolean
  /** Every call, outermost first, including accessor calls. */
  calls: Call[]
  /** The names the expression writes into its context. */
  assigned: string[]
}

export interface AnalyzeOptions {
  /**
   * Functions that read a path: `name(subject, ...keys)` reads the subject,
   * then this prefix, then each key. `{ get: [] }` makes `get(feature, 'x')`
   * and `feature.get('x')` both read `feature.x`.
   */
  accessors?: Record<string, readonly PathKey[]>
  /** The variable holding the row, whose reads `fields` lists: `'feature'`. */
  row?: string
  /**
   * For a host that binds each of the row's fields as a variable, so that
   * `pvalue` means the row's `pvalue`: the variables it binds to anything
   * else. Every other variable the expression reads is then a field.
   */
  env?: readonly string[]
}

interface Binding {
  value: Read[]
  used: boolean
}

type Scope = Map<string, Binding>

function literalKey(node: AstNode) {
  const value = literalValue(node)
  return typeof value === 'boolean' ? String(value) : (value ?? undefined)
}

function literalValue(ast: AstNode) {
  const node = ast as AstNodeUnion
  if (node.type === 'Literal') {
    return node.value
  }
  if (
    node.type === 'TemplateLiteral' &&
    node.parts.every((part) => part.type === 'static')
  ) {
    return node.parts.map((part) => part.value).join('')
  }
  return undefined
}

function extend(read: Read, keys: readonly PathKey[], dynamic = false): Read {
  if (read.dynamic) {
    return read
  }
  const path = [...read.path, ...keys]
  return dynamic
    ? { root: read.root, path, dynamic }
    : { root: read.root, path }
}

function isBarePath(ast: AstNode): boolean {
  const node = ast as AstNodeUnion
  if (node.type === 'Identifier') {
    return !node.from || isBarePath(node.from)
  }
  return (
    node.type === 'FilterExpression' &&
    literalKey(node.expr) !== undefined &&
    isBarePath(node.subject)
  )
}

function fieldOf(
  { root, path, dynamic }: Read,
  row: string | undefined,
  env: readonly string[] | undefined
): Field | undefined {
  const fieldPath =
    root === row
      ? path
      : env && !env.includes(root)
        ? [root, ...path]
        : undefined
  return (
    fieldPath && (dynamic ? { path: fieldPath, dynamic } : { path: fieldPath })
  )
}

function classify(node: AstNode, value: Read[]): CallArg {
  const literal = literalValue(node)
  if (literal !== undefined) {
    return { type: 'literal', value: literal }
  }
  return value.length === 1
    ? { type: 'path', read: value[0]! }
    : { type: 'dynamic' }
}

/**
 * Lists what an expression reads from its context, without evaluating it or
 * consulting any registered function.
 *
 * A name assigned earlier in the expression is a local: `x = feature.score;
 * x > 1` reads `feature.score` and no `x`. An assignment that may not run — in
 * a conditional's branch, or right of a binary operator, which may short-circuit
 * — counts its value as read and binds nothing past that operand, so a later
 * read of the name is a context read.
 *
 * Every path evaluation reads is reported, or a prefix of it is.
 */
export function analyze(
  ast: AstNode | null,
  { accessors = {}, row, env }: AnalyzeOptions = {}
): Analysis {
  const reads = new Map<string, Read>()
  const calls: Call[] = []
  const assigned = new Set<string>()

  function consume(value: Read[]) {
    for (const read of value) {
      const key = JSON.stringify([read.root, read.path, read.dynamic])
      if (!reads.has(key)) {
        reads.set(key, read)
      }
    }
  }

  function use(node: AstNode, scope: Scope) {
    consume(walk(node, scope))
  }

  function release(scope: Scope, outer?: Scope) {
    for (const [name, binding] of scope) {
      if (!binding.used && outer?.get(name) !== binding) {
        consume(binding.value)
      }
    }
  }

  function branch(node: AstNode | undefined, scope: Scope) {
    if (!node) {
      return []
    }
    const inner = new Map(scope)
    const value = walk(node, inner)
    release(inner, scope)
    return value
  }

  function call(node: FunctionCall, scope: Scope): Read[] {
    const record: Call = { name: node.name, args: [] }
    calls.push(record)
    const [subjectNode, ...keyNodes] = node.args
    const prefix = Object.hasOwn(accessors, node.name)
      ? accessors[node.name]
      : undefined
    if (!prefix || !subjectNode) {
      for (const arg of node.args) {
        const value = walk(arg, scope)
        record.args.push(classify(arg, value))
        consume(value)
      }
      return []
    }
    const subject = walk(subjectNode, scope)
    record.args.push(classify(subjectNode, subject))
    const keys = [...prefix]
    let dynamic = false
    for (const arg of keyNodes) {
      const key = literalKey(arg)
      if (key === undefined) {
        const value = walk(arg, scope)
        record.args.push(classify(arg, value))
        consume(value)
        dynamic = true
      } else {
        record.args.push({ type: 'literal', value: literalValue(arg)! })
        if (!dynamic) {
          keys.push(key)
        }
      }
    }
    return subject.map((read) => extend(read, keys, dynamic))
  }

  function walk(ast: AstNode, scope: Scope): Read[] {
    const node = ast as AstNodeUnion
    switch (node.type) {
      case 'Literal': {
        return []
      }

      case 'Identifier': {
        if (node.from) {
          return walk(node.from, scope).map((read) =>
            extend(read, [node.value])
          )
        }
        const binding = scope.get(node.value)
        if (binding) {
          binding.used = true
          return binding.value
        }
        return [{ root: node.value, path: [] }]
      }

      case 'FilterExpression': {
        const subject = walk(node.subject, scope)
        const key = literalKey(node.expr)
        if (key !== undefined) {
          return subject.map((read) => extend(read, [key]))
        }
        use(node.expr, scope)
        return subject.map((read) => extend(read, [], true))
      }

      case 'FunctionCall': {
        return call(node, scope)
      }

      case 'ConditionalExpression': {
        const test = walk(node.test, scope)
        consume(test)
        const consequent = node.consequent
          ? branch(node.consequent, scope)
          : test
        return [...consequent, ...branch(node.alternate, scope)]
      }

      case 'BinaryExpression': {
        use(node.left, scope)
        consume(branch(node.right, scope))
        return []
      }

      case 'UnaryExpression': {
        use(node.right!, scope)
        return []
      }

      case 'ArrayLiteral': {
        for (const item of node.value) {
          use(item, scope)
        }
        return []
      }

      case 'ObjectLiteral': {
        for (const value of Object.values(node.value)) {
          use(value, scope)
        }
        return []
      }

      case 'TemplateLiteral': {
        for (const part of node.parts) {
          if (part.type === 'expression') {
            use(part.value, scope)
          }
        }
        return []
      }

      case 'SequenceExpression': {
        const exprs = node.expressions
        for (const expr of exprs.slice(0, -1)) {
          const value = walk(expr, scope)
          if (expr.type !== 'AssignmentExpression') {
            consume(value)
          }
        }
        return walk(exprs.at(-1)!, scope)
      }

      case 'AssignmentExpression': {
        const value = walk(node.right!, scope)
        const name = node.left.value
        const previous = scope.get(name)
        if (previous && !previous.used) {
          consume(previous.value)
        }
        scope.set(name, { value, used: false })
        assigned.add(name)
        return value
      }

      case 'Lambda': {
        const inner: Scope = new Map(scope)
        for (const param of node.params) {
          inner.set(param, { value: [], used: true })
        }
        use(node.body, inner)
        return []
      }

      default: {
        throw new Error(`Corrupt AST: unknown node type '${ast.type}'`)
      }
    }
  }

  const scope: Scope = new Map()
  const returns = ast ? walk(ast, scope) : []
  consume(returns)
  release(scope)
  const readList = [...reads.values()]
  const fields = new Map<string, Field>()
  for (const read of readList) {
    const field = fieldOf(read, row, env)
    if (field) {
      fields.set(JSON.stringify(field), field)
    }
  }
  return {
    variables: [...new Set(readList.map((read) => read.root))],
    reads: readList,
    fields: [...fields.values()],
    returns,
    bare: ast !== null && isBarePath(ast),
    calls,
    assigned: [...assigned]
  }
}
