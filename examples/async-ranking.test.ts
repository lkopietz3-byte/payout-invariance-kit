/**
 * Runnable example: how to check an async ranking function.
 *
 * assertPayoutInvariance is synchronous — it throws if rankFn or mutate
 * returns a Promise (see README.md, "Async ranking functions"). For a real
 * async ranker, resolve every call yourself first, then hand
 * assertPayoutInvariance a synchronous lookup over the already-resolved
 * results.
 *
 * Run with: npx vitest run
 */
import { describe, expect, it } from "vitest";

import { assertPayoutInvariance } from "../src/index";
import type { PayoutMutationScenario } from "../src/index";

interface Candidate {
  id: string;
  qualityScore: number;
  payoutRateBps: number;
}
interface RankInput {
  candidates: Candidate[];
}
interface RankResult {
  orderedIds: string[];
  topPick: string | null;
}

/** Simulates an async ranking call (e.g. a DB-backed scorer). */
async function asyncRank(input: RankInput): Promise<RankResult> {
  await Promise.resolve();
  const sorted = [...input.candidates].sort((a, b) => b.qualityScore - a.qualityScore);
  return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
}

/**
 * Runs every scenario's async rankFn call up front, then wraps the results
 * behind a synchronous function assertPayoutInvariance can call.
 */
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

const baseInput: RankInput = {
  candidates: [
    { id: "a", qualityScore: 90, payoutRateBps: 0 },
    { id: "b", qualityScore: 40, payoutRateBps: 500 },
  ],
};
const bumpPayout: PayoutMutationScenario<RankInput> = {
  name: "every candidate's payout goes up",
  mutate: (input) => ({ candidates: input.candidates.map((c) => ({ ...c, payoutRateBps: c.payoutRateBps + 1000 })) }),
};

describe("checking an async ranking function", () => {
  it("calling assertPayoutInvariance directly on an async rankFn throws", () => {
    expect(() =>
      assertPayoutInvariance(
        asyncRank as unknown as (input: RankInput) => RankResult,
        baseInput,
        [bumpPayout],
      ),
    ).toThrow(/rankFn returned a Promise/);
  });

  it("resolving first and wrapping in a sync lookup works", async () => {
    const result = await assertAsyncPayoutInvariance(asyncRank, baseInput, [bumpPayout]);
    expect(result.passed).toBe(true);
    expect(result.baseline.topPick).toBe("a");
  });

  it("still catches an async ranker that IS payout-sensitive", async () => {
    async function biasedAsyncRank(input: RankInput): Promise<RankResult> {
      await Promise.resolve();
      const sorted = [...input.candidates].sort(
        (a, b) => b.qualityScore + b.payoutRateBps * 0.1 - (a.qualityScore + a.payoutRateBps * 0.1),
      );
      return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
    }
    const worstGetsHighestPayout: PayoutMutationScenario<RankInput> = {
      name: "the lower-quality candidate gets a huge payout boost",
      mutate: (input) => ({
        candidates: input.candidates.map((c) => (c.id === "b" ? { ...c, payoutRateBps: 100_000 } : c)),
      }),
    };
    const result = await assertAsyncPayoutInvariance(biasedAsyncRank, baseInput, [worstGetsHighestPayout]);
    expect(result.passed).toBe(false);
    expect(result.failures[0]?.actual.topPick).toBe("b");
  });
});
