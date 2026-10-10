# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Some inputs that passed or failed before now give a different (correct) answer,
so the next release should be a minor version. No version bump here.

### Fixed

- `assertNoPayoutImports` matched whole words with ASCII-only `\b`. Identifiers
  in other scripts (`комиссия`, `佣金`, `προμήθεια`, `comissão`) were never
  found, ASCII `commission` was found inside `commissionés`, and an identifier
  starting or ending with a symbol (`$payout`, `@payout/core`, `rate%`) never
  matched. Matching now uses Unicode-aware boundaries (letters, digits,
  combining marks and `_` in any script) and only requires a boundary on a side
  where the identifier itself starts or ends with such a character.
- A string identifier with surrounding whitespace (`"commission "`) silently
  matched nothing. It is now trimmed (and a blank one still throws).
- The comment stripper read a JSX closing tag (`</h2>`) or a self-closing tag
  (`<Foo a={1} />`) as the start of a regex, so a comment after it
  (`{/* commission */}`, `; // commission`) was scanned as code. It also read
  the `/` in `i++ / 2` and `n-- / 2` as a regex start. Both now divide or close
  a tag, so those comments are removed. Real regexes after a single `+`, `-`,
  `<` (with a space), `(`, or a `}` on an earlier line are still read as regexes.
- A `//` comment ended only at `\n`, so code after a `\r`, U+2028 or U+2029 on
  the same "line" was hidden. It now ends at any JavaScript line terminator.
  Quoted strings and regex literals also end at a bare `\r`, and a string
  continued with a backslash and CRLF stays open.
- A multi-line `RegExp` identifier never matched, because the scan ran line by
  line, and a sticky `/y` regex never matched. `RegExp` entries now run over the
  whole file (reported at the line where the match starts, once per line), with
  `g` and `m` added (so `^` and `$` keep meaning line start and end) and `y`
  dropped. Line numbers also count a lone `\r` as a line break.
- The README async recipe reported "rankIds modified baseInput in place" for any
  class-instance input, because `structuredClone` drops the prototype. It now
  throws a `TypeError` saying the input must be plain data.

- An empty match from a Unicode (`u` or `v`) RegExp identifier before an
  astral character (an emoji) looped forever. Empty matches now step over a
  whole code point.
- The comment stripper hid real code after a regex written directly after `<`
  (`a</[/*]/.test(b)`, `n</^https?:\/\//.test(u)`), after a regex following a
  statement block when it began with a space or `=` (`if (x) {} / [/*]/`), and
  after a prefix `++` (`++/re/.lastIndex`). A `</` is now a closing tag only
  when a tag name and `>` follow, a `}` is classified as closing a statement
  block or an expression, and `++`/`--` are postfix only after an operand.
- `payout` written directly against Chinese, Japanese or Korean text
  (`t('查看payout报表')`) or `²`/`½` was not found, because those counted as word
  characters. For an identifier with an ASCII edge they no longer do.

- The comment stripper did not treat `catch {}` without a parameter, class
  bodies, `case`/`default` blocks or labeled blocks as statement blocks, so a
  regex right after one of them hid real code. A regex or `/>` after `>` was
  also read as JSX tag syntax in plain comparisons (`a > />[/*]/.test(b)`,
  `a</foo>[/*]/.test(b)`). JSX tag rules now apply only in `.jsx` and `.tsx`
  files, and in other files (except `.ts`, `.mts` and `.cts`, where they never
  apply) only after a JSX opener was seen. An arrow body that is a regex
  (`x => />/.test(s)`) is read as a regex.

### Changed (behavior)

- New option `orderSensitive` (default `false`) on `assertPayoutInvariance` and
  on `deepEqual(a, b, opts?)`. When `true`, the order of a `Map`'s entries, a
  `Set`'s members and an object's own keys is significant, so a ranker that
  returns its ranking in one of those types and reorders it by payout now fails.
  The default is unchanged: those three are still compared without regard to
  order. The option also applies to the default `hasChanged` and the in-place
  checks. `deepEqual` now throws a `TypeError` if `opts` is not a plain object
  with a boolean `orderSensitive`.
- `assertPayoutInvariance` throws a `TypeError` when `rankFn` returns `undefined`
  on the baseline input (almost always a forgotten `return`; before, a ranker
  that always returned `undefined` passed). `null` and `NaN` are still accepted.
- `assertNoPayoutImports` may now report more files (non-Latin identifiers,
  symbol-edged identifiers, multi-line patterns, code after `\r` or U+2028
  comment ends) and fewer (ASCII words touching a non-ASCII letter, comments
  after JSX tags or `++`). `RegExp` entries are scanned across the whole file
  and `$`/`^` mean line end/start through the added `m` flag.

### Documented

- The default comparison ignores order inside `Map`, `Set` and object keys. It
  is now stated at the top of "Honest limits" with the guidance to pass
  `orderSensitive: true` or return an array.
