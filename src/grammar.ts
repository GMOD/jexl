/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

/* eslint eqeqeq:0 */

export interface BinaryOp {
  type: 'binaryOp'
  precedence: number
  eval?: (left: any, right: any) => any
  evalOnDemand?: (left: { eval: () => Promise<any> }, right: { eval: () => Promise<any> }) => Promise<any>
}

export interface UnaryOp {
  type: 'unaryOp'
  precedence: number
  eval: (right: any) => any
}

export interface SimpleElement {
  type: string
}

export type GrammarElement = BinaryOp | UnaryOp | SimpleElement

export interface Grammar {
  elements: {
    [key: string]: GrammarElement
  }
  functions: {
    [key: string]: (...args: any[]) => any
  }
  transforms: {
    [key: string]: (val: any, ...args: any[]) => any
  }
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
    '|': { type: 'pipe' },
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
      eval: (left, right) => left + right
    },
    '-': {
      type: 'binaryOp',
      precedence: 30,
      eval: (left, right) => left - right
    },
    '*': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) => left * right
    },
    '/': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) => left / right
    },
    '//': {
      type: 'binaryOp',
      precedence: 40,
      eval: (left, right) => Math.floor(left / right)
    },
    '%': {
      type: 'binaryOp',
      precedence: 50,
      eval: (left, right) => left % right
    },
    '^': {
      type: 'binaryOp',
      precedence: 50,
      eval: (left, right) => Math.pow(left, right)
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
      eval: (left, right) => left > right
    },
    '>=': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => left >= right
    },
    '<': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => left < right
    },
    '<=': {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => left <= right
    },
    '&&': {
      type: 'binaryOp',
      precedence: 10,
      evalOnDemand: (left, right) => {
        return left.eval().then((leftVal) => {
          if (!leftVal) return leftVal
          return right.eval()
        })
      }
    },
    '||': {
      type: 'binaryOp',
      precedence: 10,
      evalOnDemand: (left, right) => {
        return left.eval().then((leftVal) => {
          if (leftVal) return leftVal
          return right.eval()
        })
      }
    },
    in: {
      type: 'binaryOp',
      precedence: 20,
      eval: (left, right) => {
        if (typeof right === 'string') {
          return right.indexOf(left) !== -1
        }
        if (Array.isArray(right)) {
          return right.some((elem) => elem === left)
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
      eval: (left, right) => {
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
   * The Jexl function should return either the transformed value, or
   * a Promises/A+ Promise object that resolves with the value and rejects
   * or throws only when an unrecoverable error occurs. Functions should
   * generally return undefined when they don't make sense to be used on the
   * given value type, rather than throw/reject. An error is only
   * appropriate when the function would normally return a value, but
   * cannot due to some other failure.
   */
  functions: {},

  /**
   * A map of transform names to transform functions. A transform function
   * takes one ore more arguemnts:
   *
   *     - {*} val: A value to be transformed
   *     - {*} ...args: A variable number of arguments passed to this transform.
   *       All of these are pre-evaluated to their actual values before calling
   *       the function.
   *
   * The transform function should return either the transformed value, or
   * a Promises/A+ Promise object that resolves with the value and rejects
   * or throws only when an unrecoverable error occurs. Transforms should
   * generally return undefined when they don't make sense to be used on the
   * given value type, rather than throw/reject. An error is only
   * appropriate when the transform would normally return a value, but
   * cannot due to some other failure.
   */
  transforms: {}
})
