# @jbrowse/jexl

A fork of the TomFrost/jexl minimal expression lang for jbrowse

Major changes include

- Removing async
- Remove 'transforms' (use functions instead)
- Remove array filtering expressions
- Added template strings
- Added multiple expression evaluation
- Added lambdas and collection functions (`any(xs, x => x > 1)`)
- Added host hooks for member and name resolution
- Added `analyze()`, which reports what an expression reads without running it
- Added `check()`, which checks an expression against a host's fields and
  functions, and `print()`, which renders a parsed expression back to text
- Added bcftools-style list operators, regex matching (`~`) and aggregates

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
| Null             | `null`                                               |
| Strings          | `"Hello \"user\""`, `'Hey there!'`                   |
| Template Strings | `` `Hello ${name}` ``, `` `Total: ${price * qty}` `` |
| Numerics         | `6`, `-7.2`, `.5`, `1e3`, `-5e-8`                    |
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

**Unary:** `!` (logical negation), `-` (arithmetic negation)

**Binary:**

- Arithmetic: `+`, `-`, `*`, `/`, `//` (floor division), `%`, `^` (power)
- Comparison: `==`, `!=`, `>`, `>=`, `<`, `<=`, `in`
- Regular expression match: `~`, `!~` (`name ~ '^BRCA'`; a leading `(?i)`
  ignores case)
- Logical: `&&`, `||`, `??` (`a ?? b` is `b` only when `a` is `null` or
  `undefined`, so `score ?? 0` keeps a real 0)
- Assignment: `=` (assigns a value to a bare variable name; `a.b = 1` is not
  supported)

**Ternary:** `condition ? consequent : alternate`

**Sequence:** `;` (separates multiple expressions)

From loosest to tightest:

| Operators                                         | Groups             |
| ------------------------------------------------- | ------------------ |
| `;`                                               |                    |
| `=`, lambdas                                      | right to left      |
| `? :`                                             | right to left      |
| `\|\|`, `??`                                      | left to right      |
| `&&`                                              | left to right      |
| `==`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `~`, `!~` | left to right      |
| `+`, `-`                                          | left to right      |
| `*`, `/`, `//`                                    | left to right      |
| `%`, `^`                                          | `^` from the right |
| prefix `!`, `-`                                   |                    |
| `.`, `[]`, calls                                  | left to right      |

As in JavaScript, `??` does not mix with `&&` or `||` without parentheses:
`a ?? b || c` is a syntax error, `(a ?? b) || c` is not.

### Lists

Operators read a list the way bcftools reads a multi-valued VCF tag.

A comparison holds when it holds for any value of the list, and `!=` and `!~`
hold when no value matches, so each stays the negation of `==` and `~`:

```javascript
const context = {
  AF: [0.01, 0.2],
  FILTER: ['PASS'],
  CSQ: ['T|missense_variant|MODERATE', 'T|synonymous_variant|LOW']
}

jexl.eval('AF > 0.05', context) // true: the second allele's frequency is
jexl.eval("FILTER != 'PASS'", context) // false
jexl.eval("CSQ ~ 'missense_variant'", context) // true
jexl.eval("['DEL'] in ['DEL', 'INS']") // true
```

Arithmetic pairs lists value by value, and a single value, or a list of one,
pairs with every value of the other side:

```javascript
jexl.eval('AC / AN', { AC: [2, 4], AN: [10] }) // [0.2, 0.4]
jexl.eval('DP + 1', { DP: [25] }) // [26]
```

`in` finds a substring of a string, a member of a list or Set, or a key of an
object or Map, so a host can hand an expression a gene list loaded from a file
as a Set: `name in genes`.

`sum`, `mean`, `median`, `min` and `max` aggregate a list, reading each value
through an optional lambda. They skip missing values, and count a boolean as 1
or 0, which makes `mean` of a test the fraction that pass:

```javascript
jexl.eval('min(DV / DP) > 0.3', context) // bcftools MIN(DV/DP)>0.3
jexl.eval('count(samples, s => s.GQ > 90)', context) // bcftools N_PASS(GQ>90)
jexl.eval('mean(samples, s => s.GQ > 90)', context) // bcftools F_PASS(GQ>90)
```

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
jexl.eval('exes.length', context) // 3
```

A name chained off an array reads the array itself, so `exes.length` is 3 and
`list.name` is `undefined`; index the element you mean, `list[0].name`.

### Functions

Call functions in expressions:

```javascript
jexl.addFunction('log10', Math.log10)
jexl.addFunction('round', Math.round)

