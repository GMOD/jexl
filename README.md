# @jbrowse/jexl

A fork of the jexl lang for jbrowse

## Quick Examples

```javascript
const context = {
  name: { first: 'Sterling', last: 'Archer' },
  assoc: [
    { first: 'Lana', last: 'Kane' },
    { first: 'Cyril', last: 'Figgis' },
    { first: 'Pam', last: 'Poovey' }
  ],
  age: 36
}

// Template strings with interpolation
jexl.evalSync('`Hello ${name.first} ${name.last}`', context)
// "Hello Sterling Archer"

jexl.evalSync('`Age in 5 years: ${age + 5}`', context)
// "Age in 5 years: 41"

// Filter arrays
jexl.evalSync('assoc[.first == "Lana"].last', context)
// "Kane"

// Math operations
jexl.evalSync('age * (3 - 1)', context)
// 72

// String concatenation
jexl.evalSync('name.first + " " + name.last', context)
// "Sterling Archer"

// Conditional logic
jexl.evalSync('age > 62 ? "retired" : "working"', context)
// "working"

// Array indexes
jexl.evalSync('assoc[1].first', context)
// "Cyril"
```

## Language Reference

### Native Types

| Type             | Examples                                             |
| ---------------- | ---------------------------------------------------- |
| Booleans         | `true`, `false`                                      |
| Strings          | `"Hello \"user\""`, `'Hey there!'`                   |
| Template Strings | `` `Hello ${name}` ``, `` `Total: ${price * qty}` `` |
| Numerics         | `6`, `-7.2`, `5`, `-3.14159`                         |
| Objects          | `{hello: "world!"}`                                  |
| Arrays           | `['hello', 'world!']`                                |

### Template Strings

Template strings use backticks and support expression interpolation with `${}`:

```javascript
const context = { name: 'World', price: 10, qty: 3 }

jexl.evalSync('`Hello ${name}!`', context)
// "Hello World!"

jexl.evalSync('`Total: $${price * qty}`', context)
// "Total: $30"

// Escape backticks and dollar signs with backslash
jexl.evalSync('`Code: \\`example\\``')
// "Code: `example`"

jexl.evalSync('`Price: \\$100`')
// "Price: $100"
```

### Operators

**Unary:** `!` (negate)

**Binary:**

- Arithmetic: `+`, `-`, `*`, `/`, `//` (floor division), `%`, `^` (power)
- Comparison: `==`, `!=`, `>`, `>=`, `<`, `<=`, `in`
- Logical: `&&`, `||`
- Assignment: `=` (assigns value to variable)

**Ternary:** `condition ? consequent : alternate`

**Sequence:** `;` (separates multiple expressions)

### Identifiers

Access context variables by name. Use dot notation or brackets for nested properties:

```javascript
const context = {
  name: { first: 'Malory', last: 'Archer' },
  exes: ['Nikolai', 'Len', 'Burt'],
  lastEx: 2
}

jexl.evalSync('name.first', context) // "Malory"
jexl.evalSync('name["last"]', context) // "Archer"
jexl.evalSync('exes[2]', context) // "Burt"
jexl.evalSync('exes[lastEx - 1]', context) // "Len"
```

### Filtering Collections

Filter arrays using expressions in brackets. Reference properties with a leading dot:

```javascript
const context = {
  employees: [
    { first: 'Sterling', last: 'Archer', age: 36 },
    { first: 'Malory', last: 'Archer', age: 75 },
    { first: 'Lana', last: 'Kane', age: 33 },
    { first: 'Cyril', last: 'Figgis', age: 45 }
  ]
}

jexl.evalSync('employees[.first == "Sterling"]', context)
// [{ first: 'Sterling', last: 'Archer', age: 36 }]

jexl.evalSync('employees[.age >= 30 && .age < 40]', context)
// [{ first: 'Sterling', ... }, { first: 'Lana', ... }]

jexl.evalSync('employees[.last == "Kane"].first', context)
// "Lana"
```

### Transforms

Apply transforms to values using the pipe operator:

```javascript
jexl.addTransform('upper', (val) => val.toUpperCase())
jexl.addTransform('split', (val, char) => val.split(char))

jexl.evalSync('"hello"|upper')
// "HELLO"

jexl.evalSync('"firstName lastName"|split(" ")[0]')
// "firstName"
```

### Functions

Call functions in expressions:

```javascript
jexl.addFunction('min', Math.min)
jexl.addFunction('max', Math.max)

jexl.evalSync('min(5, 2, 9)')
// 2

jexl.evalSync('max(temperature, threshold)')
// evaluates with context
```

### Multiple Expressions

Separate multiple expressions with semicolons. The result is the value of the last expression:

```javascript
jexl.evalSync('5; 10; 15')
// 15

jexl.evalSync('1 + 1; 2 + 2; 3 + 3')
// 6
```

### Variable Assignment

Assign values to variables using `=` (no `let`, `var`, or `const` needed). Assignments mutate the context and return the assigned value:

```javascript
jexl.evalSync('x = 5')
// 5

jexl.evalSync('x = 5; x * 2')
// 10

jexl.evalSync('x = 5; y = 10; x + y')
// 15

const context = {}
jexl.evalSync('x = 5; y = x * 2; y', context)
// 10
// context is now { x: 5, y: 10 }
```

## Usage

```javascript
import jexl from 'jexl'

// Synchronous evaluation
const result = jexl.evalSync('expression', context)

// Asynchronous evaluation (supports async transforms/functions)
const result = await jexl.eval('expression', context)

// Compile once, evaluate many times
const expr = jexl.compile('name.first + " " + name.last')
expr.evalSync({ name: { first: 'John', last: 'Doe' } })
```

## License

MIT License - see LICENSE.txt for details
