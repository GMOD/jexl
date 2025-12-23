/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

class PromiseSync<T = unknown> {
  value?: T
  error?: unknown

  constructor(fn: (resolve: (val: T) => void, reject: (error: unknown) => void) => void) {
    fn(this._resolve.bind(this), this._reject.bind(this))
  }

  catch<TResult = never>(rejected: (error: unknown) => TResult): PromiseSync<T | TResult> {
    if (this.error) {
      try {
        this._resolve(rejected(this.error) as any)
      } catch (e) {
        this._reject(e)
      }
    }
    return this as any
  }

  then<TResult1 = T, TResult2 = never>(
    resolved: (val: T) => TResult1,
    rejected?: (error: unknown) => TResult2
  ): PromiseSync<TResult1 | TResult2> {
    if (!this.error) {
      try {
        this._resolve(resolved(this.value as T) as any)
      } catch (e) {
        this._reject(e)
      }
    }
    if (rejected) this.catch(rejected)
    return this as any
  }

  _reject(error: unknown) {
    this.value = undefined
    this.error = error
  }

  _resolve(val: any) {
    if (val instanceof PromiseSync) {
      if (val.error) {
        this._reject(val.error)
      } else {
        this._resolve(val.value)
      }
    } else {
      this.value = val
      this.error = undefined
    }
  }

  static all<T>(vals: (PromiseSync<T> | T)[]): PromiseSync<T[]> {
    return new PromiseSync((resolve) => {
      const resolved = vals.map((val) => {
        while (val instanceof PromiseSync) {
          if (val.error) throw Error(String(val.error))
          val = val.value as T
        }
        return val
      })
      resolve(resolved as T[])
    })
  }

  static resolve<T>(val?: T): PromiseSync<T> {
    return new PromiseSync<T>((resolve) => resolve(val as T))
  }

  static reject(error: unknown): PromiseSync<never> {
    return new PromiseSync((_, reject) => reject(error))
  }
}

export default PromiseSync
