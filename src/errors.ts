/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

/** A malformed expression. `offset` is where in the source it went wrong. */
export class JexlSyntaxError extends Error {
  offset: number

  constructor(message: string, offset: number) {
    super(message)
    this.name = 'JexlSyntaxError'
    this.offset = offset
  }
}

/**
 * Throws for a node no case of a walk handled. Typing it `never` makes a new
 * node type a compile error in every walk that doesn't handle it yet.
 */
export function unknownNode(node: never): never {
  throw new Error(
    `Corrupt AST: unknown node type '${(node as { type: string }).type}'`
  )
}
