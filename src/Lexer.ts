/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import { JexlSyntaxError } from './errors.ts'

import type { Grammar } from './grammar.ts'
import type { TemplatePart, Token } from './types.ts'

// what an identifier and a number look like, written once: the split regex
// below carves elements out of the expression with these, and _createToken
// then re-tests the elements it produced. Two spellings of either would
// disagree on some input, and each disagreement is an "Invalid expression
// token" for something the splitter was happy to produce.
const identChars = String.raw`a-zA-Zа-яА-Я_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF$`
const identPart = `[${identChars}0-9]`
const identPattern = `[${identChars}]${identPart}*`
// a word operator such as `in`, but not part of a longer name. \b would do only
// for ASCII names, and split `in$` or `inà` into the operator and a remainder
const wholeWord = (word: string) => `(?<!${identPart})${word}(?!${identPart})`
// unsigned: whether a leading '-' negates is decided separately, in getTokens
const numberPattern = String.raw`(?:(?:[0-9]*\.[0-9]+)|[0-9]+)(?:[eE][+-]?[0-9]+)?`

const numericRegex = new RegExp(`^-?${numberPattern}$`)
export const identRegex = new RegExp(`^${identPattern}$`)
// the escapes each kind of literal recognizes. One pass, so the backslash an
// escaped backslash yields can't be re-read as the start of the escape that
// follows it
const quoteEscRegex = { "'": /\\([\\'])/g, '"': /\\([\\"])/g }
const templateEscRegex = /\\([`$\\])/g
const whitespaceRegex = /^\s*$/
// a backslash and the character after it are a pair, so an escaped backslash
// before the closing quote can't escape that quote
const quoted = (quote: string) =>
  String.raw`${quote}(?:\\[\s\S]|[^${quote}\\])*${quote}`
const preOpRegexElems = [
  quoted('`'),
  quoted("'"),
  quoted('"'),
  // Whitespace
  String.raw`\s+`,
  // ahead of the grammar's '.', so that '.5' is a number rather than a dot
  numberPattern
]
const postOpRegexElems = [identPattern]
const unaryMinusToken = (): Token => ({
  type: 'unaryOp',
  value: '-',
  raw: '-'
})
const minusNegatesAfter = new Set([
  'binaryOp',
  'unaryOp',
  'openParen',
  'openBracket',
  'question',
  'colon',
  'comma',
  'semicolon',
  'arrow',
  'assign'
])
// whether a `-` after this token negates what follows rather than subtracting
const negates = (last: Token | undefined) =>
  !last || minusNegatesAfter.has(last.type)

/**
 * Lexer handles the lexical parsing of a Jexl string. Its responsibility is to
 * identify the "parts of speech" of a Jexl expression, and tokenize and label
 * each, but to do only the most minimal syntax checking; the only errors the
 * Lexer should be concerned with are if it's unable to identify the utility of
 * any of its tokens. Errors stemming from these tokens not being in a sensible
 * configuration should be left for the Parser to handle.
 *
 * An instance is bound to one grammar and memoizes the regex that splits an
 * expression into elements, which is expensive to build; {@link #_clearCache}
 * discards it when the grammar's elements change.
 */
class Lexer {
  _grammar: Grammar
  _splitRegex?: RegExp

  constructor(grammar: Grammar) {
    this._grammar = grammar
  }

  /**
   * Discards the memoized split regex, so that it is rebuilt on the next
   * tokenize. Must be called whenever the grammar's elements change, since the
   * regex is derived from their keys.
   */
  _clearCache() {
    this._splitRegex = undefined
  }

  /** Splits a Jexl string into its elements: tokens and runs of whitespace. */
  getElements(str: string) {
    return str.split(this._getSplitRegex()).filter(Boolean)
  }

  /**
   * The tokens for a list of elements. Whitespace makes no token of its own;
   * it joins the `raw` of the token before it.
   */
  getTokens(elements: string[]) {
    const tokens: Token[] = []
    // a prefix minus, held back until the element it applies to is known. It
    // carries its own raw so that whitespace arriving before that element ("-
    // 1") accumulates on the minus rather than on the token before it, which
    // is what lets the parser's error messages quote the expression verbatim.
    let pendingMinus: Token | undefined
    let offset = 0
    for (const element of elements) {
      if (whitespaceRegex.test(element)) {
        const last = pendingMinus ?? tokens.at(-1)
        if (last) {
          last.raw += element
        }
      } else if (element === '-' && negates(tokens.at(-1))) {
        // a second prefix minus in a row ("- -x"): emit the pending one as a
        // unary operator so this one can negate whatever comes next
        if (pendingMinus) {
          tokens.push(pendingMinus)
        }
        pendingMinus = unaryMinusToken()
      } else if (pendingMinus) {
        if (numericRegex.test(element)) {
          // fold the sign into the number, so "-1" stays a single literal
          const token = this._createToken('-' + element, offset)
          token.raw = pendingMinus.raw + element
          tokens.push(token)
        } else {
          // anything else gets a standalone prefix operator, letting "-x",
          // "-(a + b)" and "-foo.bar" negate a computed value
          tokens.push(pendingMinus, this._createToken(element, offset))
        }
        pendingMinus = undefined
      } else {
        tokens.push(this._createToken(element, offset))
      }
      offset += element.length
    }
    // Catch a - at the end of the string. Let the parser handle that issue.
    if (pendingMinus) {
      tokens.push(pendingMinus)
    }
    return tokens
  }

  /**
   * Splits a Jexl string into tokens. A token's `type` is `literal`,
   * `templateString`, `identifier` or the type of the grammar element it
   * spells; its `value` is a literal's value or the template's parts; its `raw`
   * is its source text and any whitespace after it.
   * @throws {JexlSyntaxError} for text that is no token
   */
  tokenize(str: string) {
    return this.getTokens(this.getElements(str))
  }

  _createToken(element: string, offset = 0): Token {
    const token: Token = {
      type: 'literal',
      value: element,
      raw: element
    }
    if (element.startsWith('`')) {
      token.type = 'templateString'
      token.value = this._parseTemplateString(element, offset)
      return token
    } else if (element.startsWith('"') || element.startsWith("'")) {
      token.value = this._unquote(element)
    } else if (numericRegex.test(element)) {
      token.value = parseFloat(element)
    } else if (element === 'true' || element === 'false') {
      token.value = element === 'true'
    } else if (element === 'null') {
      token.value = null
    } else if (Object.hasOwn(this._grammar.elements, element)) {
      token.type = this._grammar.elements[element]!.type
    } else if (identRegex.test(element)) {
      token.type = 'identifier'
    } else {
      throw new JexlSyntaxError(`Invalid expression token: ${element}`, offset)
    }
    return token
  }

  /** A grammar element's text as a regex. A word such as `in` also stops
   * matching inside a longer name. */
  _escapeRegExp(str: string) {
    const escaped = str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
    return identRegex.test(str) ? wholeWord(escaped) : escaped
  }

  _getSplitRegex() {
    if (!this._splitRegex) {
      // longest first, so that `==` wins over `=`
      const elements = Object.keys(this._grammar.elements)
        .sort((a, b) => b.length - a.length)
        .map((element) => this._escapeRegExp(element))
      this._splitRegex = new RegExp(
        `(${[...preOpRegexElems, ...elements, ...postOpRegexElems].join('|')})`
      )
    }
    return this._splitRegex
  }

  /** A quoted string literal's text, unquoted and unescaped. */
  _unquote(str: string) {
    const quote = str.startsWith('"') ? '"' : "'"
    return str.slice(1, -1).replaceAll(quoteEscRegex[quote], '$1')
  }

  _parseTemplateString(str: string, offset = 0) {
    const parts: TemplatePart[] = []
    let current = 1
    let staticStart = 1

    while (current < str.length - 1) {
      if (str[current] === '\\') {
        current += 2
        continue
      }

      if (str[current] === '$' && str[current + 1] === '{') {
        if (current > staticStart) {
          parts.push({
            type: 'static',
            value: str.slice(staticStart, current)
          })
        }

        let braceDepth = 1
        const interpStart = current + 2
        current += 2

        while (current < str.length && braceDepth > 0) {
          const char = str[current]
          if (char === '\\') {
            current += 2
            continue
          }
          // skip over string literals so that braces inside them, as in
          // `${ f('}') }`, don't unbalance the depth count
          if (char === '"' || char === "'") {
            current++
            while (current < str.length && str[current] !== char) {
              current += str[current] === '\\' ? 2 : 1
            }
            current++
            continue
          }
          if (char === '{') {
            braceDepth++
          } else if (char === '}') {
            braceDepth--
          }
          current++
        }

        if (braceDepth !== 0) {
          throw new JexlSyntaxError(
            `Unclosed interpolation in template string: ${str}`,
            offset + interpStart - '${'.length
          )
        }

        parts.push({
          type: 'interpolation',
          value: str.slice(interpStart, current - 1)
        })

        staticStart = current
      } else {
        current++
      }
    }

    if (current > staticStart) {
      parts.push({
        type: 'static',
        value: str.slice(staticStart, current)
      })
    }

    return parts
  }

  _unescapeTemplateString(str: string) {
    return str.replaceAll(templateEscRegex, '$1')
  }
}

export default Lexer
