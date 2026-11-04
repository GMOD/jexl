/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { unknownNode } from '../errors.ts'
import { and, nullish, or } from '../grammar.ts'
import {
  assignOwn,
  defineOwn,
  isUnsafeKey,
  literalTable,
  member,
  memberKey,
  sandboxed
} from './members.ts'
import {
  LambdaFrame,
  asContext,
  asFrame,
  assignedNames,
  compileName,
  lambda,
  unassigned
} from './scope.ts'

import type { CompiledNode, Context } from './context.ts'
import type { Scope } from './scope.ts'
import type { Grammar } from '../grammar.ts'
import type { AstNode, JexlValue } from '../types.ts'

/**
 * Lowers an expression tree into a tree of closures, resolving each node's type
 * and its operator's implementation once, at compile time, rather than
 * re-dispatching on `node.type` for every node on every evaluation. An
 * expression compiled once and evaluated per-item — the usual shape for
 * per-feature config callbacks — pays the dispatch cost once instead of N
 * times.
 *
 * Operators are bound here, so a grammar change after compilation requires
 * recompiling. Functions are looked up per call, since they are commonly
 * registered after an expression has been compiled.
 *
 * Each name the expression assigns gets a slot, numbered at compile time, in a
 * frame that lasts one evaluation, so an assignment never touches the context
 * and a context reused from one evaluation to the next comes back unchanged. A
 * name reads its slot once assigned, and resolves as usual until then. An
 * expression that assigns nothing gets no frame. The frame is not a layer over
 * the context via `Object.create`: V8 gives every object used as a prototype a
 * map of its own, which made evaluating against a context built per evaluation
 * six times slower.
 */
export function compileAst(ast: AstNode, grammar: Grammar): CompiledNode {
  const names = [...assignedNames(ast)]
  if (names.length === 0) {
    return compileNode(ast, grammar, {})
  }
  const slots = new Map(names.map((name, i) => [name, i]))
  const empty = names.map(() => unassigned)
  const frame = { locals: empty }
  const fn = compileNode(ast, grammar, { locals: { slots, frame } })
  // saved and restored, so a function that evaluates this same expression
  // again from inside it leaves the outer evaluation's locals intact
  return (ctx) => {
    const outer = frame.locals
    frame.locals = empty.slice()
    try {
      return fn(ctx)
    } finally {
      frame.locals = outer
    }
  }
}

/** Renders an interpolated value for a template literal. */
function stringify(value: JexlValue) {
  if (value == null) {
    return ''
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }
  return JSON.stringify(value)
}

type Test = (left: JexlValue, right: JexlValue) => JexlValue

function test(grammar: Grammar, operator: string): Test {
  const op = grammar.elements[operator]
  const fn = op?.type === 'binaryOp' ? op.eval : undefined
  const onDemand = op?.type === 'binaryOp' ? op.evalOnDemand : undefined
  if (fn) {
    return fn
  }
  if (onDemand) {
    return (left, right) =>
      onDemand({ eval: () => left }, { eval: () => right })
  }
  throw new Error(`Unknown binary operator '${operator}'`)
}

const valuesOf = (value: JexlValue) => (Array.isArray(value) ? value : [value])

/**
 * Whether a chain such as `lo < x < hi` holds. Each operand is evaluated once,
 * and only when the links before it hold. A list holds where one of its values
 * satisfies the links on both sides of it, so `0.1 < AF < 0.5` asks whether
 * one frequency lies between, where `0.1 < AF && AF < 0.5` holds for
 * `[0.01, 0.9]`.
 */
function chainHolds(tests: Test[], operands: CompiledNode[], ctx: Context) {
  const values: JexlValue[][] = []
  const candidates = (i: number) => (values[i] ??= valuesOf(operands[i]!(ctx)))
  const holdsFrom = (i: number, value: JexlValue): boolean =>
    i === tests.length ||
    candidates(i + 1).some(
      (next) => !!tests[i]!(value, next) && holdsFrom(i + 1, next)
    )
  return candidates(0).some((value) => holdsFrom(0, value))
}

