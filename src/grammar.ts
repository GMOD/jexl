/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

/* eslint eqeqeq:0 */

import type { JexlValue } from './types.ts'

export type BinaryOpEval = (left: JexlValue, right: JexlValue) => JexlValue

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
}

export interface UnaryOp {
  type: 'unaryOp'
  precedence: number
  eval: (right: JexlValue) => JexlValue
}

/**
 * The punctuation elements of the grammar. Unlike operators these carry no
 * behavior of their own; the Parser's state machine gives them meaning. The
 * type is a literal union rather than `string` so that `GrammarElement` is a
 * discriminated union, letting operator properties be accessed without casts.
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
}

export type GrammarElement = BinaryOp | UnaryOp | SimpleElement

export interface Grammar {
  elements: Record<string, GrammarElement>
  functions: Record<string, (...args: JexlValue[]) => JexlValue>
}

/**
 * Returns the binding power of a grammar element, or 0 for elements that
 * aren't operators and therefore don't participate in precedence.
 */
export function precedenceOf(elem: GrammarElement | undefined) {
  return elem && (elem.type === 'binaryOp' || elem.type === 'unaryOp')
    ? elem.precedence
    : 0
}

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
    '+': {
      type: 'binaryOp',
      precedence: 30,
      eval: (left, right) => (left as number) + (right as number)
    },
    '-': {
      type: 'binaryOp',
      precedence: 30,
      eval: (left, right) => (left as number) - (right as number),
      unaryEval: (right) => -(right as number)
    },
    '*': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) => (left as number) * (right as number)
    },
    '/': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) => (left as number) / (right as number)
    },
    '//': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) => Math.floor((left as number) / (right as number))
    },
    '%': {
      type: 'binaryOp',
      precedence: 50,
      eval: (left, right) => (left as number) % (right as number)
    },
    '^': {
      type: 'binaryOp',
      precedence: 50,
      eval: (left, right) => (left as number) ** (right as number)
    },
    '==': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => left == right
    },
    '!=': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => left != right
    },
    '>': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => (left as number) > (right as number)
    },
    '>=': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => (left as number) >= (right as number)
    },
    '<': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => (left as number) < (right as number)
    },
    '<=': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => (left as number) <= (right as number)
    },
    '&&': {
      type: 'binaryOp',
      precedence: 10,
      evalOnDemand: (left, right) => {
        const leftVal = left.eval()
        if (!leftVal) {
          return leftVal
        }
        return right.eval()
      }
    },
    '||': {
      type: 'binaryOp',
      precedence: 10,
      evalOnDemand: (left, right) => {
        const leftVal = left.eval()
        if (leftVal) {
          return leftVal
        }
        return right.eval()
      }
    },
    in: {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => {
        if (typeof right === 'string') {
          const leftStr =
            typeof left === 'string' ||
            typeof left === 'number' ||
            typeof left === 'boolean'
              ? String(left)
              : ''
          return right.includes(leftStr)
        }
        if (Array.isArray(right)) {
          return right.includes(left)
        }
        return false
      }
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
   * takes zero ore more arguemnts:
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
  functions: {}
})
