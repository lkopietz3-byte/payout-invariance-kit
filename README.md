# payout-invariance-kit

**[Try it in your browser →](https://lkopietz3-byte.github.io/honesty-kits/#payout-invariance-kit)** · Part of [honesty kits](https://github.com/lkopietz3-byte/honesty-kits), a family of small checks for the claims an AI product makes.

Two small, zero-dependency, framework-agnostic TypeScript checks for a
ranking, recommendation, or comparison engine that also gets paid differently
depending on which option a user picks: a job board, a marketplace, an
insurance or real-estate comparison site, a review aggregator, a
credit-card or points optimizer. It is for the developer who owns the ranking
code and wants a regression test that payout data does not move the order.
It does not audit your business, prove that a ranking is neutral, or replace
code review.

1. **`assertPayoutInvariance`** (runtime): re-runs your real ranking
   function under named, adversarial payout mutations and diffs the result
   against the unmutated baseline.
2. **`assertNoPayoutImports`** (static): greps your scoring code and its
   dependencies for any reference to payout-related identifiers, so you can
   also check the ranking engine's code never has payout data in scope at
   all.

A passing result from either check means "no dependence found in the
scenarios and files you checked", not "the ranking is neutral in general".
See [Honest limits](#honest-limits) before you rely on a green check for
anything.

Both return plain data and never call a test framework's `expect()`. You
wire them into vitest, jest, `node:test`, or a plain script.

**When not to use this**

- As a substitute for a code-review policy on the ranking path. These are
  regression tests, not an audit. Use them alongside review, not instead of
  it.
- As legal, regulatory, or fairness-certification evidence. Neither check
  makes any claim beyond "the tested scenarios/files showed no dependence."
- On a `rankFn` that isn't a pure, synchronous function of its input (hidden
  state, randomness, the clock, or an async call). `assertPayoutInvariance`
  throws if `rankFn` or `mutate` returns a Promise; see
  [Async ranking functions](#async-ranking-functions) for the pattern.
- As the only signal for a ranking change: a payout mutation your scenarios
  never tried, or a dependence that only shows up combined with another
  field, will not be caught.

## Install

```bash
npm install --save-dev payout-invariance-kit vitest
```

Or build from source: clone the repository and run `npm ci && npm run build`.
Zero runtime dependencies (`dependencies: {}` in package.json). MIT licensed.

It is an ESM package (`"type": "module"`). `import` is the supported way to
load it. `require()` also works where Node can `require(esm)`:

| How you load it | Node 20.19+ | Node 22.12+ | Node 24 and 26 | Older Node 20 or 22 |
| --- | --- | --- | --- | --- |
| `import { assertPayoutInvariance } from "payout-invariance-kit"` | works | works | works | works |
| `require("payout-invariance-kit")` | works | works | works | fails (no `require(esm)`); use `import()` |

ESM package; `require()` works on Node >=20.19 / >=22.12. Recommended runtimes
are Node 22 and 24 (LTS) and Node 26 (current). Node 20 is end-of-life. CI
still runs the tests and the installed-package checks on Node 20.19.0 and
22.12.0 (the `require(esm)` floors) to catch regressions, but that is
compatibility testing, not a recommendation. `engines` in `package.json` is
`>=20`. TypeScript resolves the package under `node10`, `node16`/`nodenext`
and `bundler` resolution (checked by `attw` in CI).

`assertNoPayoutImports`'s file-path mode loads Node's built-in `fs` lazily
(via `process.getBuiltinModule`, Node >=20.16.0/>=22.3.0) and is never
imported at the top level, so the module itself loads fine in a browser or
Workers bundle; give it a pre-loaded content map instead of file paths if you
need that mode to run outside Node.

## Quickstart

Paste this as-is. It is a self-contained, runnable example (also run as a
test in `test/readme-quickstart.test.ts`, so it can't drift from the code):

```ts
import { assertPayoutInvariance } from "payout-invariance-kit";

const baseInput = {
  candidates: [
    { id: "a", score: 90, payoutRateBps: 50 },
    { id: "b", score: 60, payoutRateBps: 0 },
    { id: "c", score: 30, payoutRateBps: 500 },
  ],
};

// Your real ranking engine goes here. This one only looks at `score`.
function rank(input: typeof baseInput) {
  const sorted = [...input.candidates].sort((a, b) => b.score - a.score);
  return { orderedIds: sorted.map((c) => c.id) };
}

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
console.log(result.passed); // true: `rank` only looks at score, never payoutRateBps
```

## API

### `assertPayoutInvariance(rankFn, baseInput, mutations, opts?)`

Re-runs your pure, synchronous ranking function once per named
payout-mutation scenario and compares each result to the unmutated baseline
by deep equality.

Returns a plain object: `{ passed: boolean; baseline: TResult; failures:
Array<{ scenario, mutatedInput, expected, actual }>; vacuous: string[] }`.
`vacuous` lists any scenario whose `mutate()` didn't actually change the
input at all (checked by default with a structural deep-equal against the
baseline input, overridable via `opts.hasChanged`); a vacuous scenario is
flagged rather than silently counted as a pass, because a mutation that
changed nothing proves nothing. `passed` is only `true` when there are zero
failures **and** zero vacuous scenarios.

`opts.isEqual` overrides the default comparator (`deepEqual`). Use it if
your result has fields you want to ignore (timestamps, generated ids) or
need a tolerance. Both `opts.isEqual` and `opts.hasChanged` must return a
plain boolean.

`opts.orderSensitive` (default `false`) makes the order of a `Map`'s
entries, a `Set`'s members and an object's keys count. By default the
comparison ignores that order, so a ranker that returns its ranking as one
of those types can be reordered by payout without failing the check. **If
your ranker returns a Map, Set or object in rank order, pass
`orderSensitive: true` or return an array.** It applies to the default
comparator, the default `hasChanged` and the in-place-change checks (a
custom `isEqual` or `hasChanged` decides for itself). Array order always
counts.

```ts
assertPayoutInvariance(rank, baseInput, mutations, { orderSensitive: true });
```

**It throws, instead of returning a misleading result, when the run cannot
be trusted:**

- `rankFn` is not a function, `mutations` is not a non-empty, dense array of
  `{ name, mutate }` objects (a hole in a sparse array is rejected), or
  `opts` is not a plain object whose `isEqual`/`hasChanged` are functions and
  whose `orderSensitive` is a boolean, all checked before anything runs. Each scenario's `name` and `mutate` are
  read once, and the run uses exactly the scenarios that were checked.
- `rankFn` or `mutate` throws. The error names the scenario and keeps the
  original error as `cause`. Scenario names and thrown messages are escaped
  in the error text (newlines, control and bidi characters).
- `rankFn` or `mutate` returns a Promise (or any thenable); see
  [Async ranking functions](#async-ranking-functions).
- `rankFn` or `mutate` modifies `baseInput` in place, or a later `rankFn`
  call modifies the ranking result it returned for the baseline (for
  example, a rank function that clears and refills one shared output
  array). Either would let a real payout dependence hide behind an
  accidental `passed: true`.
- `opts.isEqual` or `opts.hasChanged` returns anything but a boolean.
- `rankFn` returns `undefined` on the baseline input. That is almost always
  a forgotten `return`, and a ranker that always returns `undefined` would
  pass every scenario. Return the ranking (`[]` for an empty one). `null`
  and `NaN` are accepted as ordinary values, and an `undefined` on a
  mutated input is reported as a failure.

**vitest adapter.** The library returns data, so wiring it in is one line:

```ts
import { describe, it, expect } from "vitest";
import { assertPayoutInvariance } from "payout-invariance-kit";

it("ranking is invariant to payout", () => {
  const result = assertPayoutInvariance(rank, baseInput, mutations);
  expect(result.vacuous, `vacuous scenarios: ${result.vacuous.join(", ")}`).toEqual([]);
  expect(result.failures).toEqual([]);
});
```

(The same pattern works for jest/`assert`/`node:test`; swap `expect` for
whatever your framework provides; the result object doesn't change.)

### Async ranking functions

`assertPayoutInvariance` is synchronous, and there is no general async
version. The recipe below covers one narrow shape: an async ranker that
resolves to an array of candidate ids, on plain-data input. It keeps the
library's guards where they matter:

- `assertPayoutInvariance` itself validates the scenarios, runs each
  `mutate` once, rejects an in-place edit or a Promise from `mutate`, and
  flags vacuous scenarios, all before the ranker is awaited even once.
- Each result is copied as soon as it resolves, so a ranker that reuses one
  output array and rewrites it cannot make two results look the same.
- A copy of `baseInput` taken before the first call catches a ranker that
  edits it in place.

What it does not do: it does not support other result shapes (write a
projection to an array of strings, or adapt the copy step to your type), it
does not accept inputs `structuredClone` cannot copy faithfully (class
instances, functions, Maps with object keys you compare by identity; a class
instance throws a `TypeError` that says so), it
awaits calls one at a time, and a rejected call propagates as-is without
naming the scenario. It cannot see side effects outside `baseInput` (a
cache, a database row).

```ts
import { assertPayoutInvariance, deepEqual } from "payout-invariance-kit";
import type { PayoutInvarianceResult, PayoutMutationScenario } from "payout-invariance-kit";

/**
 * Check an async ranker that resolves to an array of candidate ids.
 *
 * Limits: `baseInput` must be structured-clonable plain data (objects,
 * arrays, strings, numbers, booleans, null); the ranker must resolve to an
 * array of strings; calls are awaited one at a time; a rejected call
 * propagates as-is.
 */
async function assertAsyncRankingInvariance<TInput>(
  rankIds: (input: TInput) => Promise<readonly string[]>,
  baseInput: TInput,
  mutations: PayoutMutationScenario<TInput>[],
): Promise<PayoutInvarianceResult<TInput, string[]>> {
  // A copy taken before any call, to catch a ranker that edits baseInput.
  // structuredClone turns a class instance into a plain object, so a copy
  // that differs from the original means the input is not plain data and the
  // in-place check at the end could not be trusted.
  const pristine = structuredClone(baseInput);
  if (!deepEqual(pristine, baseInput)) {
    throw new TypeError(
      "baseInput must be plain data (objects, arrays, strings, numbers, booleans, null). Class instances and " +
        "Maps with object keys are not supported by this recipe; project the input to plain data first.",
    );
  }

  // Synchronous pass: assertPayoutInvariance validates the scenarios, runs
  // each mutate once, rejects in-place edits and Promises from mutate, and
  // flags vacuous scenarios. Each call returns a distinct number, so every
  // non-vacuous scenario comes back as a "failure" carrying its input.
  let calls = 0;
  const plan = assertPayoutInvariance(() => calls++, baseInput, mutations);

  // Async pass: await one call at a time and copy each result right away,
  // so a ranker that reuses or later edits its output array cannot change
  // what was recorded.
  const idsFor = async (input: TInput): Promise<string[]> => {
    const result: unknown = await rankIds(input);
    if (!Array.isArray(result)) throw new TypeError("rankIds must resolve to an array of strings.");
    const ids: string[] = [];
    for (let i = 0; i < result.length; i += 1) {
      const id: unknown = result[i];
      if (typeof id !== "string") throw new TypeError(`rankIds result[${i}] must be a string.`);
      ids.push(id);
    }
    return ids;
  };

  const baseline = await idsFor(baseInput);
  const failures: PayoutInvarianceResult<TInput, string[]>["failures"] = [];
  for (const { scenario, mutatedInput } of plan.failures) {
    const actual = await idsFor(mutatedInput);
    if (!deepEqual(actual, baseline)) failures.push({ scenario, mutatedInput, expected: baseline, actual });
  }
  if (!deepEqual(pristine, baseInput)) throw new Error("rankIds modified baseInput in place.");

  return { passed: failures.length === 0 && plan.vacuous.length === 0, baseline, failures, vacuous: plan.vacuous };
}
```

`examples/async-ranking.test.ts` runs this exact code (a test checks that the
README copy matches) against an honest ranker, a payout-sensitive one, one
that reuses its output array, and ones that edit `baseInput`.

### `deepEqual(a, b, opts?)`

The default comparator, exported so you can reuse it (for example inside
your own `isEqual`, after projecting away a timestamp). `opts.orderSensitive`
works as described under `assertPayoutInvariance`: by default the order of a
`Map`'s entries, a `Set`'s members and an object's own keys is ignored, and
`{ orderSensitive: true }` makes it count. `opts` must be a plain object
with a boolean flag, or `deepEqual` throws a `TypeError`. Strict structural
equality: `Object.is` for primitives (`NaN` equals `NaN`, `0` and `-0`
differ), same prototype required, own enumerable string and symbol keys
compared on objects, arrays, `Map`, `Set`, `Date`, `RegExp`, `Error`, boxed
primitives, `arguments` objects, buffers, `DataView`s and typed arrays
(including extra properties such as a `score` attached to an
`ArrayBuffer`). Built-ins are recognized by brand checks and read through
the built-in operations. Array holes differ from `undefined`, circular
references are handled, and values it cannot inspect are equal only to
themselves (see [Honest limits](#honest-limits)). It never mutates its
arguments; an error thrown by a getter or `Proxy` trap it reads propagates.

```ts
import { deepEqual } from "payout-invariance-kit";

deepEqual({ ids: ["a", "b"] }, { ids: ["a", "b"] }); // true
deepEqual(0, -0); // false
deepEqual(new Set(["a", "b"]), new Set(["b", "a"])); // true (order ignored by default)
deepEqual(new Set(["a", "b"]), new Set(["b", "a"]), { orderSensitive: true }); // false
```

### `assertNoPayoutImports(files, payoutIdentifiers, opts?)`

Greps a set of source files for any reference to forbidden
payout/commission/affiliate-style identifiers and returns the offending
files, so a caller's test can assert that list is empty.

```ts
import { assertNoPayoutImports } from "payout-invariance-kit";

// Option A: a list of file paths (read from disk with Node's fs). Short
// words plus `matchIdentifierParts` find the way real code spells them:
// card.affiliateUrl, row.commission_rate_bps, AFFILIATE_URL, getPayoutRate(),
// "./referral-bonus".
const offensesA = assertNoPayoutImports(
  ["src/lib/rank.ts", "src/lib/score.ts", "src/lib/eligibility.ts"],
  ["affiliate", "commission", "payout", "referral", "sponsored"],
  { matchIdentifierParts: true },
);

// Option B: a pre-loaded map of path -> content (no filesystem access;
// use this if you've already resolved your own import graph, or you're
// running outside Node). Whole-word matching is the default; add a RegExp
// for anything more specific.
const offensesB = assertNoPayoutImports(
  { "src/lib/rank.ts": rankSource, "src/lib/score.ts": scoreSource },
  ["commission", "payoutRate", "affiliateRate", /\bgetPayout\w*/],
);

// In a test:
expect(offensesA).toEqual([]);
```

Scan the files that decide the ranking, not the whole project. The same words
also appear in disclosure copy, data files and tests, and there is no
allowlist, so a hit is a line for you to read, not a verdict.

Each `payoutIdentifiers` entry is a plain string (matched as a whole word /
import-path segment by default, e.g. `"commission"` catches `import { commission } from
"./payout"` but not a comment mentioning "commission is complicated"; with
`matchIdentifierParts`, also as one part of a longer identifier) or a
`RegExp` for anything more specific.

- **String identifiers** are trimmed (surrounding whitespace and invisible
  characters are removed; the trimmed text is what the result reports) and
  matched with Unicode-aware word boundaries: the match must not touch a
  letter, digit, combining mark or `_` in any script. So `"комиссия"`,
  `"佣金"` and `"comissão"` are found, `"commission"` is not found inside
  `"commissionés"`, and an identifier that starts or ends with a symbol
  (`"$payout"`, `"@payout/core"`, `"rate%"`) is found where it appears. `$`
  does not count as an identifier character here, so `"payout"` is still
  found in a Svelte-style `$payout`. Characters such as `²` and `½` are not
  identifier characters, so `payout²` is found. Next to an identifier that
  starts or ends with an ASCII character, Chinese, Japanese and Korean text
  does not count as part of the word, because those scripts have no spaces
  (`t('查看payout报表')` and `payout을` are found); a non-ASCII identifier is
  strict, so `"佣金"` is not found inside `"佣金率"`. The trade-off: a
  mixed identifier such as `payout报表` is also reported. No Unicode
  normalization is applied:
  an accented word typed as a base letter plus a combining mark does not
  match its precomposed form, so list both spellings if your code uses both.
- **`opts.matchIdentifierParts`** (default `false`) also finds a string
  identifier as one part of a longer identifier. A plain word list such as
  `["affiliate", "commission"]` otherwise misses `affiliateUrl`,
  `affiliate_url` and `COMMISSION_RATE`, because each of those is one token to
  a whole-word match. With the option on, parts are split at `_`, at a
  lower-to-upper case change (`affiliateUrl`), at the end of an acronym
  (`XMLHttp`, `PAYOUTRate`), and between letters and digits (`payout2`). `-`,
  `.`, `/`, `$` and other symbols already separate words. So `"affiliate"` is
  found in `affiliateUrl`, `getAffiliate`, `affiliate_url`, `AFFILIATE_URL` and
  `XMLAffiliate`, and is still not found in `affiliates`, `affiliated`,
  `prepayout`, or a run of one case with no separator such as `affiliateurl`
  and `AFFILIATEURL`. Plurals and other word forms are different words: list
  `"affiliates"` as well, or use a `RegExp`. It applies to string identifiers
  only; `RegExp` entries are used as written. With `caseInsensitive: false`,
  write the identifier in the case the code uses (`"Affiliate"` finds
  `getAffiliate`, `"affiliate"` does not). The scan stays linear in the size
  of the file: a rejected candidate skips ahead to the next part boundary, so
  no position is checked twice, and no pattern backtracks.
- **`opts.caseInsensitive`** (default `true`) makes string identifiers match
  regardless of case, in any script. Pass `false` to match case exactly. It
  does not change `RegExp` entries, which are used as written: give one its
  own `i` flag if you want it case-insensitive.
- **`RegExp` entries** run over the whole file, not line by line, so a
  pattern can span lines (`/import\s*\{[^}]*\bcommission\b/` matches a
  multi-line import). Each match is reported at the line where it starts, once
  per line. The scan adds the `g` and `m` flags (so `^` and `$` still mean
  the start and end of a line) and drops a sticky `y` flag (which would only
  match at one position).
- **`opts.stripComments`** (default `true`) removes line comments and block
  comments before matching, so a comment that merely *mentions* a forbidden
  word doesn't count as a reference. A line comment ends at `\n`, `\r`,
  U+2028 or U+2029. The stripper is a small lexer: it skips strings,
  template literals (across lines, including nested `${ }` expressions) and
  regex literals, so a `//` or `/*` inside one (a URL like
  `"https://api.example.com/payout"`, a shell glob like `rm -rf dist/*` in a
  template) isn't mistaken for a comment. It also tells JSX apart from
  division and regex, but only in files where JSX is plausible: always in
  `.jsx` and `.tsx`, never in `.ts`, `.mts` and `.cts`, and in any other file
  (`.js`, `.svelte`, a path with no extension) only after a JSX opener such
  as `<Foo` or `<>` has been seen: a closing tag (`</div>`, `</>`), a self-closing
  `<Foo a={1} />`, `{a} / {b}` after a JSX expression or object literal, and
  a postfix `i++ / 2` are not regex starts, so a comment after them is
  removed, while a regex after `a</`, a statement block, a prefix `++` or a
  single `+` or `-` is still read as a regex and the code after it scanned. A removed block
  comment leaves a space behind, so `return/* note */commission` is still
  found, and line numbers never move.

It throws a `TypeError`, before reading any file, instead of returning a
clean-looking `[]` for a scan that could not mean anything: an empty `files`
list or map, an empty `payoutIdentifiers` list, a blank identifier (only
whitespace or invisible characters), an entry that is neither a string nor a
real `RegExp`, a hole in either list, a `files` value that is neither an
array of paths nor a plain `{ path: content }` object, non-string content, or
non-boolean options.

## Honest limits: read this before trusting a green check

**`assertPayoutInvariance` shows the ranking didn't move for the *specific*
mutations you tested, in tested scenarios only. It is not a formal proof of
neutrality across every possible payout configuration**, and passing says
nothing about payout inputs or combinations you never tried. A ranking
function could still be payout-sensitive in a way none of your scenarios
happened to trigger, for example it only reacts once payout crosses some
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
  not a one-time certificate. Put it in CI.
- **The default comparison ignores order inside a `Map`, a `Set` and an
  object's keys.** `new Set(["a", "b"])` equals `new Set(["b", "a"])`, and
  `{ a: 1, b: 2 }` equals `{ b: 2, a: 1 }`. A ranker that returns its ranking
  as one of those, in rank order, can be reordered by payout and still pass.
  If your ranker returns a Map, Set or object in rank order, pass
  `orderSensitive: true` or return an array. Arrays are always compared in
  order.
- `deepEqual` (the default comparator) is strict: `0` and `-0` differ, there
  is no floating-point tolerance, and a class instance never equals a plain
  object with the same fields. Built-ins are recognized by brand checks and
  read through the built-in operations, so a masked `Symbol.toStringTag` or
  an overridden `getTime`/`valueOf`/`size` cannot hide a difference. Values
  it cannot inspect (`Promise`, `WeakMap`, `WeakRef`, an object with a custom
  `Symbol.toStringTag`, a `Proxy` around a `Map` or a `Date` from any realm,
  anything else that looks like a built-in but fails its brand check) are
  equal only to themselves, so pass a custom `isEqual` if your result contains
  one of these and you want to compare it structurally. Known gaps: a
  `Promise` whose prototype was replaced, and a `Proxy` whose traps hide both
  its prototype and its `constructor`, are compared as ordinary objects,
  because there is no side-effect-free way to recognize them.
- **Private `#fields` are invisible to the default comparison.** JavaScript
  does not let code outside a class read its private fields, so two
  instances whose state lives only in `#fields` (exposed through getters)
  compare equal whenever their public properties match. A biased ranker that
  returns `new Ranked(topId)`, with `topId` stored in `#top`, passes. Fix it
  on your side: pass an `isEqual` that compares the getters you care about
  (`{ isEqual: (a, b) => a.top === b.top }`), or return plain data
  (`{ top: topId }`) instead of a class with private state. The same goes
  for state kept only in non-enumerable properties, which are not compared
  either.
- `deepEqual` checks each object's brand once and caches it. The first check
  of an object costs several failed brand checks (about 22 to 25
  microseconds of CPU time per object on Node 26 on an Apple-silicon laptop,
  measured on 40,000 fresh objects on each side); later comparisons of the
  same objects are fast (about 1.5 microseconds per object). Wall-clock
  time on a busy machine can be many times higher than CPU time.
- Detecting an in-place edit to `baseInput` or the baseline result has blind
  spots: values kept by reference in the internal snapshot (functions,
  `Error`, boxed primitives, `DataView`, `SharedArrayBuffer`, `Promise`,
  private `#fields`) are not deep-copied, so a mutation hidden inside one of
  those is not caught. The same gap can produce a false pass: a ranker that
  returns one shared `Error`, `DataView` or boxed primitive (with an extra
  property) on every call, editing it each time, passes: the baseline and
  every later result hold the same object, so they compare equal. Return a
  fresh object per call, or plain data.

**`assertNoPayoutImports` is a best-effort text/regex grep, not a real
parser.** It doesn't do AST analysis or follow the import graph, so it
cannot see:

- A dynamic `import()` or `require()` built from string fragments at
  runtime (`"pay" + "out"`), a computed/dynamic property access
  (`obj["pay" + "out"]`), or a value re-exported under an aliased name: the
  file that defines the alias is caught, but a consumer that only imports
  the alias is not.
- A payout value smuggled through a generically-named shared field (a
  `meta` blob that happens to hold a payout number under a key the grep
  doesn't know to look for) or captured in a closure with no local
  reference to the word you're scanning for.
- A forbidden word inside a larger identifier. By default a string identifier
  is a whole word, so `"payout"` does not match inside `computePayoutForCard`
  or `payout_rate_bps`. Turn on `matchIdentifierParts` to find it as a
  camelCase, snake_case or kebab-case part. Even then, a word fused into a
  longer word with no separator and no case change (`payoutrate`, `mypayout`)
  is not found; pass a `RegExp` without a word boundary (e.g. `/payout/i`)
  for substring-level matching, or name your real payout fields so they
  appear as their own token somewhere reachable by the grep.
- **The comment stripper is a text heuristic, not a parser.** It guesses
  whether a `/` starts a regex literal or divides from the code before it,
  and some valid code is ambiguous to a text scanner. A regex literal that
  contains `/*` or `//`, written right after a token the scanner reads
  differently, can start a comment that hides code on the same line and
  until the next `*/`. For example, in `if (ok) /[/*]/.test(s); row.payout;`
  the `/` after `)` is read as division, so the `/*` inside the regex starts
  a comment and `row.payout` is not scanned. A `RegExp` identifier does not
  help here, because comments are stripped before any matcher runs. When you
  need maximum recall, pass `{ stripComments: false }`: comments are then
  scanned too, so a comment that mentions a forbidden word counts. Known
  cases: a regex right after `)` or `]` is read as division, a lone backtick
  in JSX text opens a template literal that never closes, and JSX text is not
  tokenized, so a `//` inside it (`<p>see https://example.com/payout</p>`)
  starts a comment that hides the rest of that line.
- **Built-ins and tampering.** The comparison, the copy and the run loop of
  `assertPayoutInvariance` do not look built-ins up while they work. What they
  use (`Object.is`, `Object.keys`, `Object.getPrototypeOf`, `Reflect.get` and
  `Reflect.apply`, `Array.isArray` and `Array.from`, `Function.prototype.call`
  and `bind`, the `Map`, `Set`, `WeakMap`, `Date`, `RegExp` and typed array
  operations used to recognize and read a value, and
  `Object.prototype.propertyIsEnumerable`, `hasOwnProperty` and `toString`) is
  saved when the package loads, and what cannot be saved is avoided: no
  `for...of`, spread, array destructuring or `Array.prototype` method on the
  way to a verdict. Lists are built as own data properties or as linked
  stacks, so an iterator, an index accessor or a method put on
  `Object.prototype` or `Array.prototype` cannot empty, shorten or reorder
  them. Out of scope: a script that rewrites a built-in before this package is
  imported, that replaces a global binding (such as `Object` or `Array`
  themselves), or that rewrites a built-in not listed here; the text helpers
  that shape error messages; and `assertNoPayoutImports`, which is a text
  scanner that uses ordinary string, regular expression and array methods. The
  package is a regression test for code you run in your own process, not a
  sandbox against code in that process that is trying to fool it. The values
  you pass in, and your own `rankFn`, `mutate` and hooks, run as written
  (getters and `Proxy` traps included).
- A line is a line only up to `\n`, `\r\n` or a lone `\r` when the result
  reports line numbers; U+2028 and U+2029 end a `//` comment but do not start
  a new reported line.

Both checks are strong signals, not a mathematical guarantee. Use them
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
for any other "should not depend on X" claim. Neither package depends on the
other; each ships its own copy of the same comparator and snapshot source
(`src/deepEqual.ts` and `src/snapshot.ts` are kept byte-identical), so
`deepEqual` behaves the same in both.

## License

MIT
