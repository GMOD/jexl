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
