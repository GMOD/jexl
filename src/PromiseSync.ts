/*
 * Jexl
 * Copyright 2020 Tom Shawver
 */

class PromiseSync<T = any> {
  value?: T
  error?: any

  constructor(fn: (resolve: (val: any) => void, reject: (error: any) => void) => void) {
    fn(this._resolve.bind(this), this._reject.bind(this))
  }

  catch(rejected: (error: any) => any) {
    if (this.error) {
      try {
        this._resolve(rejected(this.error))
      } catch (e) {
        this._reject(e)
      }
    }
    return this
  }

  then(resolved: (val: T) => any, rejected?: (error: any) => any) {
    if (!this.error) {
      try {
        this._resolve(resolved(this.value as T))
      } catch (e) {
        this._reject(e)
      }
    }
    if (rejected) this.catch(rejected)
    return this
  }

  _reject(error: any) {
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

  static all(vals: any[]) {
    return new PromiseSync((resolve) => {
      const resolved = vals.map((val) => {
        while (val instanceof PromiseSync) {
          if (val.error) throw Error(val.error)
          val = val.value
        }
        return val
      })
      resolve(resolved)
    })
  }

  static resolve(val?: any) {
    return new PromiseSync((resolve) => resolve(val))
  }

  static reject(error: any) {
    return new PromiseSync((resolve, reject) => reject(error))
  }
}

export default PromiseSync
