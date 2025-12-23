# @jbrowse/jexl

A fork of the TomFrost/jexl minimal expression lang for jbrowse

Major changes include

- Removing async
- Remove 'transforms' (use functions instead)
- Remove array filtering expressions
- Added template strings
- Added multiple expression evaluation

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
jexl.eval('`Hello ${name.first} ${name.last}`', context)
// "Hello Sterling Archer"

jexl.eval('`Age in 5 years: ${age + 5}`', context)
// "Age in 5 years: 41"

// Math operations
jexl.eval('age * (3 - 1)', context)
// 72

// String concatenation
jexl.eval('name.first + " " + name.last', context)
// "Sterling Archer"

// Conditional logic
jexl.eval('age > 62 ? "retired" : "working"', context)
// "working"

// Array indexes
jexl.eval('assoc[1].first', context)
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

jexl.eval('`Hello ${name}!`', context)
// "Hello World!"

jexl.eval('`Total: $${price * qty}`', context)
// "Total: $30"

// Escape backticks and dollar signs with backslash
jexl.eval('`Code: \\`example\\``')
// "Code: `example`"

jexl.eval('`Price: \\$100`')
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

jexl.eval('name.first', context) // "Malory"
jexl.eval('name["last"]', context) // "Archer"
jexl.eval('exes[2]', context) // "Burt"
jexl.eval('exes[lastEx - 1]', context) // "Len"
```

### Functions

Call functions in expressions:

```javascript
jexl.addFunction('min', Math.min)
jexl.addFunction('max', Math.max)

jexl.eval('min(5, 2, 9)')
// 2

jexl.eval('max(temperature, threshold)')
// evaluates with context
```

### Multiple Expressions

Separate multiple expressions with semicolons. The result is the value of the last expression:

```javascript
jexl.eval('5; 10; 15')
// 15

jexl.eval('1 + 1; 2 + 2; 3 + 3')
// 6
```

### Variable Assignment

Assign values to variables using `=` (no `let`, `var`, or `const` needed). Assignments mutate the context and return the assigned value:

```javascript
jexl.eval('x = 5')
// 5

jexl.eval('x = 5; x * 2')
// 10

jexl.eval('x = 5; y = 10; x + y')
// 15

const context = {}
jexl.eval('x = 5; y = x * 2; y', context)
// 10
// context is now { x: 5, y: 10 }
```

## API

### Evaluation

```javascript
import jexl from '@jbrowse/jexl'

// Evaluate an expression
const result = jexl.eval('expression', context)

// Compile once, evaluate many times
const expr = jexl.compile('name.first + " " + name.last')
const result = expr.eval({ name: { first: 'John', last: 'Doe' } })
```

### Adding Custom Functions

```javascript
// Add a single function
jexl.addFunction('round', Math.round)
jexl.addFunction('lower', (str) => str.toLowerCase())

// Add multiple functions
jexl.addFunctions({
  min: Math.min,
  max: Math.max,
  abs: Math.abs
})

// Use in expressions
jexl.eval('round(3.7)') // 4
jexl.eval('lower(name)', { name: 'HELLO' }) // "hello"
jexl.eval('max(1, 5, 3)') // 5
```

### Adding Custom Operators

```javascript
// Add a binary operator
jexl.addBinaryOp(
  '~=',
  20,
  (left, right) => left.toLowerCase() === right.toLowerCase()
)

jexl.eval('"Hello" ~= "hello"') // true

// Add a unary operator
jexl.addUnaryOp('~', (right) => Math.floor(right))

jexl.eval('~3.7') // 3
```

## License

MIT License, same as TomFrost/Jexl
