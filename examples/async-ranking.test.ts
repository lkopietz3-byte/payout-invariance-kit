/**
 * Runnable example: a narrow recipe for checking an async ranking function.
 *
 * assertPayoutInvariance is synchronous and throws if rankFn or mutate
 * returns a Promise. The recipe below (copied verbatim into README.md, "Async
 * ranking functions"; a test keeps the two in sync) covers one shape only:
 * an async ranker that resolves to an array of candidate ids, on plain-data
 * input. It is not a general async engine.
 *
 * Run with: npx vitest run
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { assertPayoutInvariance, deepEqual } from "../src/index";
import type { PayoutInvarianceResult, PayoutMutationScenario } from "../src/index";

// README:async-recipe:start
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
  const pristine = structuredClone(baseInput);

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
// README:async-recipe:end

interface Candidate {
  id: string;
  qualityScore: number;
  payoutRateBps: number;
}
interface RankInput {
  candidates: Candidate[];
}

const baseInput = (): RankInput => ({
  candidates: [
    { id: "a", qualityScore: 90, payoutRateBps: 0 },
    { id: "b", qualityScore: 40, payoutRateBps: 500 },
  ],
});

const bumpPayout: PayoutMutationScenario<RankInput> = {
  name: "every candidate's payout goes up",
  mutate: (input) => ({ candidates: input.candidates.map((c) => ({ ...c, payoutRateBps: c.payoutRateBps + 1000 })) }),
};
const worstGetsHighestPayout: PayoutMutationScenario<RankInput> = {
  name: "the lower-quality candidate gets a huge payout boost",
  mutate: (input) => ({
    candidates: input.candidates.map((c) => (c.id === "b" ? { ...c, payoutRateBps: 100_000 } : c)),
  }),
};

/** Simulates an async ranking call (e.g. a DB-backed scorer) that returns a fresh array. */
async function asyncRank(input: RankInput): Promise<string[]> {
  await Promise.resolve();
  return [...input.candidates].sort((a, b) => b.qualityScore - a.qualityScore).map((c) => c.id);
}

async function biasedAsyncRank(input: RankInput): Promise<string[]> {
  await Promise.resolve();
  const value = (c: Candidate): number => c.qualityScore + c.payoutRateBps * 0.1;
  return [...input.candidates].sort((a, b) => value(b) - value(a)).map((c) => c.id);
}

describe("checking an async ranking function", () => {
  it("calling assertPayoutInvariance directly on an async ranker throws", () => {
    expect(() =>
      assertPayoutInvariance(asyncRank as unknown as (input: RankInput) => string[], baseInput(), [bumpPayout]),
    ).toThrow(/rankFn returned a Promise/);
  });

  it("passes an honest async ranker", async () => {
    const result = await assertAsyncRankingInvariance(asyncRank, baseInput(), [bumpPayout, worstGetsHighestPayout]);
    expect(result).toEqual({ passed: true, baseline: ["a", "b"], failures: [], vacuous: [] });
  });

  it("catches a payout-sensitive async ranker", async () => {
    const result = await assertAsyncRankingInvariance(biasedAsyncRank, baseInput(), [worstGetsHighestPayout]);
    expect(result.passed).toBe(false);
    expect(result.failures[0]?.actual).toEqual(["b", "a"]);
  });

  it("is not fooled by a ranker that reuses and rewrites one output array (PIK-003, R04)", async () => {
    const shared: string[] = [];
    const reusing = async (input: RankInput): Promise<string[]> => {
      const ids = await biasedAsyncRank(input);
      shared.splice(0, shared.length, ...ids);
      return shared;
    };
    const result = await assertAsyncRankingInvariance(reusing, baseInput(), [worstGetsHighestPayout]);
    expect(result.passed).toBe(false);
    expect(result.baseline).toEqual(["a", "b"]);
    expect(result.failures[0]?.actual).toEqual(["b", "a"]);
  });

  it("rejects a mutate that edits baseInput before any async call runs", async () => {
    let rankCalls = 0;
    const editing: PayoutMutationScenario<RankInput> = {
      name: "edits in place",
      mutate: (input) => {
        input.candidates[1]!.payoutRateBps = 100_000;
        return { candidates: [...input.candidates] };
      },
    };
    const counted = async (input: RankInput): Promise<string[]> => {
      rankCalls += 1;
      return asyncRank(input);
    };
    await expect(assertAsyncRankingInvariance(counted, baseInput(), [editing])).rejects.toThrow(
      /mutate\(\) modified baseInput in place/,
    );
    expect(rankCalls).toBe(0);
  });

  it("rejects a ranker that edits baseInput, a non-array result, and propagates a rejection", async () => {
    const editing = async (input: RankInput): Promise<string[]> => {
      input.candidates.reverse();
      return asyncRank(input);
    };
    await expect(assertAsyncRankingInvariance(editing, baseInput(), [bumpPayout])).rejects.toThrow(
      /rankIds modified baseInput in place/,
    );
    const notArray = async (): Promise<string[]> => ({ 0: "a" }) as unknown as string[];
    await expect(assertAsyncRankingInvariance(notArray, baseInput(), [bumpPayout])).rejects.toThrow(TypeError);
    const numbers = async (): Promise<string[]> => [1] as unknown as string[];
    await expect(assertAsyncRankingInvariance(numbers, baseInput(), [bumpPayout])).rejects.toThrow(/result\[0\]/);
    const rejecting = async (): Promise<string[]> => {
      throw new Error("db down");
    };
    await expect(assertAsyncRankingInvariance(rejecting, baseInput(), [bumpPayout])).rejects.toThrow("db down");
  });

  it("reports a vacuous scenario without awaiting the ranker for it", async () => {
    let rankCalls = 0;
    const counted = async (input: RankInput): Promise<string[]> => {
      rankCalls += 1;
      return asyncRank(input);
    };
    const noOp: PayoutMutationScenario<RankInput> = { name: "changes nothing", mutate: (input) => ({ ...input }) };
    const result = await assertAsyncRankingInvariance(counted, baseInput(), [noOp]);
    expect(result).toEqual({ passed: false, baseline: ["a", "b"], failures: [], vacuous: ["changes nothing"] });
    expect(rankCalls).toBe(1);
  });

  it("README.md shows exactly this recipe", () => {
    const between = (text: string, start: string, end: string): string =>
      text.slice(text.indexOf(start) + start.length, text.indexOf(end)).trim();
    const source = readFileSync(new URL(import.meta.url), "utf8");
    const recipe = between(source, "// README:async-recipe:start", "// README:async-recipe:end");
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(recipe).toMatch(/^\/\*\*[\s\S]*async function assertAsyncRankingInvariance[\s\S]*\}$/);
    expect(readme).toContain(recipe);
  });
});
