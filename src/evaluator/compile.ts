/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { Grammar } from '../grammar.ts'
import type { AstNode, AstNodeUnion, JexlValue } from '../types.ts'

/** The variables an expression is evaluated against. */
export type Context = Record<string, JexlValue>

/**
 * An AST node lowered to a closure. Calling it with a context produces the
 * node's value. The grammar is captured when the closure is built, so it is not
 * a parameter.
 */
export type CompiledNode = (context: Context) => JexlValue

/**
 * Writes a key that a plain assignment would mishandle. Storing to
 * "__proto__" invokes the prototype setter rather than creating a property, so
 * an object literal or assignment using that key silently lost its value (and
 * re-pointed the target's prototype). Defining the property instead matches
 * what `JSON.parse('{"__proto__":1}')` produces: an ordinary own property.
 */
function defineOwn(target: Context, key: string, value: JexlValue) {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  })
}

function assignOwn(target: Context, key: string, value: JexlValue) {
  target[key] = value
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

/**
 * Lowers an expression tree into a tree of closures, resolving each node's type
 * and its operator's implementation once, at compile time, rather than
 * re-dispatching on `node.type` for every node on every evaluation. An
 * expression compiled once and evaluated per-item — the usual shape for
 * per-feature config callbacks — pays the dispatch cost once instead of N
 * times.
 *
 * Operators are bound here, so a grammar change after compilation requires
 * recompiling, which is what {@link Expression#compile} already documents.
 * Functions are looked up per call, since they are commonly registered after
 * an expression has been compiled.
 *
 * @param {{}} ast An expression tree, as produced by the Parser
 * @param {{}} grammar The grammar to resolve operators against
 * @returns {function} a closure returning the expression's value
 * @throws {Error} if the tree contains an unrecognized node type
 */
export function compileAst(ast: AstNode, grammar: Grammar): CompiledNode {
  // AstNode types its `type` as a plain string so the Parser can build the tree
  // loosely; narrowing to the union once, here, lets every case below see its
  // own node type instead of repeating the same cast in each branch
  const node = ast as AstNodeUnion
  switch (node.type) {
    case 'Literal': {
      const { value } = node
      return () => value
    }

    case 'Identifier': {
      const name = node.value
      if (!node.from) {
        return (ctx) => ctx[name]
      }
      const from = compileAst(node.from, grammar)
      return (ctx) => {
        const subject = from(ctx)
        if (subject == null) {
          return undefined
        }
        // an identifier chained off an array reads through its first element
        const target = Array.isArray(subject) ? subject[0] : subject
        return target == null ? undefined : (target as Context)[name]
      }
    }

    case 'BinaryExpression': {
      const op = grammar.elements[node.operator]
      if (op?.type !== 'binaryOp') {
        // matches the tree-walking behaviour: an unknown operator yields
        // undefined without evaluating either operand
        return () => undefined
      }
      const left = compileAst(node.left, grammar)
      const right = compileAst(node.right!, grammar)
      const { evalOnDemand } = op
      if (evalOnDemand) {
        // operands stay unevaluated behind an `eval` thunk, so operators such
        // as && and || can short-circuit
        return (ctx) =>
          evalOnDemand({ eval: () => left(ctx) }, { eval: () => right(ctx) })
      }
      const fn = op.eval
      if (!fn) {
        return (ctx) => {
          left(ctx)
          right(ctx)
          return undefined
        }
      }
      return (ctx) => fn(left(ctx), right(ctx))
    }

    case 'UnaryExpression': {
      const right = compileAst(node.right!, grammar)
      const elem = grammar.elements[node.operator]
      const fn =
        elem?.type === 'unaryOp'
          ? elem.eval
          : elem?.type === 'binaryOp'
            ? elem.unaryEval
            : undefined
      if (!fn) {
        // the operand is still evaluated for an unknown operator, as before
        return (ctx) => {
          right(ctx)
          return undefined
        }
      }
      return (ctx) => fn(right(ctx))
    }

    case 'ConditionalExpression': {
      const test = compileAst(node.test, grammar)
      const consequent = node.consequent
        ? compileAst(node.consequent, grammar)
        : undefined
      const alternate = node.alternate
        ? compileAst(node.alternate, grammar)
        : undefined
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
      const subject = compileAst(node.subject, grammar)
      const index = compileAst(node.expr, grammar)
      return (ctx) => {
        const subjectVal = subject(ctx)
        const indexVal = index(ctx)
        if (subjectVal == null) {
          return undefined
        }
        return typeof indexVal === 'string' || typeof indexVal === 'number'
          ? (subjectVal as Record<string | number, JexlValue>)[indexVal]
          : undefined
      }
    }

    case 'ArrayLiteral': {
      const items = node.value.map((item) => compileAst(item, grammar))
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
      const values = entries.map(([, value]) => compileAst(value, grammar))
      const len = keys.length
      // resolved once, here, so the common case keeps its plain store
      const store = keys.includes('__proto__') ? defineOwn : assignOwn
      return (ctx) => {
        const out: Record<string, JexlValue> = {}
        for (let i = 0; i < len; i++) {
          store(out, keys[i]!, values[i]!(ctx))
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
        const expr = compileAst(part.value, grammar)
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
      const args = node.args.map((arg) => compileAst(arg, grammar))
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
          return (ctx) => lookup()(a0(ctx))
        }
        case 2: {
          const [a0, a1] = args as [CompiledNode, CompiledNode]
          return (ctx) => lookup()(a0(ctx), a1(ctx))
        }
        case 3: {
          const [a0, a1, a2] = args as [
            CompiledNode,
            CompiledNode,
            CompiledNode
          ]
          return (ctx) => lookup()(a0(ctx), a1(ctx), a2(ctx))
        }
        default: {
          const len = args.length
          return (ctx) => {
            const vals: JexlValue[] = new Array(len)
            for (let i = 0; i < len; i++) {
              vals[i] = args[i]!(ctx)
            }
            return lookup()(...vals)
          }
        }
      }
    }

    case 'SequenceExpression': {
      const exprs = node.expressions.map((expr) => compileAst(expr, grammar))
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
      const name = node.left.value
      const right = compileAst(node.right!, grammar)
      const store = name === '__proto__' ? defineOwn : assignOwn
      return (ctx) => {
        const value = right(ctx)
        store(ctx, name, value)
        return value
      }
    }

    default: {
      throw new Error(`Corrupt AST: unknown node type '${ast.type}'`)
    }
  }
}
