/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

import type { FieldSchema, OfKind, Type } from './types.ts'

export function itemOf(field: FieldSchema): Type {
  switch (field.type) {
    case 'number': {
      return field.domain
        ? { kind: 'number', field, domain: field.domain }
        : { kind: 'number', field }
    }
    case 'string': {
      return field.categories
        ? { kind: 'string', field, values: field.categories }
        : { kind: 'string', field }
    }
    case 'boolean':
    case 'flag': {
      return { kind: 'boolean', field }
    }
    case 'record': {
      return { kind: 'record', field, fields: new Map(), open: !!field.open }
    }
  }
}

export function typeOfField(field: FieldSchema): Type {
  const cardinality = field.cardinality ?? 'one'
  const item = itemOf(field)
  return cardinality === 'one'
    ? item
    : { kind: 'list', of: item, cardinality, field }
}

export type MutableRecord = OfKind<'record'> & { fields: Map<string, Type> }

export function recordWithin(type: Type): MutableRecord | undefined {
  if (type.kind === 'record') {
    return type as MutableRecord
  }
  return type.kind === 'list' ? recordWithin(type.of) : undefined
}

export function recordOf(schema: readonly FieldSchema[]): Type {
  const own = schema.find((field) => field.path.length === 0)
  const root: MutableRecord = {
    kind: 'record',
    fields: new Map(),
    open: !!own?.open,
    ...(own && { field: own })
  }
  const byDepth = schema
    .filter((field) => field.path.length > 0)
    .toSorted((a, b) => a.path.length - b.path.length)
  for (const field of byDepth) {
    let parent = root
    for (const name of field.path.slice(0, -1)) {
      const next = name === '*' ? parent.each : parent.fields.get(name)
      let record = next && recordWithin(next)
      if (!record) {
        record = { kind: 'record', fields: new Map(), open: true }
        if (name === '*') {
          parent.each = record
        } else {
          parent.fields.set(name, record)
        }
      }
      parent = record
    }
    const name = field.path.at(-1)!
    const type = typeOfField(field)
    if (name === '*') {
      parent.each = type
    } else {
      parent.fields.set(name, type)
    }
  }
  return root
}