function compileNode(
  node: AstNode,
  grammar: Grammar,
  scope: Scope
): CompiledNode {
  const compile = (child: AstNode) => compileNode(child, grammar, scope)
  switch (node.type) {
    case 'Literal': {
      const { value } = node
      return () => value
    }

    case 'Identifier': {
      const name = node.value
      if (!node.from) {
        return compileName(name, grammar, scope)
      }
      const from = compile(node.from)
      const { getMember } = grammar
      if (getMember) {
        return (ctx) => {
          const target = from(ctx)
          return target == null ? undefined : sandboxed(getMember(target, name))
        }
      }
      if (isUnsafeKey(name)) {
        return (ctx) => {
          const target = from(ctx)
          return target == null ? undefined : member(target as Context, name)
        }
      }
      return (ctx) => {
        const target = from(ctx)
        return target == null ? undefined : sandboxed((target as Context)[name])
      }
    }

    case 'BinaryExpression': {
      const op = grammar.elements[node.operator]
      const left = compile(node.left)
      const right = compile(node.right)
      if (op?.type === 'binaryOp' && op.evalOnDemand) {
        const { evalOnDemand } = op
        if (evalOnDemand === and) {
          return (ctx) => {
            const value = left(ctx)
            return value ? right(ctx) : value
          }
        }
        if (evalOnDemand === or) {
          return (ctx) => {
            const value = left(ctx)
            return value || right(ctx)
          }
        }
        if (evalOnDemand === nullish) {
          return (ctx) => left(ctx) ?? right(ctx)
        }
        // a host's operator gets its operands unevaluated, behind `eval`
        // thunks, so that it can short-circuit as it chooses
        return (ctx) =>
          evalOnDemand({ eval: () => left(ctx) }, { eval: () => right(ctx) })
      }
      const fn = op?.type === 'binaryOp' ? op.eval : undefined
      if (!fn) {
        throw new Error(`Unknown binary operator '${node.operator}'`)
      }
      return (ctx) => fn(left(ctx), right(ctx))
    }

    case 'ComparisonChain': {
      const operands = node.operands.map(compile)
      const tests = node.operators.map((operator) => test(grammar, operator))
      return (ctx) => chainHolds(tests, operands, ctx)
    }

    case 'UnaryExpression': {
      const right = compile(node.right)
      const elem = grammar.elements[node.operator]
      const fn =
        elem?.type === 'unaryOp'
          ? elem.eval
          : elem?.type === 'binaryOp'
            ? elem.unaryEval
            : undefined
      if (!fn) {
        throw new Error(`Unknown unary operator '${node.operator}'`)
      }
      return (ctx) => fn(right(ctx))
    }

    case 'ConditionalExpression': {
      const test = compile(node.test)
      const consequent = node.consequent ? compile(node.consequent) : undefined
      const alternate = node.alternate ? compile(node.alternate) : undefined
      return (ctx) => {
        const res = test(ctx)
        if (res) {
          // an omitted consequent ("a ?: b") yields the test result
          return consequent ? consequent(ctx) : res
        }
        return alternate ? alternate(ctx) : undefined
      }
    }

    case 'FilterExpression': {
      const table = literalTable(node.subject)
      const subject = table ? () => table : compile(node.subject)
      const index = compile(node.expr)
      const { getMember } = grammar
      if (getMember) {
        return (ctx) => {
          const subjectVal = subject(ctx)
          const key = memberKey(index(ctx))
          return subjectVal == null || key === undefined
            ? undefined
            : sandboxed(getMember(subjectVal, key))
        }
      }
      return (ctx) => {
        const subjectVal = subject(ctx)
        const key = memberKey(index(ctx))
        return subjectVal == null || key === undefined
          ? undefined
          : member(subjectVal as Context, key)
      }
    }

    case 'ArrayLiteral': {
      const items = node.value.map(compile)
      const len = items.length
      return (ctx) => {
        const out: JexlValue[] = new Array(len)
        for (let i = 0; i < len; i++) {
          out[i] = items[i]!(ctx)
        }
        return out
      }
    }

    case 'ObjectLiteral': {
      const entries = Object.entries(node.value)
      const keys = entries.map(([key]) => key)
      const values = entries.map(([, value]) => compile(value))
      const len = keys.length
      // resolved once, here, so the common case keeps its plain store
      const store = keys.includes('__proto__') ? defineOwn : assignOwn
      return (ctx) => {
        const out: Record<string, JexlValue> = {}
        for (let i = 0; i < len; i++) {
          store(out, keys[i]!, sandboxed(values[i]!(ctx)))
        }
        return out
      }
    }

    case 'TemplateLiteral': {
      // every part renders to a string, so these are narrower than CompiledNode
      const parts = node.parts.map((part): ((ctx: Context) => string) => {
        if (part.type === 'static') {
          const { value } = part
          return () => value
        }
        const expr = compile(part.value)
        return (ctx) => stringify(expr(ctx))
      })
      return (ctx) => {
        let out = ''
        for (const part of parts) {
          out += part(ctx)
        }
        return out
      }
    }

    case 'FunctionCall': {
      const { name } = node
      const args = node.args.map(compile)
      // hasOwn, so that inherited Object.prototype members such as `toString`
      // and `constructor` aren't callable as Jexl functions. Resolved per call
      // rather than baked in, since functions are routinely registered after
      // an expression has been compiled.
      const lookup = () => {
        const { functions } = grammar
        if (!Object.hasOwn(functions, name)) {
          throw new Error(`Jexl Function ${name} is not defined.`)
        }
        return functions[name]!
      }
      // the small arities are spelled out so an ordinary call allocates no
      // argument array and needs no spread
      switch (args.length) {
        case 0: {
          return () => lookup()()
        }
        case 1: {
          const [a0] = args as [CompiledNode]
          return (ctx) => lookup()(sandboxed(a0(ctx)))
        }
        case 2: {
          const [a0, a1] = args as [CompiledNode, CompiledNode]
          return (ctx) => lookup()(sandboxed(a0(ctx)), sandboxed(a1(ctx)))
        }
        case 3: {
          const [a0, a1, a2] = args as [
            CompiledNode,
            CompiledNode,
            CompiledNode
          ]
          return (ctx) =>
            lookup()(sandboxed(a0(ctx)), sandboxed(a1(ctx)), sandboxed(a2(ctx)))
        }
        default: {
          const len = args.length
          return (ctx) => {
            const vals: JexlValue[] = new Array(len)
            for (let i = 0; i < len; i++) {
              vals[i] = sandboxed(args[i]!(ctx))
            }
            return lookup()(...vals)
          }
        }
      }
    }

    case 'SequenceExpression': {
      const exprs = node.expressions.map(compile)
      const len = exprs.length
      return (ctx) => {
        let last: JexlValue
        for (let i = 0; i < len; i++) {
          last = exprs[i]!(ctx)
        }
        return last
      }
    }

    case 'AssignmentExpression': {
      if (scope.params) {
        throw new Error('Assignment is not supported in a lambda')
      }
      const right = compile(node.right)
      const { slots, frame } = scope.locals!
      const slot = slots.get(node.left.value)!
      return (ctx) => (frame.locals[slot] = right(ctx))
    }

    case 'Lambda': {
      const body = compileNode(node.body, grammar, {
        ...scope,
        params: { names: node.params, outer: scope.params }
      })
      if (!scope.params) {
        const frame = scope.locals?.frame
        return (ctx) => {
          const locals = frame?.locals
          return lambda((...args) =>
            body(asContext(new LambdaFrame(args, undefined, ctx, locals)))
          )
        }
      }
      return (env) => {
        const outer = asFrame(env)
        return lambda((...args) =>
          body(
            asContext(new LambdaFrame(args, outer, outer.context, outer.locals))
          )
        )
      }
    }

    default: {
      return unknownNode(node)
    }
  }
}