jexl.eval('round(log10(1234))')
// 3

jexl.eval('-log10(pvalue) > threshold', { pvalue: 1e-9, threshold: 8 })
// true
```

Functions live in one global pool and have no receiver, so a call written
against a value passes that value as the first argument: `a.b(x)` means
`b(a, x)`. Since functions are conventionally written to take their subject
first, the two spellings read differently but do the same thing:

```javascript
jexl.addFunction('split', (str, sep) => String(str ?? '').split(sep))

jexl.eval("refName.split(' ')[0]", { refName: 'chr1 description' }) // "chr1"
jexl.eval("split(refName, ' ')[0]", { refName: 'chr1 description' }) // "chr1"
```

Note that this is a naming convention, not method dispatch: `a.b(x)` calls the
function named `b` in the pool, never a method on the value of `a`.

### Lambdas

`x => body` and `(a, b) => body` are functions a registered function can call.
A parameter shadows the context variable of the same name; any other name reads
the context. A lambda body cannot assign.

Jexl registers `any`, `all`, `count`, `map`, `filter`, `find`, `sort` and
`reduce`, each taking a list and a lambda, and the aggregates above. A lone value counts as a list of one
and a missing value as an empty list, which suits VCF INFO fields:

```javascript
jexl.eval('any(feature.INFO.AF, af => af > 0.05)', context)
jexl.eval('map(xs, (x, i) => x * i)', { xs: [1, 2, 3] }) // [0, 2, 6]
jexl.eval('xs.filter(x => x > 1)', { xs: [1, 2, 3] }) // [2, 3]
```

A host function of the same name replaces the built-in one.

### Variable Assignment

Assign values to variables using `=` (no `let`, `var`, or `const` needed). An assignment returns the assigned value, and the variable lasts for the rest of that evaluation. The context is never written to, so one context object can be reused across evaluations:

```javascript
jexl.eval('x = 5')
// 5

jexl.eval('x = 5; x * 2')
// 10

jexl.eval('x = 5; y = 10; x + y')
// 15

const context = { x: 1 }
jexl.eval('y = x * 2; x = y + 1; x', context)
// 3
// context is still { x: 1 }
```

Separate multiple expressions with semicolons. The result is the value of the
last expression.

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
  abs: Math.abs,
  sqrt: Math.sqrt
})

// Use in expressions
jexl.eval('round(3.7)') // 4
jexl.eval('lower(name)', { name: 'HELLO' }) // "hello"
jexl.eval('sqrt(abs(-16))') // 4
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
jexl.addUnaryOp('#', (right) => Math.floor(right))

jexl.eval('#3.7') // 3
```

### Resolving Names Through the Host

When the values in a context keep their fields behind an accessor, a Jexl instance can resolve names itself instead of reading plain properties. Both hooks are fixed when the instance is constructed.

```javascript
import { Jexl } from '@jbrowse/jexl'

const jexl = new Jexl({
  // `a.b` and `a[k]`, on any value that isn't null or undefined
  getMember: (subject, key) =>
    subject instanceof Feature ? subject.get(key) : subject[key],
  // a bare name, asked once per name as an expression compiles; returning
  // undefined keeps the plain `context[name]` read
  variableReader: (name) =>
    name === 'feature'
      ? undefined
      : (context) => context.feature.get(name) ?? context[name]
})

const expr = jexl.compile('feature.score > 10 && -log10(pvalue) > 2')
const context = { feature: undefined }
for (const feature of features) {
  context.feature = feature
  expr.eval(context)
}
```

A name the expression assigns reads the assignment once it has run, and goes through `variableReader` before then.

### Analyzing Expressions

`analyze` reports what an expression reads, without evaluating it or needing
its functions registered:

```javascript
const expr = jexl.compile("get(feature, 'score') > 10 ? feature.name : 'n/a'")
expr.analyze({ accessors: { get: [] }, row: 'feature' })
// {
//   variables: ['feature'],
//   fields: [{ path: ['score'] }, { path: ['name'] }],
//   bare: false,
//   ...
// }
```

`accessors` names functions that read a path off their first argument, so
`get(feature, 'score')` and `feature.score` both read the field `score`. An
expression with no `variables` is a constant; one whose `bare` is true is only
a path, which a host can read without jexl.

## License

MIT License, same as TomFrost/Jexl

## Publishing

[Trusted publishing](https://docs.npmjs.com/about-trusted-publishing) via GitHub Actions.

```bash
npm version patch  # or minor/major
```
