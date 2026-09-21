/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

/* eslint eqeqeq:0 */

import { collectionFunctions } from './collections.ts'
import {
  addsPairwise,
  anyPair,
  isIn,
  isList,
  matches,
  pairwise
} from './operators.ts'

import type { JexlValue } from './types.ts'

export type BinaryOpEval = (left: JexlValue, right: JexlValue) => JexlValue

/**
 * A function or operator implementation as its author writes it, for the
 * registration methods on {@link Jexl} to accept.
 *
 * Jexl cannot check what a registered callback will be handed. The arguments
 * are whatever the expression evaluated to, drawn from a context supplied at
 * evaluation time, and that context routinely holds values jexl has no literal
 * for — a host object with methods, a callback, a class instance. Requiring
 * {@link JexlValue} parameters therefore rejected every callback actually
 * written against such a value, since parameters are contravariant. The
 * argument types are the caller's business; jexl only promises to pass along
 * whatever the operands evaluated to.
 */
export type UncheckedFn = (...args: never[]) => unknown

export type BinaryOpEvalOnDemand = (
  left: { eval: () => JexlValue },
  right: { eval: () => JexlValue }
) => JexlValue

export interface BinaryOp {
  type: 'binaryOp'
  precedence: number
  eval?: BinaryOpEval
  evalOnDemand?: BinaryOpEvalOnDemand
  /**
   * Evaluator for the operator's prefix form, if it has one. The Lexer emits a
   * unaryOp token when such an operator appears where an operand is expected,
   * which is how `-x` is distinguished from `a - x`.
   */
  unaryEval?: (right: JexlValue) => JexlValue
  /** Groups a chain from the right, so `a ^ b ^ c` is `a ^ (b ^ c)`. */
  rightAssociative?: boolean
}

export type UnaryOpEval = (right: JexlValue) => JexlValue

export interface UnaryOp {
  type: 'unaryOp'
  precedence: number
  eval: UnaryOpEval
}

/**
 * The punctuation elements of the grammar. Unlike operators these carry no
 * behavior of their own; the Parser gives them meaning. The type is a literal
 * union rather than `string` so that `GrammarElement` is a discriminated union,
 * letting operator properties be accessed without casts.
 */
export interface SimpleElement {
  type:
    | 'dot'
    | 'openBracket'
    | 'closeBracket'
    | 'openCurl'
    | 'closeCurl'
    | 'colon'
    | 'comma'
    | 'openParen'
    | 'closeParen'
    | 'question'
    | 'semicolon'
    | 'arrow'
}

export type GrammarElement = BinaryOp | UnaryOp | SimpleElement

/** A registered function, as jexl calls it once the operands are evaluated. */
export type GrammarFn = (...args: JexlValue[]) => JexlValue

/**
 * Reads `key` off `subject` for `subject.key` and `subject[key]`, in place of
 * a plain property read. Like a registered function, it is handed host values
 * jexl has no type for, so the subject is only promised not to be nullish.
 */
export type GetMember = (
  subject: NonNullable<unknown>,
  key: string | number
) => unknown

/**
 * Called once per bare variable name as an expression compiles. A reader it
 * returns replaces `context[name]` for that name; `undefined` keeps it.
 */
export type VariableReader = (
  name: string
) => ((context: Record<string, unknown>) => unknown) | undefined

export interface Grammar {
  elements: Record<string, GrammarElement>
  functions: Record<string, GrammarFn>
  getMember?: GetMember
  variableReader?: VariableReader
}

const plus = (left: JexlValue, right: JexlValue) =>
  (left as number) + (right as number)
const minus = (left: JexlValue, right: JexlValue) =>
  (left as number) - (right as number)
const times = (left: JexlValue, right: JexlValue) =>
  (left as number) * (right as number)
const divide = (left: JexlValue, right: JexlValue) =>
  (left as number) / (right as number)
const floorDivide = (left: JexlValue, right: JexlValue) =>
  Math.floor((left as number) / (right as number))
const modulo = (left: JexlValue, right: JexlValue) =>
  (left as number) % (right as number)
const power = (left: JexlValue, right: JexlValue) =>
  (left as number) ** (right as number)
const loose = (left: JexlValue, right: JexlValue) => left == right
// a missing value orders against nothing, as bcftools skips one; JavaScript
// alone would read null as 0, making [null, 0.2] < 0.05 true
const greater = (left: JexlValue, right: JexlValue) =>
  left != null && right != null && (left as number) > (right as number)
const atLeast = (left: JexlValue, right: JexlValue) =>
  left != null && right != null && (left as number) >= (right as number)
const less = (left: JexlValue, right: JexlValue) =>
  left != null && right != null && (left as number) < (right as number)
