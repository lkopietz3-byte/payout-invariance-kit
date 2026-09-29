// Proves CommonJS require() works against the packed tarball, on a Node
// version that supports require(esm) (>=20.19.0 or >=22.12.0). This file is
// plain CommonJS regardless of the consumer project's "type": "module",
// because a .cjs extension always forces CommonJS. Run by verify-package.mjs.
const assert = require('node:assert/strict');

const { assertPayoutInvariance, assertNoPayoutImports, deepEqual } = require('payout-invariance-kit');

assert.equal(typeof assertPayoutInvariance, 'function');
assert.equal(typeof assertNoPayoutImports, 'function');
assert.equal(typeof deepEqual, 'function');

const baseInput = { candidates: [{ id: 'a', score: 1, payoutRateBps: 0 }] };
const rank = (input) => ({ topId: [...input.candidates].sort((a, b) => b.score - a.score)[0].id });
const result = assertPayoutInvariance(rank, baseInput, [
  { name: 'bump payout', mutate: (input) => ({ candidates: input.candidates.map((c) => ({ ...c, payoutRateBps: c.payoutRateBps + 1 })) }) },
]);
assert.equal(result.passed, true);
assert.deepEqual(result.baseline, { topId: 'a' });

const offenses = assertNoPayoutImports({ 'a.ts': 'const commission = 1;' }, ['commission']);
assert.equal(offenses.length, 1);
assert.throws(() => assertNoPayoutImports({}, ['commission']), TypeError);

assert.equal(deepEqual({ a: 1 }, { a: 1 }), true);
assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);

console.log('CommonJS require() probe passed');
