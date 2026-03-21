/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { BinaryOp, UnaryOp } from '../grammar.ts'
import type {
  ArrayLiteral,
  AssignmentExpression,
  AstNode,
  BinaryExpression,
  ConditionalExpression,
  FilterExpression,
  FunctionCall,
  Identifier,
  JexlValue,
  Literal,
  ObjectLiteral,
  SequenceExpression,
  TemplateLiteral,
  UnaryExpression,
} from '../types.ts'
import type Evaluator from './Evaluator.ts'

const poolNames: Record<string, string> = {
  functions: 'Jexl Function'
}

/**
 * Evaluates an ArrayLiteral by returning its value, with each element
 * independently run through the evaluator.
 * @param {{type: 'ObjectLiteral', value: <{}>}} ast An expression tree with an
 *      ObjectLiteral as the top node
 * @returns {[]} an array of evaluated values.
 * @private
 */
export function ArrayLiteral(this: Evaluator, ast: ArrayLiteral): JexlValue {
  return this.evalArray(ast.value)
}

/**
 * Evaluates a BinaryExpression node by running the Grammar's evaluator for
 * the given operator. Note that binary expressions support two types of
 * evaluators: `eval` is called with the left and right operands pre-evaluated.
 * `evalOnDemand`, if it exists, will be called with the left and right operands
 * each individually wrapped in an object with an "eval" function that returns
 * the resulting value. This allows the binary expression to evaluate the
 * operands conditionally.
 * @param {{type: 'BinaryExpression', operator: <string>, left: {},
 *      right: {}}} ast An expression tree with a BinaryExpression as the top
 *      node
 * @returns {*} the value of the BinaryExpression.
 * @private
 */
export function BinaryExpression(this: Evaluator, ast: BinaryExpression): JexlValue {
  const grammarOp = this._grammar.elements[ast.operator]
  if (grammarOp.type === 'binaryOp') {
    const binaryOp = grammarOp as BinaryOp
    if (binaryOp.evalOnDemand) {
      const wrap = (subAst: AstNode) => ({ eval: () => this.eval(subAst) })
      return binaryOp.evalOnDemand(wrap(ast.left), wrap(ast.right!))
    }
    const left = this.eval(ast.left)
    const right = this.eval(ast.right!)
    if (binaryOp.eval) {
      return binaryOp.eval(left, right)
    }
  }
  return undefined
}

/**
 * Evaluates a ConditionalExpression node by first evaluating its test branch,
 * and returning the consequent branch if the test is truthy, or the alternate
 * branch if it is not. If there is no consequent branch, the test result will
 * be used instead.
 * @param {{type: 'ConditionalExpression', test: {}, consequent: {},
 *      alternate: {}}} ast An expression tree with a ConditionalExpression as
 *      the top node
 * @private
 */
export function ConditionalExpression(this: Evaluator, ast: ConditionalExpression): JexlValue {
  const res = this.eval(ast.test)
  if (res) {
    return ast.consequent ? this.eval(ast.consequent) : res
  }
  return this.eval(ast.alternate!)
}

/**
 * Evaluates a FilterExpression by applying bracket notation for array/object access.
 * Note: Relative filtering (with leading dot) is not supported.
 * @param {{type: 'FilterExpression', relative: <boolean>, expr: {},
 *      subject: {}}} ast An expression tree with a FilterExpression as the top
 *      node
 * @returns {*} the value at the specified index/property.
 * @private
 */
export function FilterExpression(this: Evaluator, ast: FilterExpression): JexlValue {
  const subject = this.eval(ast.subject)
  if (ast.relative) {
    throw new Error('Relative filter expressions are not supported')
  }
  const index = this.eval(ast.expr)
  if (subject == null) {
    return undefined
  }
  if (typeof index === 'string' || typeof index === 'number') {
    return (subject as Record<string | number, JexlValue>)[index]
  }
  return undefined
}

/**
 * Evaluates an Identifier by either stemming from the evaluated 'from'
 * expression tree or accessing the context provided when this Evaluator was
 * constructed.
 * @param {{type: 'Identifier', value: <string>, [from]: {}}} ast An expression
 *      tree with an Identifier as the top node
 * @returns {*} the identifier's value.
 * @private
 */
