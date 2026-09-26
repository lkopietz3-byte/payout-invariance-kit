// Consumer probe: runs from a temp project with the packed tarball installed,
// importing the public entry point by package name and asserting real
// outputs. Run by scripts/verify-package.mjs.
import assert from 'node:assert/strict';

import * as root from 'payout-invariance-kit';
import { assertNoPayoutImports, assertPayoutInvariance, deepEqual } from 'payout-invariance-kit';

assert.equal(root.assertPayoutInvariance, assertPayoutInvariance);
assert.equal(root.assertNoPayoutImports, assertNoPayoutImports);
assert.equal(root.deepEqual, deepEqual);

// --- assertPayoutInvariance: an honest ranker is invariant to payout -------
const candidates = [
  { id: 'a', qualityScore: 90, payoutRateBps: 50 },
  { id: 'b', qualityScore: 60, payoutRateBps: 0 },
  { id: 'c', qualityScore: 30, payoutRateBps: 500 },
];
const baseInput = { candidates };
const honestRank = (input) => {
  const sorted = [...input.candidates].sort((a, b) => b.qualityScore - a.qualityScore);
  return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
};
const bumpEveryPayout = {
  name: 'every candidate payout goes up',
  mutate: (input) => ({ candidates: input.candidates.map((c) => ({ ...c, payoutRateBps: c.payoutRateBps + 1000 })) }),
};
const zeroPayoutMutation = {
  name: 'a no-op mutation (forgot to change anything)',
  mutate: (input) => ({ candidates: input.candidates.map((c) => ({ ...c })) }),
};

const honest = assertPayoutInvariance(honestRank, baseInput, [bumpEveryPayout]);
assert.equal(honest.passed, true);
assert.deepEqual(honest.failures, []);
assert.deepEqual(honest.vacuous, []);
assert.deepEqual(honest.baseline, { orderedIds: ['a', 'b', 'c'], topPick: 'a' });

const vacuousRun = assertPayoutInvariance(honestRank, baseInput, [zeroPayoutMutation]);
assert.equal(vacuousRun.passed, false); // a scenario that changed nothing proves nothing
assert.deepEqual(vacuousRun.vacuous, ['a no-op mutation (forgot to change anything)']);

// --- assertPayoutInvariance: a payout-sensitive ranker gets caught ---------
const biasedRank = (input) => {
  const sorted = [...input.candidates].sort(
    (a, b) => b.qualityScore + b.payoutRateBps * 0.1 - (a.qualityScore + a.payoutRateBps * 0.1),
  );
  return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
};
const worstGetsHighestPayout = {
  name: 'worst candidate gets the highest payout',
  mutate: (input) => ({
    candidates: input.candidates.map((c) => (c.id === 'c' ? { ...c, payoutRateBps: 100_000 } : { ...c, payoutRateBps: 0 })),
  }),
};
const biased = assertPayoutInvariance(biasedRank, baseInput, [worstGetsHighestPayout]);
assert.equal(biased.passed, false);
assert.equal(biased.failures.length, 1);
assert.equal(biased.failures[0].actual.topPick, 'c');
assert.equal(biased.failures[0].expected.topPick, 'a');

// --- assertPayoutInvariance: runs that cannot be trusted throw -------------
assert.throws(() => assertPayoutInvariance(honestRank, baseInput, []), /mutations is empty/);
assert.throws(() => assertPayoutInvariance('not a function', baseInput, [bumpEveryPayout]), /rankFn must be a function/);
assert.throws(
  () => assertPayoutInvariance(async (input) => honestRank(input), baseInput, [bumpEveryPayout]),
  /rankFn returned a Promise/,
);
assert.throws(
  () =>
    assertPayoutInvariance(
      (input) => {
        input.candidates.sort((a, b) => a.qualityScore - b.qualityScore); // mutates baseInput in place
        return honestRank(input);
      },
      { candidates: candidates.map((c) => ({ ...c })) },
      [bumpEveryPayout],
    ),
  /modified baseInput in place/,
);
assert.throws(
  () =>
    assertPayoutInvariance(
      (input) => {
        if (input.candidates[0]?.payoutRateBps !== 50) throw new Error('boom');
        return honestRank(input);
      },
      baseInput,
      [bumpEveryPayout],
    ),
  (error) => error.message.includes('scenario "every candidate payout goes up"') && error.cause.message === 'boom',
);

// --- assertNoPayoutImports: static grep ------------------------------------
const cleanSource = 'export function rank(x) { return x.qualityScore; }';
const leakySource = 'import { commission } from "./payout";\nexport function rank(x) { return x.qualityScore + commission(x.id); }';
const offensesClean = assertNoPayoutImports({ 'rank.clean.ts': cleanSource }, ['commission', 'payout']);
assert.deepEqual(offensesClean, []);
const offensesLeaky = assertNoPayoutImports(
  { 'rank.clean.ts': cleanSource, 'rank.leaky.ts': leakySource },
  ['commission', 'payout'],
);
assert.deepEqual(offensesLeaky.map((o) => o.file), ['rank.leaky.ts']);

// A "//" inside a string literal (e.g. a URL) must not swallow the rest of the line.
const urlSource = 'const url = "https://api.example.com/payout";';
assert.equal(assertNoPayoutImports({ 'a.ts': urlSource }, ['payout']).length, 1);

// A RegExp bypasses whole-word matching, catching a compound identifier.
assert.equal(assertNoPayoutImports({ 'a.ts': 'const computePayoutForCard = 1;' }, ['payout']).length, 0);
assert.equal(assertNoPayoutImports({ 'a.ts': 'const computePayoutForCard = 1;' }, [/payout/i]).length, 1);

// --- deepEqual: comparison semantics that used to be wrong -----------------
assert.equal(deepEqual({ score: NaN }, { score: NaN }), true);
assert.equal(deepEqual(0, -0), false);
assert.equal(deepEqual(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }])), false);
assert.equal(deepEqual(new Error('a'), new Error('b')), false);
assert.equal(deepEqual(new Uint8Array([1, 2]), new Int8Array([1, 2])), false);

console.log('consumer probe passed');
