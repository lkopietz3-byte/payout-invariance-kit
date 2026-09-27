# payout-invariance-kit

Two small, zero-dependency, framework-agnostic TypeScript checks for a
ranking, recommendation, or comparison engine — a job board, a marketplace,
an insurance or real-estate comparison site, a review aggregator, a
credit-card/points optimizer, anything that ranks options and also gets paid
differently depending on which one a user picks:

1. **`assertPayoutInvariance`** (runtime) — re-runs your real ranking
   function under named, adversarial payout mutations and diffs the result
   against the unmutated baseline.
2. **`assertNoPayoutImports`** (static) — greps your scoring code and its
   dependencies for any reference to payout-related identifiers, so you can
   also check the ranking engine's code never has payout data in scope at
   all.

A passing result from either check means "no dependence found in the
scenarios and files you checked" — not "the ranking is neutral in general".
See [Honest limits](#honest-limits) before you rely on a green check for
anything.

Both return plain data and never call a test framework's `expect()` — you
wire them into vitest, jest, `node:test`, or a plain script.

**When not to use this**

- As a substitute for a code-review policy on the ranking path. These are
  regression tests, not an audit — use them alongside review, not instead of
  it.
- As legal, regulatory, or fairness-certification evidence. Neither check
  makes any claim beyond "the tested scenarios/files showed no dependence."
- On a `rankFn` that isn't a pure, synchronous function of its input (hidden
  state, randomness, the clock, or an async call). `assertPayoutInvariance`
  throws if `rankFn` or `mutate` returns a Promise — see
  [Async ranking functions](#async-ranking-functions) for the pattern.
- As the only signal for a ranking change: a payout mutation your scenarios
  never tried, or a dependence that only shows up combined with another
  field, will not be caught.

## Install

```bash
npm install --save-dev payout-invariance-kit vitest
```

Or build from source: clone the repository and run `npm install && npm run build`.

Requires Node 20 or later. ESM only. Zero runtime dependencies —
`dependencies: {}` in package.json. `assertNoPayoutImports`'s file-path mode
uses Node's built-in `fs`; give it a pre-loaded content map instead if you
need to run outside Node.

## Quickstart

```ts
import { assertPayoutInvariance } from "payout-invariance-kit";
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

## API

### `assertPayoutInvariance(rankFn, baseInput, mutations, opts?)`

Re-runs your pure, synchronous ranking function once per named
payout-mutation scenario and compares each result to the unmutated baseline
by deep equality.

Returns a plain object — `{ passed: boolean; baseline: TResult; failures:
Array<{ scenario, mutatedInput, expected, actual }>; vacuous: string[] }`.
`vacuous` lists any scenario whose `mutate()` didn't actually change the
input at all (checked by default with a structural deep-equal against the
baseline input, overridable via `opts.hasChanged`); a vacuous scenario is
flagged rather than silently counted as a pass, because a mutation that
changed nothing proves nothing. `passed` is only `true` when there are zero
failures **and** zero vacuous scenarios.

`opts.isEqual` overrides the default comparator (`deepEqual`) — use it if
your result has fields you want to ignore (timestamps, generated ids) or
need a tolerance. Both `opts.isEqual` and `opts.hasChanged` must return a
plain boolean.

**It throws, instead of returning a misleading result, when the run cannot
be trusted:**

- `rankFn` is not a function, or `mutations` is not a non-empty array of
  `{ name, mutate }` objects — checked before anything runs.
- `rankFn` or `mutate` throws. The error names the scenario and keeps the
  original error as `cause`.
- `rankFn` or `mutate` returns a Promise (or any thenable) — see
  [Async ranking functions](#async-ranking-functions).
- `rankFn` or `mutate` modifies `baseInput` in place, or a later `rankFn`
  call modifies the ranking result it returned for the baseline (for
  example, a rank function that clears and refills one shared output
  array). Either would let a real payout dependence hide behind an
  accidental `passed: true`.
- `opts.isEqual` or `opts.hasChanged` returns anything but a boolean.

**vitest adapter** — the library returns data, so wiring it in is one line:

```ts
import { describe, it, expect } from "vitest";
import { assertPayoutInvariance } from "payout-invariance-kit";

it("ranking is invariant to payout", () => {
  const result = assertPayoutInvariance(rank, baseInput, mutations);
  expect(result.vacuous, `vacuous scenarios: ${result.vacuous.join(", ")}`).toEqual([]);
  expect(result.failures).toEqual([]);
});
```

(The same pattern works for jest/`assert`/`node:test` — swap `expect` for
whatever your framework provides; the result object doesn't change.)

### Async ranking functions

`assertPayoutInvariance` is synchronous. For a real async ranker, resolve
every call yourself first, then hand it a synchronous lookup over the
already-resolved results:

```ts
async function assertAsyncPayoutInvariance<TInput, TResult>(
  rankFn: (input: TInput) => Promise<TResult>,
  baseInput: TInput,
  mutations: PayoutMutationScenario<TInput>[],
) {
  const mutatedInputs = mutations.map((m) => m.mutate(baseInput));
  const allInputs = [baseInput, ...mutatedInputs];
  const results = await Promise.all(allInputs.map((input) => rankFn(input)));
  const resultByIndex = new Map(allInputs.map((input, i) => [input, results[i] as TResult]));

  return assertPayoutInvariance(
    (input: TInput) => resultByIndex.get(input) as TResult,
    baseInput,
    mutations.map((m, i) => ({ ...m, mutate: () => mutatedInputs[i] as TInput })),
  );
}
```

`examples/async-ranking.test.ts` runs this against an honest and a
payout-sensitive async ranker.

### `assertNoPayoutImports(files, payoutIdentifiers, opts?)`

Greps a set of source files for any reference to forbidden
payout/commission/affiliate-style identifiers and returns the offending
files, so a caller's test can assert that list is empty.

```ts
import { assertNoPayoutImports } from "payout-invariance-kit";

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
`RegExp` for anything more specific. Line comments and block comments are
stripped before matching by default (`opts.stripComments`, default `true`),
so a comment that merely *mentions* a forbidden word doesn't count as a
reference — a same-line string or template literal (e.g. a URL like
`"https://api.example.com/payout"`) is tracked too, so a `//` inside one
isn't mistaken for the start of a line comment.

## Honest limits — read this before trusting a green check

**`assertPayoutInvariance` shows the ranking didn't move for the *specific*
mutations you tested, in tested scenarios only. It is not a formal proof of
neutrality across every possible payout configuration**, and passing says
nothing about payout inputs or combinations you never tried. A ranking
function could still be payout-sensitive in a way none of your scenarios
happened to trigger — e.g. it only reacts once payout crosses some
threshold your mutations never hit, or it reacts to a combination of two
fields you mutated independently but never together. The check is only as
strong as the scenarios you write, so:

- Don't write one easy scenario ("give one card a payout") and call it done.
  Test boundary and adversarial cases: every option paying equally, only the
  worst option paying, payout inverted relative to quality, ties broken
  fairly regardless of payout, a payout of zero bumped to an extreme value,
  and payout fields set to `0`, negative, `NaN`, or `Number.MAX_SAFE_INTEGER`.
- If your ranking function takes multiple payout-shaped fields (e.g. a
  signup bonus AND a recurring commission), mutate them together, not just
  one at a time.
- Re-run this whenever the ranking logic changes. It's a regression guard,
  not a one-time certificate — put it in CI.
- `deepEqual` (the default comparator) is strict: `0` and `-0` differ, there
  is no floating-point tolerance, and a class instance never equals a plain
  object with the same fields. Values it cannot inspect (`Promise`,
  `WeakMap`, an object with a custom `Symbol.toStringTag`) are equal only to
  themselves — pass a custom `isEqual` if your result contains one of these
  and you want to compare it structurally.
- Detecting an in-place edit to `baseInput` or the baseline result has blind
  spots: values kept by reference in the internal snapshot (functions,
  `Error`, `Promise`, private `#fields`) are not deep-copied, so a mutation
  hidden inside one of those is not caught.

**`assertNoPayoutImports` is a best-effort text/regex grep, not a real
parser.** It doesn't do AST analysis or follow the import graph, so it
cannot see:

- A dynamic `import()` or `require()` built from string fragments at
  runtime (`"pay" + "out"`), a computed/dynamic property access
  (`obj["pay" + "out"]`), or a value re-exported under an aliased name — the
  file that defines the alias is caught, but a consumer that only imports
  the alias is not.
- A payout value smuggled through a generically-named shared field (a
  `meta` blob that happens to hold a payout number under a key the grep
  doesn't know to look for) or captured in a closure with no local
  reference to the word you're scanning for.
- A forbidden word embedded inside a larger camelCase or snake_case
  identifier with no delimiter around the fragment — `\bpayout\b` does not
  match inside `computePayoutForCard` or `payout_rate_bps` as a single
  token. Pass a `RegExp` without a word boundary (e.g. `/payout/i`) if you
  need substring-level matching, or name your real payout fields so they
  appear as their own token somewhere reachable by the grep.
- A string or template literal that itself spans multiple lines — same-line
  string tracking (used so a `//` inside a URL isn't mistaken for a
  comment) is not carried across a line break.

Both checks are strong signals, not a mathematical guarantee — use them
together, and combine them with an actual code-review policy for anything
that touches the ranking path.

## Relationship to mutation-invariance-kit

[`mutation-invariance-kit`](https://github.com/lkopietz3-byte/mutation-invariance-kit)
is the general form of the runtime idea here: "does this function's output
change when you change an input it's supposed to ignore", for any input, not
just payout. This kit applies that specifically to payout/commission/affiliate
inputs and adds the static check, `assertNoPayoutImports`, which the general
kit does not have. The scenario shape (`name` plus `mutate`) matches between
the two. Use this kit for the payout axis specifically; use the general kit
for any other "should not depend on X" claim. The two packages share no code.

## License

MIT