- `opts.caseInsensitive` (default `true`; applies to string identifiers in any
  script, not to `RegExp` entries) and the other `assertNoPayoutImports` rules
  above are in the README.
- A mixed identifier such as `payout报表` is reported for `"payout"` (the cost
  of finding it in UI strings). A non-ASCII identifier stays strict.
- The comment stripper is a text heuristic, not a parser. A regex literal that
  contains `/*` or `//` right after a token it reads differently can still hide
  code on the same line; pass `stripComments: false` for maximum recall. In a plain `.ts` file JSX is never recognized.
- Lexer limits that remain: a regex right after `)` or `]` is read as division,
  a lone backtick in JSX text opens a template that never closes, and JSX text
  is not tokenized (a `//` in it starts a comment). No Unicode normalization is
  applied to identifiers or source. CamelCase and snake_case fragments are
  still not matched by a string identifier.
- The `deepEqual` cost note is stated as CPU time, re-measured at 22 to 25
  microseconds per fresh object (first comparison) and about 1.5 microseconds
  per object afterwards on Node 26, Apple silicon. Wall-clock time on a busy
  machine is much higher.

## [0.2.1] - 2026-10-07

No change to the library's behavior or API.

### Changed

- The README links to the [in-browser playground](https://lkopietz3-byte.github.io/honesty-kits/#payout-invariance-kit) and the honesty kits family, and the npm homepage now points to the playground.
- Added the `honesty-kits` npm keyword so the family shows up together in search.

### Security

- Development lockfile: `source-map-js` 1.2.2 (GHSA-68fv-2mgg-jv7q). Development tooling only; the published package has no runtime dependencies.

## [0.2.0] - 2026-09-29

Some inputs that 0.1.1 accepted now throw, and some comparisons now give a
different (stricter) answer, so this is a minor release.

### Fixed

- `deepEqual` recognized built-ins by `Symbol.toStringTag` first, so a real
  `Map` with an own masked tag was compared as an empty ordinary object and
  a ranker returning different masked Maps passed (PIK-001). Built-ins are
  now recognized by intrinsic brand checks and their content is read
  through intrinsics, so an overridden `getTime`, `valueOf`, `size`,
  iterator, `byteLength` or `length` cannot hide a difference either. A
  value that inherits from a built-in prototype without passing its brand
  check (a `Proxy` around a `Map`, a masked `Promise`) is not comparable.
- `ArrayBuffer`, `SharedArrayBuffer` and `DataView` now compare their own
  enumerable properties, like every other kind.
- The internal snapshot dropped typed-array metadata that `deepEqual`
  compared, so an untouched `Uint8Array` with a `label` property was
  reported as modified in place (PIK-004). It now keeps it (and
  `ArrayBuffer` metadata).
- An `arguments` object no longer equals a plain object with the same
  entries.
- `mutations` was validated with `forEach` and run with a spread copy: a
  sparse array ran `rankFn` before failing, and an overridden
  `Symbol.iterator` ran no scenarios. It is now validated with one indexed
  pass (holes rejected), each `name` and `mutate` is read once, and the run
  uses only that snapshot.
- The comment stripper removed an inline block comment without leaving a
  separator, so `return/* x */commission` became `returncommission` and the
  reference was missed (PIK-002). A removed block comment now leaves a
  space.
- Error messages escape scenario names and thrown messages (newlines,
  control and bidi characters), and a thrown value that cannot be printed
  no longer breaks the message.
- `deepEqual` compared a value that looks like a built-in but fails its
  brand check as an ordinary object when the resemblance came from another
  realm or was hidden. From another realm (a `node:vm` context): a `Proxy`
  around a `Date`, `Number`, `Boolean`, `String` or `RegExp`,
  `Object.create()` of its `Date.prototype`, or an old-style subclass whose
  instances never got the internal slot. From any realm: a `Proxy` whose
  `getPrototypeOf` trap hides a `Date`, or a `Proxy` that answers
  `Symbol.toStringTag`. So another realm's `new Proxy(new Date(1), {})`
  equaled `new Proxy(new Date(2), {})`. Such values are now not comparable
  (equal only to themselves). A built-in is recognized from any realm by
  its native constructor's name; a user class merely named `Map` is still
  an ordinary class. An `Error`-like value from any realm, including a
  `Proxy` around one, is compared as an `Error` by `name`, `message`,
  `cause` and `errors`.
- The comment stripper tracked strings one line at a time, so a
  multi-line template literal holding an unclosed `/*` (such as
  `rm -rf dist/*`) hid every later line, and `` `${"`"}` + "/*" `` did the
  same on one line; a later `o.payout` was missed. It is now a small
  whole-file lexer that skips strings, template literals across lines
  (with nested `${ }` expressions) and regex literals in expression
  position, so `/[/*]/` after `=` no longer opens a comment either.
- The error thrown when `rankFn` returns a Promise said two Promises are
  always equal once their own properties are compared. A Promise is not
  comparable (equal only to itself); the message now says so.

### Changed

- `assertNoPayoutImports` throws a `TypeError` for an empty `files` list or
  map, an empty identifier list, a blank identifier, a hole, a non-string
  and non-RegExp identifier, a `files` value that is not an array of paths
  or a plain object, non-string content, or non-boolean options (PIK-005).
  It used to return `[]`, which looked like a clean scan. RegExp
  identifiers are copied through their internal slots.
- `assertPayoutInvariance` throws a `TypeError` when `opts` is not a plain
  object or `isEqual`/`hasChanged` is not a function, before `rankFn` runs.
- The README async recipe is narrowed to a tested ranker that resolves to
  an array of ids. The old helper ran every call before the library took
  its snapshots, so a ranker reusing one output array passed (PIK-003).
- Release workflow: runs only on a matching `v*` tag for both triggers,
  runs the dependency audit, verify and attw, and treats only a confirmed
  E404 as "not published". CI adds Node 20.19.0 and 22.12.0 compatibility
  jobs.
- README "Honest limits" now states the known false passes: state kept
  only in private `#fields` (with the fix: an `isEqual` that compares the
  getters, or plain data), and one shared `Error`, `DataView` or boxed
  primitive returned and edited on every call. The comment-stripper limits
  are restated for the new lexer.

### Added

- A differential fuzz test against `node:util`'s `isDeepStrictEqual` (test
  only; the library does not import `node:util`), a runtime-portability
  test (no `SharedArrayBuffer`, `WeakRef`, `FinalizationRegistry`,
  `BigInt`, `Float16Array`; other realms; endless prototype chains), and an
  ESM/CommonJS compatibility table in the README.

## [0.1.1] - 2026-09-27

### Added

- CommonJS `require()` support: `package.json` `exports` now has a
  `"default"` condition alongside `"import"`, so `require("payout-invariance-kit")`
  works on Node versions that support `require(esm)` (>=20.19.0, >=22.12.0).
  ESM `import` is unaffected.
- `scripts/consumer-probe.cjs`, run by `verify-package.mjs`, so CI guards the
  CommonJS entry point going forward.

### Fixed

- The shipped `.js.map` pointed at `../src/*.ts`, which isn't in the
  published tarball, breaking go-to-definition. `tsconfig.build.json` now
  sets `inlineSources`, so the map embeds the original source directly.
  `.d.ts.map` generation is turned off instead (see README's "Install").
- The main entry imported Node's `node:fs` at the top of the file, which
  bundlers targeting a browser or a Workers runtime resolve at bundle time —
  breaking that build even for callers who never used the file-path mode of
  `assertNoPayoutImports`. `node:fs` is now loaded lazily, only when that
  mode is actually called.
- The README "Quickstart" was pseudocode (a nonexistent import, an invalid
  `[...]` spread) and threw a `SyntaxError` if pasted. It's now a
  self-contained example that runs, and is pinned by
  `test/readme-quickstart.test.ts`.

## [0.1.0] - 2026-09-27

First release.

### Added

- `assertPayoutInvariance(rankFn, baseInput, mutations, opts?)`: runs
  `rankFn` on a base input and on each payout-mutated input, and returns
  `{ passed, baseline, failures, vacuous }`. A mutation that changes nothing
  is reported as vacuous and makes `passed` false. Options: `isEqual`,
  `hasChanged`.
- `assertNoPayoutImports(files, payoutIdentifiers, opts?)`: greps a set of
  source files (by path or a pre-loaded content map) for forbidden
  payout/commission/affiliate-style identifiers and returns the offending
  files. Options: `stripComments`, `caseInsensitive`.
- `deepEqual(a, b)`: the default structural comparator. Fails closed;
  handles `Map`, `Set`, `Date`, `RegExp`, `Error`, typed arrays, buffers,
  boxed primitives, array holes, symbol keys, prototypes, and circular
  references.
- Examples: a toy marketplace ranker exercising both functions, and an
  async ranking function pattern.

### Behavior worth knowing before upgrading from a pre-release copy

Earlier unreleased copies of this code returned `passed: true` in cases
where nothing was really compared. These now throw instead:

- `rankFn` or `mutate` returns a Promise (an async ranker was compared as
  two equal Promises).
- The `mutations` list is empty.
- `isEqual` or `hasChanged` returns a non-boolean.
- `rankFn` or `mutate` modifies `baseInput` in place, or a later `rankFn`
  call modifies the baseline ranking result.
- Invalid `rankFn`/`mutations` arguments (wrong type, malformed scenario
  entries).

Errors thrown by `rankFn` or `mutate` are now rethrown with the scenario
name and the original error as `cause`. `deepEqual` no longer treats array
holes, different `Error` messages, different buffer bytes, typed arrays of
different element types, class instances vs. plain objects, or Sets with
duplicate object members as equal. `assertNoPayoutImports` no longer lets a
`//` or `/*` inside a same-line string (e.g. a URL) swallow the rest of the
line before matching.
