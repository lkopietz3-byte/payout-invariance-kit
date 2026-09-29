# Engineering contract

## Invariants

1. `assertPayoutInvariance` returns `passed: true` only if every mutation
   scenario changed the input and every changed input produced a ranking
   result equal to the baseline.
2. A run that cannot be trusted throws instead of returning a result: empty,
   sparse or malformed `mutations`, a non-function `rankFn`, `opts` that is
   not a plain object or has non-function hooks, `rankFn`/`mutate` throwing
   or returning a Promise, non-boolean `isEqual`/`hasChanged` results, or
   in-place changes to `baseInput` or the baseline result. `mutations` is
   validated with one indexed pass and the run uses only that snapshot.
3. The library never writes to caller values and uses no randomness or
   clock. Caller text in error messages is escaped.
4. `deepEqual` fails closed: values it cannot inspect are equal only to
   themselves. Built-ins are recognized by intrinsic brand checks and their
   content (including own enumerable metadata on buffers and views) is read
   through intrinsics, never through `Symbol.toStringTag` or the value's own
   methods. The internal snapshot copies everything `deepEqual` compares for
   the kinds it copies. `src/deepEqual.ts` and `src/snapshot.ts` are
   byte-identical to mutation-invariance-kit's copies; a differential fuzz
   test checks `deepEqual` against `node:util`'s `isDeepStrictEqual` (in the
   test only) and documents every divergence.
5. `assertNoPayoutImports` is a text-pattern grep, not a parser: it never
   evaluates or imports the files it scans, and it does not follow the
   import graph. An empty scope (no files or no identifiers) or a blank
   identifier throws a `TypeError` rather than returning a clean `[]`.
6. Zero runtime dependencies (`dependencies` stays empty).

## Setup and verification

```bash
npm ci
npm run verify   # lint, typecheck, test, build, verify:package
npm audit --include=dev
```

`verify:package` packs the tarball, installs it into a temp project
offline, checks the file list and `api-surface.json`, runs
`scripts/consumer-probe.mjs` (imports the package by name and exercises
both functions and `deepEqual`), and compiles `scripts/consumer-probe.mts`
under strict NodeNext against the installed declarations.

Tests live in `test/` (unit tests) and `examples/` (runnable,
documentation-facing examples also exercised by `npm test`). Every bug fix
has a regression test that failed against the pre-fix commit.

## Not certified

- A pass is evidence for the scenarios and files checked, not proof of
  independence from payout in general.
- Not a fairness audit, legal or regulatory compliance evidence, or a
  security control.
- Performance is measured only roughly. Each `assertPayoutInvariance` run
  deep-copies `baseInput` and the baseline result and compares them after
  each call. `deepEqual` brand-checks each object once (about 15 to 25
  microseconds per new object on Node 26, measured on 40,000 objects) and
  caches the result; its object `Set`/`Map` matching is quadratic in the
  number of object members.
- In-place change detection does not see inside values kept by reference
  (functions, `Error`, boxed primitives, `DataView`, `SharedArrayBuffer`,
  `Promise`, private fields).
- A `Promise` whose prototype was replaced is compared as an ordinary
  object; there is no side-effect-free brand check for promises.
- `assertNoPayoutImports`'s same-line string tracking is not carried across
  a line break, and a regular-expression literal containing `/*` or `//` is
  mistaken for a comment start, so either can hide code from the check.

## Are the types wrong? (attw)

CI runs [`arethetypeswrong`](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
(`npm run attw`, which is `attw --pack . --ignore-rules cjs-resolves-to-esm`)
against the packed tarball after the build step. The `cjs-resolves-to-esm` rule is ignored on
purpose: this is an ESM-only package (`"type": "module"`, no `require` entry point), so a
CommonJS consumer must use Node's `require(esm)` support (Node >=20.19 or >=22.12 — see
"Runtime support policy" below) rather than a native `require`. A dual CJS+ESM build was
rejected to avoid the dual-package hazard (two separately-identified copies of the same module,
with broken `instanceof` checks and duplicated module state across the CJS and ESM entry
points).

## Release and rollback

`npm run verify` (lint, typecheck, test, build, verify:package) runs automatically before
publish via the `prepublishOnly` script, so a broken build cannot reach the registry by
accident. To release: add a dated entry to `CHANGELOG.md`, bump `version` in
`package.json`, commit, and push a `vX.Y.Z` tag that matches the new version, then let
`.github/workflows/release.yml` publish it. The workflow runs only on a `v*` tag whose
version matches `package.json` (a manual dispatch from a branch fails), and runs the
dependency audit, `npm run verify` and `npm run attw` before publishing. Only a confirmed
E404 from the registry counts as "not published yet"; any other registry error fails the
job. (You can also run `npm publish` locally; `prepublishOnly` still guards it.)

npm's unpublish policy is deliberately narrow. Within 72 hours of publishing, a version can be
unpublished only if no other published package depends on it. After 72 hours, unpublishing also
requires fewer than 300 downloads in the last week and a single maintainer — most released
versions won't qualify either way. A given `name@version` can never be reused, published or
not, even after an unpublish. Treat unpublish as unavailable: prefer fixing forward with a new
patch version, and use `npm deprecate <name>@"<range>" "<message>"` to warn consumers off a
bad release while it stays installable for anyone already pinned to it.

This is a dev-time library with no stored state, so there is nothing else to roll back.

### Runtime support policy

- **Supported (recommended for production):** Node 22 and 24 LTS; Node 26 current.
- **Compatibility-tested:** Node 20. Node 20 is end-of-life — nodejs.org's release page
  (<https://nodejs.org/en/about/previous-releases>) lists it as `EOL`, with its final release
  dated Mar 24, 2026. The `compat` job in `verify.yml` still runs on Node 20 to catch
  regressions, but that runtime gets no security fixes upstream; don't run production traffic
  on it.
- CommonJS `require()` of this package needs Node >=20.19 or >=22.12 (`require(esm)`
  support). The `compat` job pins exactly 20.19.0 and 22.12.0 (plus the latest 20, 22 and
  24) and runs the tests and the installed-package checks, including the CommonJS probe.
- `engines` in `package.json` is unchanged by this policy.

### Publishing with provenance

`.github/workflows/release.yml` publishes using npm trusted publishing: it triggers on
`workflow_dispatch` or a pushed `v*` tag, requests a short-lived OIDC token instead of
reading a stored npm token (`permissions: id-token: write`), and runs a plain `npm publish`
with no token and no `--provenance` flag, because provenance attestation is generated
automatically under trusted publishing. Before publishing, the workflow confirms the tag
matches `package.json`'s `version` and checks whether that version is already on the
registry, so re-running it on a version that's already published is a no-op rather than an
error. Trusted publishing must be configured for this package on npmjs.com (linking it to this
GitHub repository and the `release.yml` workflow) before the first automated release will
work.
