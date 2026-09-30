# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

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