const atMost = (left: JexlValue, right: JexlValue) =>
  left != null && right != null && (left as number) <= (right as number)
// named so the compiler can recognize the built-in forms and short-circuit
// without the thunks a host's evalOnDemand operator is handed
export const and: BinaryOpEvalOnDemand = (left, right) => {
  const leftVal = left.eval()
  return leftVal ? right.eval() : leftVal
}
export const or: BinaryOpEvalOnDemand = (left, right) => {
  const leftVal = left.eval()
  return leftVal ? leftVal : right.eval()
}
export const nullish: BinaryOpEvalOnDemand = (left, right) =>
  left.eval() ?? right.eval()

const equals = (left: JexlValue, right: JexlValue) =>
  isList(left, right) ? anyPair(loose, left, right) : left == right

export const getGrammar = (): Grammar => ({
  /**
   * A map of all expression elements to their properties. Note that changes
   * here may require changes in the Lexer or Parser.
   * @type {{}}
   */
  elements: {
    '.': { type: 'dot' },
    '[': { type: 'openBracket' },
    ']': { type: 'closeBracket' },
    '{': { type: 'openCurl' },
    '}': { type: 'closeCurl' },
    ':': { type: 'colon' },
    ',': { type: 'comma' },
    '(': { type: 'openParen' },
    ')': { type: 'closeParen' },
    '?': { type: 'question' },
    ';': { type: 'semicolon' },
    '=>': { type: 'arrow' },
    '+': {
      type: 'binaryOp',
      precedence: 30,
      eval: (left, right) =>
        addsPairwise(left, right)
          ? pairwise(plus, left, right)
          : plus(left, right)
    },
    '-': {
      type: 'binaryOp',
      precedence: 30,
      eval: (left, right) =>
        isList(left, right) ? pairwise(minus, left, right) : minus(left, right),
      unaryEval: (right) =>
        Array.isArray(right)
          ? right.map((value) => -(value as number))
          : -(right as number)
    },
    '*': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) =>
        isList(left, right) ? pairwise(times, left, right) : times(left, right)
    },
    '/': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) =>
        isList(left, right)
          ? pairwise(divide, left, right)
          : divide(left, right)
    },
    '//': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) =>
        isList(left, right)
          ? pairwise(floorDivide, left, right)
          : floorDivide(left, right)
    },
    '%': {
      type: 'binaryOp',
      precedence: 50,
      eval: (left, right) =>
        isList(left, right)
          ? pairwise(modulo, left, right)
          : modulo(left, right)
    },
    '^': {
      type: 'binaryOp',
      precedence: 50,
      rightAssociative: true,
      eval: (left, right) =>
        isList(left, right) ? pairwise(power, left, right) : power(left, right)
    },
    '==': {
      type: 'binaryOp',
      precedence: 20,
      eval: equals
    },
    '!=': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => !equals(left, right)
    },
    '~': {
      type: 'binaryOp',
      precedence: 20,
      eval: matches
    },
    '!~': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => !matches(left, right)
    },
    '>': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) =>
        isList(left, right)
          ? anyPair(greater, left, right)
          : greater(left, right)
    },
    '>=': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) =>
        isList(left, right)
          ? anyPair(atLeast, left, right)
          : atLeast(left, right)
    },
    '<': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) =>
        isList(left, right) ? anyPair(less, left, right) : less(left, right)
    },
    '<=': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) =>
        isList(left, right) ? anyPair(atMost, left, right) : atMost(left, right)
    },
    '&&': {
      type: 'binaryOp',
      precedence: 11,
      evalOnDemand: and
    },
    '||': {
      type: 'binaryOp',
      precedence: 10,
      evalOnDemand: or
    },
    '??': {
      type: 'binaryOp',
      precedence: 10,
      evalOnDemand: nullish
    },
    in: {
      type: 'binaryOp',
      precedence: 20,
      eval: isIn
    },
    '!': {
      type: 'unaryOp',
      precedence: Infinity,
      eval: (right) => !right
    },
    '=': {
      type: 'binaryOp',
      precedence: 2,
      eval: (_left, _right) => {
        throw new Error('Assignment handled specially')
      }
    }
  },

  /**
   * A map of function names to javascript functions. A Jexl function
   * takes zero or more arguments:
   *
   *     - {*} ...args: A variable number of arguments passed to this function.
   *       All of these are pre-evaluated to their actual values before calling
   *       the function.
   *
   * The Jexl function should return the resulting value, or throw when an
   * unrecoverable error occurs. Functions should generally return undefined
   * when they don't make sense to be used on the given value type, rather
   * than throw. An error is only appropriate when the function would normally
   * return a value, but cannot due to some other failure.
   */
  functions: { ...collectionFunctions }
})
