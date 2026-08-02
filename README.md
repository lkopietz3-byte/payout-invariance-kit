# payout-invariance

Two small, zero-dependency, framework-agnostic TypeScript checks that let a
ranking, recommendation, or comparison engine — a job board, a marketplace, an
insurance or real-estate comparison site, a review aggregator, a
credit-card/points optimizer, anything that ranks options and also gets paid
differently depending which option a user picks — **prove** its output isn't
influenced by which option pays the operator more, instead of just asserting
it in a "trust us" paragraph. One check re-runs your real ranking function
under adversarial payout mutations and diffs the result (runtime); the other
statically greps your scoring code and its dependencies for any reference to
payout data at all (static). Together they give you a runtime guarantee and a
structural guarantee, and neither one depends on a test framework — both
return plain data so you can wire them into vitest, jest, node:test, or a
one-off script.

Comparison and marketplace sites almost always take money from at least some
of the things they rank, and almost every one of them says some version of
"our rankings aren't affected by that." Usually that's a policy statement, not
something verified by CI. This library turns it into a test: if a future
refactor lets payout leak into the ranking, either check fails the build. That
converts "we promise our list isn't for sale" from a claim about intentions
into a property of the code that's checked on every commit — which is a much
stronger thing to be able to tell users, partners, or a skeptical journalist.

## Install

```bash
npm install --save-dev payout-invariance vitest
```

Zero runtime dependencies — `dependencies: {}` in package.json. `assertNoPayoutImports`'s
file-path mode uses Node's built-in `fs`; give it a pre-loaded content map instead if you
need to run outside Node.

## API

### `assertPayoutInvariance(rankFn, baseInput, mutations, opts?)`

Re-runs your pure ranking function once per named payout-mutation scenario
and compares each result to the unmutated baseline by deep equality.

```ts
import { assertPayoutInvariance } from "payout-invariance";
import { rank } from "../src/rank"; // your real ranking engine

const baseInput = { candidates: [...] };

const result = assertPayoutInvariance(rank, baseInput, [
  {
    name: "every candidate gets an equal, generous payout",
    mutate: (input) => ({
      candidates: input.candidates.map((c) => ({ ...c, payoutRateBps: 500 })),
    }),
  },
  {
    name: "the worst-scoring candidate gets the single highest payout",
    mutate: (input) => {
      const worst = [...input.candidates].sort((a, b) => a.score - b.score)[0];
      return {
        candidates: input.candidates.map((c) =>
          c.id === worst?.id ? { ...c, payoutRateBps: 10_000 } : { ...c, payoutRateBps: 0 },
        ),
      };
    },
  },
]);

// result: { passed, baseline, failures, vacuous }
```

It returns a plain object — `{ passed: boolean; baseline: TResult; failures:
Array<{ scenario, mutatedInput, expected, actual }>; vacuous: string[] }` — it
never calls a test framework's `expect()` itself. `vacuous` lists any
scenario whose `mutate()` didn't actually change the input at all (checked by
default with a structural deep-equal against the baseline input, overridable
via `opts.hasChanged`); a vacuous scenario is flagged rather than silently
counted as a pass, because a mutation that changed nothing proves nothing.
`passed` is only `true` when there are zero failures **and** zero vacuous
scenarios.

**vitest adapter** — the library returns data, so wiring it in is one line:

```ts
import { describe, it, expect } from "vitest";
import { assertPayoutInvariance } from "payout-invariance";

it("ranking is invariant to payout", () => {
  const result = assertPayoutInvariance(rank, baseInput, mutations);
  expect(result.vacuous, `vacuous scenarios: ${result.vacuous.join(", ")}`).toEqual([]);
  expect(result.failures).toEqual([]);
});
```

(The same pattern works for jest/`assert`/`node:test` — just swap `expect`
for whatever your framework provides; the result object doesn't change.)

### `assertNoPayoutImports(files, payoutIdentifiers, opts?)`

Greps a set of source files for any reference to forbidden
payout/commission/affiliate-style identifiers and returns the offending
files, so a caller's test can assert that list is empty.

```ts
import { assertNoPayoutImports } from "payout-invariance";

// Option A: a list of file paths (read from disk with Node's fs).
const offensesA = assertNoPayoutImports(
  ["src/lib/rank.ts", "src/lib/score.ts", "src/lib/eligibility.ts"],
  ["commission", "payoutRate", "affiliateRate", /getPayout\w*/],
);

// Option B: a pre-loaded map of path -> content (no filesystem access —
// use this if you've already resolved your own import graph, or you're
// running outside Node).
const offensesB = assertNoPayoutImports(
  { "src/lib/rank.ts": rankSource, "src/lib/score.ts": scoreSource },
  ["commission", "payoutRate", "affiliateRate"],
);

// In a test:
expect(offensesA).toEqual([]);
```

Each `payoutIdentifiers` entry is a plain string (matched as a whole word /
import-path segment, e.g. `"commission"` catches `import { commission } from
"./payout"` but not a comment mentioning "commission is complicated") or a
`RegExp` for anything more specific. Line comments and simple block comments
are stripped before matching by default (`opts.stripComments`, default
`true`), so a comment that merely *mentions* a forbidden word doesn't count
as a reference.

## Limits — read this before trusting a green check

**`assertPayoutInvariance` proves the ranking didn't move for the *specific*
mutations you tested. It is not a formal proof of neutrality across every
possible payout configuration.** A ranking function could still be
payout-sensitive in a way none of your scenarios happened to trigger — e.g.
it only reacts once payout crosses some threshold your mutations never hit,
or it reacts to a combination of two fields you mutated independently but
never together. The check is only as strong as the scenarios you write, so:

- Don't write one easy scenario ("give one card a payout") and call it done.
  Test boundary and adversarial cases: every option paying equally, only the
  worst option paying, payout inverted relative to quality, a payout of zero
  bumped to an extreme value, payout fields set to `0`, negative, or
  `Number.MAX_SAFE_INTEGER`.
- If your ranking function takes multiple payout-shaped fields (e.g. a
  signup bonus AND a recurring commission), mutate them together, not just
  one at a time.
- Re-run this whenever the ranking logic changes. It's a regression guard,
  not a one-time certificate — put it in CI.

**`assertNoPayoutImports` is a best-effort text/regex grep, not a real parser.**
It doesn't do full AST analysis, so: dynamic `import()` calls built from
strings, identifiers re-exported under a different name, or a payout value
smuggled in through a generically-named shared field (e.g. a `meta` blob that
happens to contain a payout number under a key the grep doesn't know to look
for) can all slip past it. Word-boundary matching also won't catch a
forbidden word embedded inside a larger camelCase identifier with no
delimiter around the fragment (e.g. `\bpayout\b` will not match inside
`computePayoutForCard` as a single token) — pass a more specific `RegExp` in
`payoutIdentifiers` (e.g. `/payout/i`) if you need substring-level matching
instead of whole-word matching, or name your real payout fields so they
appear as their own token somewhere reachable by the grep (an import
specifier, a bare property access, a function call). Both checks are strong
signals, not a mathematical guarantee — use them together, and combine them
with an actual code-review policy for anything that touches the ranking path.
