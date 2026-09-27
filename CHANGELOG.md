# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-27

First release. Not yet published to npm.

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
