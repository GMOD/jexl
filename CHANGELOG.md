# Jexl Change Log

This project adheres to [Semantic Versioning](http://semver.org/).

## [v5.0.0] (unreleased)

Jexl 5 ships alongside JBrowse 5.0. A Pratt parser replaces the state machine:
it builds the same tree for every expression 4.0.1 parsed correctly, which
differential testing against 4.0.1 over about two million generated expressions
confirmed, and parses about three times as fast. A host can now resolve members
and bare names itself, reuse one context across evaluations, and ask an
expression what it reads.

### BREAKING CHANGES

- **`&&` binds tighter than `||`**, as in JS and SQL. Both sat at precedence 10
  and grouped left to right, so `type == 'gene' || type == 'mRNA' && score > 5`
  meant `(… || …) && score > 5`. `&&` is now 11. A mix that is already
  parenthesized reads the same.
- **`^` groups from the right**: `2 ^ 3 ^ 2` is 512, not 64. `%` and `^` still
  share a precedence and group left to right with each other.
- **An assignment no longer writes into the context.** `x = 5` makes `x` a
  variable for the rest of that evaluation and leaves the context object alone,
  so one context can be reused across evaluations without the last one's
  variables leaking into the next. Code that read assigned values back off the
  context after `eval()` has to return them from the expression instead.
- **`=` only takes a bare name, and binds loosest of all.** `1 + x = 3` used to
  assign `x` and return 4; `!x = 1`, `a < b = c` and the like did the same. Each
  is now a syntax error. A host operator registered at precedence 2 or below now
  binds tighter than `=`, so `x = a OP b` assigns the whole of `a OP b`.
- **`a.b` on an array reads the array, not its first element.** The rule dated
  from filter expressions, which returned a list and were removed in 3.0; what
  it left behind was `['DEL'].length` answering 3, the length of `'DEL'`, and
  JBrowse's `nAlt()` existing because `feature.ALT.length` could not be
  written. `list.length` is now the list's length, and a name read off a list,
  `feature.ALT.type`, is `undefined` rather than the first element's field;
  write `feature.ALT[0].type`, or `map(feature.ALT, a => a.type)`.
- **`null` is a literal.** It was a name that read `context.null`, normally
  `undefined`, so `x == null` only worked because `==` is loose, and
  `ok ? 1 : null` returned `undefined`. It now differs from `undefined` in a
  returned value and in `{a: null}` once serialized, and `a.null` is a parse
  error as `a.true` already was. `undefined` stays a name, as in JS, so
  JBrowse's `{phase: undefined}` idiom is unaffected.
- **An empty slot is a syntax error.** `f(1,,2)`, `[1,,2]`, `[,]` and `f(,)`
  dropped the hole. A trailing comma is still allowed.
- **An empty or unclosed group is a syntax error.** `()`, `(` and `1; (`
  evaluated to `undefined`; `1 + ()`, `a[]` and `{a: }` threw a `TypeError`.
- **`;` separates statements only at the top level and inside parentheses.**
  `f(a; b)`, `[a; b]` and `c ? a; b : d` are syntax errors.
- **`=>` and `??` are tokens.** Each already failed to parse as two tokens.
- **The function pool starts with `any`, `all`, `count`, `map`, `filter`,
  `find`, `sort` and `reduce`.** A host function of the same name replaces one.
- **Parse errors are `JexlSyntaxError`**, a subclass of `Error` whose `name` is
  `'JexlSyntaxError'`. Every message keeps its wording. The assignment error now
  quotes the expression up to the `=`, as the others already did.
- **Types**: `JexlValue` includes `JexlFunction`, the type of a lambda's value,
  and `Literal.value` includes `null`. `AstNodeUnion` includes `Lambda`.
  `AstNode` loses `_parent`, which the old parser set on every node as a
  non-enumerable property. `BinaryOp` gains `rightAssociative`.
- **Internals**: `src/parser/states.ts` and `src/parser/handlers.ts` are gone,
  and `precedenceOf` with them. `Parser` keeps `addTokens()` and `complete()`
  and adds `parse(source)`; it loses `addToken()` and the constructor's prefix
  and stop-map arguments. The package entry point never exported any of these.

### Added

- **`new Jexl({ getMember, variableReader })`.** `getMember(subject, key)`
  resolves `a.b` and `a[k]`; `variableReader(name)`, asked once per bare name
  at compile time, may return a reader that replaces `context[name]`. A host
  whose records keep their fields behind an accessor no longer needs a Proxy
  per record, and can resolve bare names against the current record. An
  instance with neither evaluates exactly as before.
- **`analyze(ast)` and `Expression#analyze()` list what an expression reads**
  without evaluating it or needing its functions registered: the context
  variables, each path used (`feature.INFO.DP[0]` as `feature.INFO.DP.0`), the
  row's fields, every call with its arguments classified, and the names it
  assigns. `accessors` declares calls that read a path, so `get(feature,'x')`
  and `feature.get('x')` read `feature.x`; `env` supports a host that binds a
  row's fields as variables; `bare` says whether the expression is nothing but
  a path. A lambda's parameters are bound, not read.
- **`check(ast, options)` and `Expression#check()` check an expression against
  the fields a file header declares and the functions a host registers**,
  without evaluating it. A schema lists each field's path, type, cardinality
  (`one`, `perAlt`, `perAllele`, `perGenotype`, `many` or a fixed count),
  description and categories; signatures give each function's params and
  return. The diagnostics name unknown fields, variables and functions with
  suggestions, wrong arity, an index into a scalar or past a per-allele list's
  biallelic length, text compared numerically, comparisons that can never be
  true, values outside a field's categories, and dotted or hyphenated keys that
  need brackets. The inferred result type carries a numeric domain or the
  finite set of values, and the field it came from, for a host's scale defaults
  and titles. `print(ast)` renders a tree back to text for the suggestions.
- **Lambdas**: `x => body` and `(a, b) => body`. A lambda is a plain JS
  function, so any registered function can call it; JBrowse's
  `interpolate(score, s => …)` becomes usable from config. A parameter shadows
  the variable of its name, any other name resolves as it would outside, and a
  lambda body cannot assign.
- **Collection functions** taking a list and a lambda. A lone value reads as a
  list of one and a missing value as empty, so
  `any(feature.INFO.AF, af => af > 0.05)` works whether `AF` holds one value or
  several.
- **`??` falls back only on `null` and `undefined`.** A real score of 0 loses
  to the fallback in `get(feature, 'score') || 1` and survives in
  `get(feature, 'score') ?? 1`. It shares `||`'s precedence and, as in JS,
  refuses to mix with `&&` or `||` without parentheses.
- **Numbers can use scientific notation or start with a dot.**
  `feature.pvalue < 5e-8` threw, because `5e` lexed as `5` followed by the name
  `e`; `1e3`, `1.5e-3`, `.5e3` and `-5e-8` now read as numbers. `.5` threw
  `Relative paths are not supported`, because the lexer tried the grammar's `.`
  before the number pattern.
- **`Jexl#compile` and `Jexl#eval` cache what they compile.** The same string
  returns the same Expression, so a host no longer wraps `compile` in a memo of
  its own. Adding or removing an operator empties the cache.
- **`JexlSyntaxError.offset`**, the character offset in the source where
  parsing failed, including inside a template interpolation.

### Fixed

- **`(x = a) ? b : c` tests the assignment.** The ternary reached into the group
  and parsed it as `x = (a ? b : c)`.
- **`(-x).y` and `(!x).y` read the property.** Both were refused as relative
  paths.
- **A sequence continues past a ternary into a group or literal.**
  `a ? 1 : 2; [3]` failed with "Unexpected end of expression".
- **Calling something other than a name says so.** `(a)(1)` and `f(1)(2)` now
  fail with "Functions must be called by name".
- **`in` ends at the end of a name in any script.** The lexer bounded word
  operators with `\b`, which only knows ASCII, so `in$`, `inà` and `inя` split
  into the operator and a stray name instead of lexing as one identifier. A
  host operator starting with `$` lost its bounds entirely and matched inside
  longer names. `a in$b`, which read as `a in $b`, now needs the space, as in
  JS.

### Performance

- **Parsing is about three times as fast**, and compiling from a string about
  one and a half times.
- **A literal lookup table is built once.** `{CDS: 'red', exon: 'blue'}[type]`
  rebuilt its object on every evaluation. A table of primitives can only yield
  a primitive, so one frozen copy now serves every evaluation: 290ns to 96ns
  per eval.
- **A host that resolves members through `getMember` needs no Proxy per
  record.** Against JBrowse's feature Proxy, the same expressions evaluate
  1.7–3.4x faster.

## [v4.0.1]

### Fixed

- **`obj[key]` indexes by a non-string key's string form again**, as it did
  before v3.1.0. Lowering the evaluator to closures narrowed the index to a
  string or a number and answered `undefined` for everything else, where the
  tree-walking version had been a bare `subject?.[index]`. That went out in a
  minor and the shape it rejects is a common one: every `@gmod/vcf` INFO value
  is a list (`Number=1` included, so `CLNSIG=Pathogenic` parses to
  `['Pathogenic']`), and the natural way to colour by one is a lookup table
  indexed by it. Such an expression always carries a `|| fallback` for the
  values it has no entry for, so the miss was silent and answered for every
  record — a whole JBrowse track went one flat colour, found by eye on a figure.

  A multi-valued list still misses: `['a','b']` is the key `'a,b'`, not `'a'`.
  A plain object, an array holding one, `null` and `undefined` answer
  `undefined` rather than looking up `'[object Object]'`/`'null'`/`'undefined'`
  — the same result the old lookup reached, one step sooner.

## [v4.0.0]

### BREAKING CHANGES

Each of these corrects something that was already wrong, but an expression or a
type that relied on the old behavior will not survive the upgrade.

- **`x = a ? b : c` assigns the conditional.** It used to store `a` in `x` and
  then branch on it. Any expression that assigns and branches in one statement
  changes meaning — grep config for `=` followed by `?`.
- **`-x ^ 2` is 4, not -4.** Prefix `-` now binds tighter than every binary
  operator. `^` is the only one whose result this changes.
- **Relative paths are refused when an expression is parsed.** `a[.b > 1]`
  already threw, but at `eval()` rather than `compile()`. `.foo` used to
  evaluate as a silent alias for `foo` and now throws.
- **Three fields are gone from the exported AST types**: `FunctionCall.pool`,
  `Identifier.relative` and `FilterExpression.relative`. Each was written by
  the parser and read by nothing. Code that inspects `Expression._ast` in
  TypeScript may need updating; code that only evaluates expressions will not.
- **The internal `Evaluator` class is gone.** It was never exported from the
  package entry point, so this only affects a deep import of
  `src/evaluator/Evaluator.ts`.

### Fixed

- **A prefix `-` binds tighter than every binary operator.** `-2 ^ 2` was 4,
  because the Lexer folds that sign into the literal, but `-x ^ 2` was -4: the
  unary form went through the parser, which read its precedence off `-`'s
  binary entry — lower than `^`'s — and grouped it as `-(x ^ 2)`. The same
  expression therefore meant two different things depending on whether its
  operand was written out. A prefix operator now outranks any binary one, as
  `!` always did, so both spellings agree. Only `^` changes an expression's
  value; `-x * 3` and `-x % 3` were already equal either way.

- **`x = a ? b : c` assigns the conditional instead of testing the
  assignment.** `=` has the lowest precedence in the grammar, but the ternary
  encapsulated the whole tree as its test, so this parsed as `(x = a) ? b : c`
  and stored `a` in `x`. The conditional now becomes the assignment's value,
  matching every language that has both. **This is a behavior change** for any
  expression that assigned and branched in one statement.

### Performance

- **Evaluating a compiled expression no longer allocates.** A compiled closure
  took an `Evaluator` carrying the grammar and the context, so every `eval()`
  built one. The grammar is already captured when the closure is built, so the
  closure now takes the context directly and the `Evaluator` class is gone.
  `pnpm bench` covers this path.

### Internal

- **Relative paths are rejected when an expression is parsed.** This fork
  removed array filtering expressions, and they are the only construct that
  gives a relative path a root to resolve against — but the parser still built
  the nodes for one and left a throw in the compiled closure, so `a[.b > 1]`
  compiled cleanly and failed at `eval()`. It is now refused at `compile()`
  with `Relative paths are not supported`. A leading dot, `.foo`, was worse: it
  read from a relative context that always defaulted to the plain one, making
  it a silent and obscure spelling of `foo`. It is refused the same way.

  With that gone, so are `Identifier.relative`, `FilterExpression.relative`,
  `Parser#isRelative`, and the relative-context parameter that nothing passed.
  Ordinary subscripts and chains — `a[0]`, `a["b"]`, `a[b]`, `a.b.c` — are not
  relative and are unaffected.

## [v3.3.0]

### Fixed

- **`addFunction`, `addFunctions`, `addBinaryOp` and `addUnaryOp` accept the
  callbacks people actually write.** They required `(...args: JexlValue[]) =>
JexlValue`, but parameters are contravariant, so any callback annotated with
  a narrower type — `(feature: Feature, key: string) => …`, `(s: string) => …`,
  `Math.max` — was rejected, as was any returning something jexl has no literal
  for. Jexl cannot check these anyway: the arguments are whatever the
  expression evaluated to, drawn from a context supplied at evaluation time. It
  now accepts any function and leaves the argument types to the caller, which
  clears all 55 type errors this caused in jbrowse-components. Registrations
  written in TypeScript are covered by `test/lib/registration-types.test.ts`,
  which `pnpm typecheck` now checks along with the rest of `test/`.

## [v3.2.0]

### Added

- **A call written against a value passes it as the first argument.** `a.b(x)`
  compiled to `b(x)`: the receiver was parsed and then dropped. jbrowse's own
  documented recipe `jexl:refName.split(' ')[0]` therefore evaluated
  `' '.split(undefined)` and returned a single space instead of the first word,
  and `feature.get('start')` threw `feature.get is not a function`. Functions
  have no receiver — they live in one global pool — so `a.b(x)` now means
  `b(a, x)`, which is how every function in jbrowse's pool is already written
  (`get(feature, key)`, `split(str, sep)`). Nothing that worked before changes:
  any expression this affects was already returning a wrong value or throwing.
  `a[expr]()`, whose subject is a filter rather than a name, now reports that
  functions must be called by name rather than looking up `undefined`.

### Fixed

- **`in` against a string no longer matches every absent value.** A left
  operand that wasn't a string, number or boolean was coerced to `''`, and
  every string contains `''`, so `missing in "abc"` — a missing feature
  attribute, `null`, `{}`, `[]` — was `true`. Only primitives have a substring
  form; anything else is now `false`. Array membership is unchanged.

- **A group left unclosed is rejected instead of evaluating as if closed.**
  `(1` returned `1`. A group opened before anything reached the tree leaves the
  parser's cursor null, and `complete()` tested only the cursor, so the missing
  `)` went unnoticed. `[1, 2`, `{a: 1` and `f(1` already errored and are
  unaffected.

- **`__proto__` as a key keeps its value.** Storing to that key invokes the
  prototype setter rather than creating a property, so `{"__proto__": v}`
  evaluated to `{}` — the entry was lost in the parser's key map before the
  Evaluator ever saw it — and `__proto__ = v` re-pointed the prototype of the
  caller's context object. Such keys are now defined, matching what
  `JSON.parse('{"__proto__":1}')` produces: an ordinary own property.

## [v3.1.0]

### Added

- **Unary minus on any operand.** Previously only numeric literals could be
  negated: `-1` worked, but `-x`, `-(a + b)`, `-foo.bar` and `-log10(score)`
  all threw `Invalid expression token`, because the Lexer folded the sign into
  whatever element followed it. A prefix `-` in front of a non-numeric element
  is now a unary operator. Numeric literals are still folded, so `-1` remains a
  single Literal token.

### Fixed

- **Assignment to a member expression is rejected instead of silently writing
  elsewhere.** `a.b = 5` parsed, but the Evaluator assigns into the context by
  name, so it created a top-level `b` and left `a.b` unchanged. It now throws
  the same error `a[0] = 5` already gave. **This is a behavior change**: an
  expression that previously appeared to succeed will now throw.

- **Braces inside string literals no longer end a template interpolation.**
  `` `${ "}" }` `` terminated at the quoted brace and evaluated to `" }`. The
  interpolation scanner now skips over quoted spans.

### Performance

- **Expressions are lowered to closures at compile time** rather than walked
  node-by-node on every evaluation, with the operator implementation for each
  node resolved once. Expressions that are compiled once and evaluated many
  times — per-item callbacks, filters — evaluate roughly 3-7x faster.
  Functions are still resolved per call, so registering one after compiling an
  expression continues to work; operators are bound at compile time, so a
  grammar change still requires the recompile that `Expression#compile`
  already documents.

- **A Jexl instance shares one Lexer across the expressions it creates.** The
  regex that splits an expression into elements is derived from every grammar
  element and was rebuilt on each compile, where it accounted for roughly
  two-thirds of the cost of `jexl.eval()`. It is now built once and
  invalidated when the grammar changes.

## [v3.0.0]

### BREAKING CHANGES

- **Removed async evaluation support**: Jexl now only supports synchronous evaluation
- **Renamed methods**: `evalSync()` has been renamed to `eval()`. The async `eval()` method has been removed.
- **Removed PromiseSync class**: Internal implementation detail removed
- **Removed transforms**: The transform/pipe operator (`|`) has been completely removed. Use functions instead.
- **Removed array filtering**: Relative filter expressions (e.g., `array[.property == value]`) have been removed. Bracket notation for array/object access (e.g., `array[0]`, `object["key"]`) still works.
- **Removed transform methods**: `addTransform()`, `addTransforms()`, and `getTransform()` have been removed.

### Changed

- Simplified codebase by removing Promise/PromiseSync abstraction layer
- All evaluation is now synchronous, improving performance and simplifying error handling
- Errors are now thrown directly rather than being rejected Promises
- Removed pipe operator (`|`) from grammar
- Removed filter bracket syntax for relative filtering

### Migration Guide

- Replace `await jexl.eval(expr)` with `jexl.eval(expr)` (remove await)
- Replace `jexl.evalSync(expr)` with `jexl.eval(expr)` (remove Sync suffix)
- Replace transforms with functions: change `value|transform(arg)` to `transform(value, arg)`
- Remove uses of relative filtering syntax `array[.prop == value]` (note: direct indexing like `array[0]` still works)
- Replace `.catch()` error handling with `try/catch` blocks

## [v2.3.0]

### Added

- Top-level expression functions, along with `jexl.addFunction` and
  `jexl.addFunctions`. (#25)
- Binary operators can now be set to evaluate their operands manually, allowing
  them to decide if and when to resolve the value of the left or right sides.
  See the new `manualEval` option in `jexl.addBinaryOp`.
- Support for Latin 1 Suppliment characters in identifiers (#68) (@heharkon)
- Support for Russian chatacters in identifiers (#90) (@a-gorbunov)
- ES5 build for browser support (#87) (@czosel)

### Fixed

- The binary operators `&&` and `||` now evaluate the right operand
  conditionally, depending on the value of the left.

## [v2.2.2]

### Changes

- Jexl now officially supports Node v12. It's been working, but now CI tests it!

### Fixed

- Accessing children of null should resolve to undefined rather than throwing
  (#64)

## [v2.2.1]

### Fixed

- Relative collection filters didn't function appropriately when evalSync was
  used, as it would sometimes revert to using an actual Promise object.
  (#61)

## [v2.2.0]

### Added

- Introducing the `Expression` object, which allows expressions to be compiled
  only once and evaluated many times
- Get an Expression by calling `jexl.createExpression('2 + 2')`
- Get a pre-compiled expression by calling `jexl.compile('2 + 2')`
- Evaluate Expressions asyncronoushly or synchronously by calling
  `myExpression.eval(context)` or `myExpression.evalSync(context)`
- Create expressions using a convenient tagged template: `` jexl.expr`2 + 2` ``

### Fixed

- Transform errors did not always get thrown when using `evalSync` (#55, #56)
  (@bitghostm)
- Arbitrary whitespace is now re-supported (#54) (@czosel)
- Strings were not tokenized correctly when ending with an escaped quote (#51)
  (@rehandalal)
- Identifier names can now start with `$` (#36) (@glromeo)

## [v2.1.1]

### Fixed

- Applying a filter to an undefined identifier now returns an empty array
  instead of an array with one undefined element.

## [v2.1.0]

### Added

- Jexl now has synchronous evaluation! Just call `evalSync`.

## [v2.0.2]

### Fixed

- Issue #47: Revert unintentional change to strict === and !== comparisons

## [v2.0.1]

### Fixed

- Issue where Jexl might mistake an identifier as being relative to a parent
  when it should refer to the top level of the context in one specific case

## [v2.0.0]

### Changed

- The pre-minified Jexl has been removed; in modern times, frontend
  webapps have their own build stack, and Jexl should't make assumptions
  about the module format a frontend app wants to use.
- Support for Node 4 and earlier has been dropped.
- The codebase has been modernized to the subset of ES6 supported in
  Node 6 LTS and beyond. Tests require Node 8 or later.
- The codebase has been shifted to Standard JS style.
- jexl.eval no longer accepts a callback function. Jexl is now promises-only.
- Tests have been converted to Jest to eliminate sneaky error swallowing

## [v1.1.4]

### Fixed

- Falsey identifiers are no longer treated as undefined

## [v1.1.3]

### Fixed

- Binary operators after nested identifiers were not balanced properly,
  resulting in a broken expression/AST
- Gulp (or one of its plugins) had a breaking change in a minor release,
  preventing the frontend build from running. This build method will be
  removed from the next major version of Jexl. For now, Jexl is now version-
  locked to the original gulp+plugins that worked.

## [v1.1.2]

### Changed

- Code coverage thresholds are now enforced through `gulp coverage-test`

### Fixed

- Operators found in identifier names (such as 'in' in 'incident') were being
  tokenized separately from the rest of the identifier

## [v1.1.1]

### Fixed

- Minus did not denote a negative number at the start of a ternary's consequent
  section

## [v1.1.0]

### Added

- The ability to define new binary and unary operators, or override existing
  ones.
- The ability to delete existing binary and unary operators.

## [v1.0.2]

### Fixed

- Bad Gulpfile resulted in frontend dist falling out of sync. Fixed and
  re-synced.

## [v1.0.1]

### Changed

- Refactored Parser and Evaluator. Both operations are now marginally faster.
- Removed balance tracking in favor of passing maps of token types at which
  the sub-parser should stop.

### Fixed

- Object literals could not be defined in the consequent section of a ternary
  expression.

## [v1.0.0]

### Added

- Object literals. Objects can now be defined inline with
  `{standard: 'syntax'}`.
- Array literals. Arrays can also be defined with `["standard", 'syntax']`.
- The 'in' operator, for checking to see if a string appears inside a larger
  string, or if an element exists in an array.
- Ternary expressions with `this ? "standard" : "syntax"`
- Ternary expressions with `alternate ?: "syntax"`

### Changed

- Simplified Grammar, reduced RAM footprint
- Dot notation can now be used to access properties of literals, such as
  `"someString".length` or `{foo: 'bar'}.foo`.
- Transform syntax has changed. Arguments are now passed in parentheses, and
  multiple arguments can be defined. Arguments are no longer limited to object
  literals.

## [v0.2.0]

### Added

- "Divide and floor" operator: //
- Documentation outlining running expressions against XML.

## v0.1.0

### Added

- Initial release

[development]: https://github.com/TomFrost/Jexl/compare/v2.3.0...HEAD
[v2.3.0]: https://github.com/TomFrost/Jexl/compare/v2.2.2...v2.3.0
[v2.2.2]: https://github.com/TomFrost/Jexl/compare/v2.2.1...v2.2.2
[v2.2.1]: https://github.com/TomFrost/Jexl/compare/v2.2.0...v2.2.1
[v2.2.0]: https://github.com/TomFrost/Jexl/compare/v2.1.1...v2.2.0
[v2.1.1]: https://github.com/TomFrost/Jexl/compare/v2.1.0...v2.1.1
[v2.1.0]: https://github.com/TomFrost/Jexl/compare/v2.0.2...v2.1.0
[v2.0.2]: https://github.com/TomFrost/Jexl/compare/v2.0.1...v2.0.2
[v2.0.1]: https://github.com/TomFrost/Jexl/compare/v2.0.0...v2.0.1
[v2.0.0]: https://github.com/TomFrost/Jexl/compare/1.1.4...v2.0.0
[v1.1.4]: https://github.com/TomFrost/Jexl/compare/1.1.3...1.1.4
[v1.1.3]: https://github.com/TomFrost/Jexl/compare/1.1.2...1.1.3
[v1.1.2]: https://github.com/TomFrost/Jexl/compare/1.1.1...1.1.2
[v1.1.1]: https://github.com/TomFrost/Jexl/compare/1.1.0...1.1.1
[v1.1.0]: https://github.com/TomFrost/Jexl/compare/1.0.2...1.1.0
[v1.0.2]: https://github.com/TomFrost/Jexl/compare/1.0.1...1.0.2
[v1.0.1]: https://github.com/TomFrost/Jexl/compare/1.0.0...1.0.1
[v1.0.0]: https://github.com/TomFrost/Jexl/compare/0.2.0...1.0.0
[v0.2.0]: https://github.com/TomFrost/Jexl/compare/0.1.0...0.2.0
