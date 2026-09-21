/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { Grammar } from '../grammar.ts'
import type {
  AstNode,
  AstNodeUnion,
  JexlFunction,
  JexlValue,
  Literal
} from '../types.ts'

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

/** The key `subject[index]` reads under, or undefined when it reads nothing. */
function memberKey(index: JexlValue) {
  return typeof index === 'string' || typeof index === 'number'
    ? index
    : indexKey(index)
}

/**
 * The key a bracket index that is neither a string nor a number reads under:
 * its string form, when it has one worth using.
 *
 * A boolean and an array of primitives do — `['a']` is the key `'a'`, exactly
 * as JS would index by it, and how a `@gmod/vcf` INFO value (always a list,
 * `Number=1` included) indexes a lookup table. A multi-valued list is the key
 * `'a,b'`, and misses rather than guess which value was meant. A plain object
 * does not, since '[object Object]' is not a key anything is stored under, so
 * it and an array holding one answer `undefined` instead. null and undefined
 * are the same case.
 */
function indexKey(value: JexlValue): string | undefined {
  if (typeof value === 'boolean') {
    return String(value)
  }
  return Array.isArray(value) && value.every(isKeyPart)
    ? value.join(',')
    : undefined
}

function isKeyPart(
  value: JexlValue
): value is string | number | boolean | null | undefined {
  return (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

/**
 * The value of an object or array literal holding only primitives, built once.
 * Indexing such a table, as in `{CDS: 'red', exon: 'blue'}[feature.type]`,
 * can only yield a primitive, so the table never escapes and one frozen copy
 * serves every evaluation.
 */
function literalTable(node: AstNode) {
  const literal = node as AstNodeUnion
  if (literal.type === 'ArrayLiteral') {
    return literal.value.every((item) => item.type === 'Literal')
      ? Object.freeze(literal.value.map((item) => (item as Literal).value))
      : undefined
  }
  if (literal.type === 'ObjectLiteral') {
    const entries = Object.entries(literal.value)
    if (entries.every(([, value]) => value.type === 'Literal')) {
      const table: Context = {}
      for (const [key, value] of entries) {
        defineOwn(table, key, (value as Literal).value)
      }
      return Object.freeze(table)
    }
  }
  return undefined
}

const unassigned = Symbol('unassigned')

/**
 * The slot each name an expression assigns is kept in, and the frame holding
 * those slots for the evaluation in progress.
 */
interface Locals {
  slots: ReadonlyMap<string, number>
  frame: { locals: unknown[] }
}

/**
 * One call of a lambda. A name the lambda binds reads from `args`, a name bound
 * by a lambda around it from `outer`, and any other name from `context`.
 */
class LambdaFrame {
  args: JexlValue[]
  outer: LambdaFrame | undefined
  context: Context

  constructor(
    args: JexlValue[],
    outer: LambdaFrame | undefined,
    context: Context
  ) {
    this.args = args
    this.outer = outer
    this.context = context
  }
}

/** The parameters of the lambdas around a node, innermost first. */
interface Params {
  names: string[]
  outer: Params | undefined
}

interface Scope {
  locals?: Locals
  params?: Params
}

// the closures compiled inside a lambda are handed its LambdaFrame in place of
// the context, and only the ones that read a name, below, look inside it
const asFrame = (env: Context) => env as unknown as LambdaFrame
const asContext = (frame: LambdaFrame) => frame as unknown as Context

function compileName(
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
  const read =
    (grammar.variableReader?.(name) as CompiledNode | undefined) ??
    ((ctx) => ctx[name])
  const fromContext: CompiledNode = scope.params
    ? (env) => read(asFrame(env).context)
    : read
  const slot = scope.locals?.slots.get(name)
  if (slot === undefined) {
    return fromContext
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

function assignedNames(ast: AstNode | undefined, names = new Set<string>()) {
  const node = ast as AstNodeUnion | undefined
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

/**
 * Compiles a whole expression. Each name it assigns gets a slot, numbered at
 * compile time, in a frame that lasts one evaluation, so an assignment never
 * touches the context and a context reused from one evaluation to the next
 * comes back unchanged. A name reads its slot once assigned, and resolves as
 * usual until then. An expression that assigns nothing gets no frame.
 *
 * The frame is not a layer over the context via `Object.create`: V8 gives
 * every object used as a prototype a map of its own, which made evaluating
 * against a context built per evaluation six times slower.
 */
export function compileExpression(
  ast: AstNode,
  grammar: Grammar
): CompiledNode {
  const names = [...assignedNames(ast)]
  if (names.length === 0) {
    return compileAst(ast, grammar)
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
 * registered after an expression has been compiled. Assignments compiled here
 * write into the context; {@link compileExpression} keeps them out of it.
 */
export function compileAst(ast: AstNode, grammar: Grammar): CompiledNode {
  return compileNode(ast, grammar, {})
}

function compileNode(
  ast: AstNode,
  grammar: Grammar,
  scope: Scope
): CompiledNode {
  const compile = (child: AstNode) => compileNode(child, grammar, scope)
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
        return compileName(name, grammar, scope)
      }
      const from = compile(node.from)
      const { getMember } = grammar
      if (getMember) {
        return (ctx) => {
          const target = from(ctx)
          return target == null
            ? undefined
            : (getMember(target, name) as JexlValue)
        }
      }
      return (ctx) => {
        const target = from(ctx)
        return target == null ? undefined : (target as Context)[name]
      }
    }

    case 'BinaryExpression': {
      const op = grammar.elements[node.operator]
      const left = compile(node.left)
      const right = compile(node.right!)
      if (op?.type === 'binaryOp' && op.evalOnDemand) {
        const { evalOnDemand } = op
        // operands stay unevaluated behind an `eval` thunk, so operators such
        // as && and || can short-circuit
        return (ctx) =>
          evalOnDemand({ eval: () => left(ctx) }, { eval: () => right(ctx) })
      }
      const fn = op?.type === 'binaryOp' ? op.eval : undefined
      if (!fn) {
        throw new Error(`Unknown binary operator '${node.operator}'`)
      }
      return (ctx) => fn(left(ctx), right(ctx))
    }

    case 'UnaryExpression': {
      const right = compile(node.right!)
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
            : (getMember(subjectVal, key) as JexlValue)
        }
      }
      return (ctx) => {
        const subjectVal = subject(ctx)
        const key = memberKey(index(ctx))
        return subjectVal == null || key === undefined
          ? undefined
          : (subjectVal as Record<string | number, JexlValue>)[key]
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
      const name = node.left.value
      const right = compile(node.right!)
      if (scope.locals) {
        const slot = scope.locals.slots.get(name)!
        const { frame } = scope.locals
        return (ctx) => (frame.locals[slot] = right(ctx))
      }
      const store = name === '__proto__' ? defineOwn : assignOwn
      return (ctx) => {
        const value = right(ctx)
        store(ctx, name, value)
        return value
      }
    }

    case 'Lambda': {
      const body = compileNode(node.body, grammar, {
        ...scope,
        params: { names: node.params, outer: scope.params }
      })
      if (!scope.params) {
        return (ctx): JexlFunction =>
          (...args) =>
            body(asContext(new LambdaFrame(args, undefined, ctx)))
      }
      return (env): JexlFunction => {
        const outer = asFrame(env)
        return (...args) =>
          body(asContext(new LambdaFrame(args, outer, outer.context)))
      }
    }

    default: {
      throw new Error(`Corrupt AST: unknown node type '${ast.type}'`)
    }
  }
}
