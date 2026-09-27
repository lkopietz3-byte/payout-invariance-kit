# Engineering contract

## Invariants

1. `assertPayoutInvariance` returns `passed: true` only if every mutation
   scenario changed the input and every changed input produced a ranking
   result equal to the baseline.
2. A run that cannot be trusted throws instead of returning a result: empty
   or malformed `mutations`, a non-function `rankFn`, `rankFn`/`mutate`
   throwing or returning a Promise, non-boolean `isEqual`/`hasChanged`
   results, or in-place changes to `baseInput` or the baseline result.
3. The library never writes to caller values and uses no randomness or
   clock.
4. `deepEqual` fails closed: values it cannot inspect are equal only to
   themselves. Built-ins are recognized by brand checks, not
   `Symbol.toStringTag`.
5. `assertNoPayoutImports` is a text-pattern grep, not a parser: it never
   evaluates or imports the files it scans, and it does not follow the
   import graph.
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
- Performance is not benchmarked. Each `assertPayoutInvariance` run
  deep-copies `baseInput` and the baseline result and compares them after
  each call; `deepEqual`'s object `Set`/`Map` matching is quadratic in the
  number of object members.
- In-place change detection does not see inside values kept by reference
  (functions, `Error`, `Promise`, private fields).
- `assertNoPayoutImports`'s same-line string tracking is not carried across
  a line break, so a genuinely multi-line string or template literal can
  hide a `//`/`/*` sequence from the wrong side of the check.

## Release and rollback

- `npm run verify` (lint, typecheck, test, build, verify:package) runs
  automatically before publish via the `prepublishOnly` script.
- Before a release: `npm ci && npm run verify` (CI also runs build, test,
  and `verify:package` on Node 20, 22, and 24), update `CHANGELOG.md`, and
  review any `api-surface.json` diff, then `npm publish`.
- Rollback: npm allows `npm unpublish` only within 72 hours of publishing;
  after that, publish a fixed patch version instead. This is a dev-time
  library with no stored state, so there is nothing else to roll back.