export function Identifier(this: Evaluator, ast: Identifier): JexlValue {
  if (!ast.from) {
    const contextSource = ast.relative ? this._relContext : this._context
    return contextSource[ast.value]
  }
  const context = this.eval(ast.from)
  if (context == null) {
    return undefined
  }
  const ctx = Array.isArray(context) ? context[0] : context
  if (ctx == null) {
    return undefined
  }
  return (ctx as Record<string, JexlValue>)[ast.value]
}

/**
 * Evaluates a Literal by returning its value property.
 * @param {{type: 'Literal', value: <string|number|boolean>}} ast An expression
 *      tree with a Literal as its only node
 * @returns {string|number|boolean} The value of the Literal node
 * @private
 */
export function Literal(this: Evaluator, ast: Literal): JexlValue {
  return ast.value
}

/**
 * Evaluates a TemplateLiteral by evaluating each interpolated expression
 * and concatenating all parts into a final string.
 * @param {{type: 'TemplateLiteral', parts: Array<{}>}} ast An expression
 *      tree with a TemplateLiteral as the top node
 * @returns {string} the final interpolated string
 * @private
 */
export function TemplateLiteral(this: Evaluator, ast: TemplateLiteral): JexlValue {
  const values = ast.parts.map((part) => {
    if (part.type === 'static') {
      return part.value as string
    }
    const result = this.eval(part.value as AstNode)
    if (result == null) {
      return ''
    }
    if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
      return String(result)
    }
    return JSON.stringify(result)
  })

  return values.join('')
}

/**
 * Evaluates an ObjectLiteral by returning its value, with each key
 * independently run through the evaluator.
 * @param {{type: 'ObjectLiteral', value: <{}>}} ast An expression tree with an
 *      ObjectLiteral as the top node
 * @returns {{}} a map of evaluated values.
 * @private
 */
export function ObjectLiteral(this: Evaluator, ast: ObjectLiteral): JexlValue {
  return this.evalMap(ast.value)
}

/**
 * Evaluates a FunctionCall node by applying the supplied arguments to a
 * function defined in one of the grammar's function pools.
 * @param {{type: 'FunctionCall', name: <string>}} ast An
 *      expression tree with a FunctionCall as the top node
 * @returns {*} the value of the function call.
 * @private
 */
export function FunctionCall(this: Evaluator, ast: FunctionCall): JexlValue {
  const poolName = poolNames[ast.pool]
  if (!poolName) {
    throw new Error(`Corrupt AST: Pool '${ast.pool}' not found`)
  }
  const pool = this._grammar[ast.pool as keyof typeof this._grammar] as
    | Record<string, (...args: JexlValue[]) => JexlValue>
    | undefined
  const func = pool?.[ast.name]
  if (func === undefined) {
    throw new Error(`${poolName} ${ast.name} is not defined.`)
  }
  const args = this.evalArray(ast.args)
  return func(...args)
}

/**
 * Evaluates a Unary expression by passing the right side through the
 * operator's eval function.
 * @param {{type: 'UnaryExpression', operator: <string>, right: {}}} ast An
 *      expression tree with a UnaryExpression as the top node
 * @returns {*} the value of the UnaryExpression.
 * @constructor
 */
export function UnaryExpression(this: Evaluator, ast: UnaryExpression): JexlValue {
  const right = this.eval(ast.right!)
  const elem = this._grammar.elements[ast.operator]
  if (elem.type === 'unaryOp') {
    return (elem as UnaryOp).eval(right)
  }
  return undefined
}

/**
 * Evaluates a SequenceExpression by evaluating each expression in order
 * and returning the value of the last expression.
 */
export function SequenceExpression(this: Evaluator, ast: SequenceExpression): JexlValue {
  let lastValue: JexlValue

  for (const expr of ast.expressions) {
    lastValue = this.eval(expr)
  }

  return lastValue
}

/**
 * Evaluates an AssignmentExpression by evaluating the right side
 * and assigning it to the variable name on the left side.
 */
export function AssignmentExpression(this: Evaluator, ast: AssignmentExpression): JexlValue {
  const value = this.eval(ast.right!)
  const varName = ast.left.value
  this._context[varName] = value
  return value
}
