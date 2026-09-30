import { describe, expect, it } from "vitest";

import { assertPayoutInvariance } from "../src/index";
import type { PayoutMutationScenario } from "../src/index";

// ---------------------------------------------------------------------------
// A tiny ranking domain reused across this file: candidates with a
// qualityScore (what the ranker should use) and a payoutRateBps (what it
// must not use). Kept separate from examples/toy-marketplace.test.ts, which
// is the runnable, documentation-facing example.
// ---------------------------------------------------------------------------

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

function honestRank(input: RankInput): RankResult {
  const sorted = [...input.candidates].sort((a, b) => b.qualityScore - a.qualityScore);
  return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
}

const bumpAllPayouts: PayoutMutationScenario<RankInput> = {
  name: "every candidate's payout goes up",
  mutate: (input) => ({ candidates: input.candidates.map((c) => ({ ...c, payoutRateBps: c.payoutRateBps + 100 })) }),
};

describe("assertPayoutInvariance: boundary and validation", () => {
  it("rejects a non-function rankFn", () => {
    expect(() =>
      // @ts-expect-error deliberately wrong type at the runtime boundary
      assertPayoutInvariance("not a function", { candidates: [] }, [bumpAllPayouts]),
    ).toThrow(/rankFn must be a function/);
  });

  it("rejects a non-array mutations argument", () => {
    expect(() =>
      // @ts-expect-error deliberately wrong type at the runtime boundary
      assertPayoutInvariance(honestRank, { candidates: [] }, "not an array"),
    ).toThrow(/mutations must be an array/);
  });

  it("rejects an empty mutations array instead of silently passing (regression)", () => {
    // Before the fix, an empty list ran zero scenarios and still returned
    // passed: true — a check that tested nothing reported a clean bill of
    // health. It must now refuse to run at all.
    expect(() => assertPayoutInvariance(honestRank, { candidates: [] }, [])).toThrow(/mutations is empty/);
  });

  it("rejects a malformed scenario entry, naming its index", () => {
    expect(() =>
      assertPayoutInvariance(honestRank, { candidates: [] }, [
        // @ts-expect-error deliberately missing "mutate"
        { name: "no mutate function" },
      ]),
    ).toThrow(/mutations\[0\]/);
    expect(() =>
      assertPayoutInvariance(honestRank, { candidates: [] }, [
        // @ts-expect-error deliberately missing "name"
        { mutate: (i: RankInput) => i },
      ]),
    ).toThrow(/mutations\[0\]/);
  });
});

describe("assertPayoutInvariance: async ranking functions (regression)", () => {
  const baseInput: RankInput = { candidates: [{ id: "a", qualityScore: 1, payoutRateBps: 0 }] };

  it("throws when rankFn returns a Promise instead of silently comparing Promise objects", () => {
    // Before the fix, two different Promise objects had zero own enumerable
    // keys, so the default deepEqual called them "equal" no matter what they
    // resolved to — an async, payout-sensitive ranker got passed: true.
    async function asyncPayoutSensitiveRank(input: RankInput) {
      return honestRank({
        candidates: input.candidates.map((c) => ({ ...c, qualityScore: c.qualityScore + c.payoutRateBps })),
      });
    }
    expect(() =>
      // TypeScript happily infers TResult as Promise<RankResult> here — the
      // type system doesn't stop you from passing an async function; only
      // the runtime guard does.
      assertPayoutInvariance(asyncPayoutSensitiveRank, baseInput, [bumpAllPayouts]),
    ).toThrow(/rankFn returned a Promise/);
  });

  it("says Promises are not comparable (equal only to themselves), not that they are always equal", () => {
    const asyncRank = async (input: typeof baseInput): Promise<RankResult> => honestRank(input);
    let message = "";
    try {
      assertPayoutInvariance(asyncRank, baseInput, [bumpAllPayouts]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("each Promise is equal only to itself");
    expect(message).not.toMatch(/always/);
  });

  it("throws when mutate returns a Promise", () => {
    expect(() =>
      assertPayoutInvariance(honestRank, baseInput, [
        {
          name: "async mutate",
          // @ts-expect-error mutate is typed to return TInput synchronously
          mutate: async (input: RankInput) => input,
        },
      ]),
    ).toThrow(/mutate\(\) returned a Promise/);
  });
});

describe("assertPayoutInvariance: input/output mutation detection (regression)", () => {
  const baseInput: RankInput = {
    candidates: [
      { id: "b", qualityScore: 5, payoutRateBps: 0 },
      { id: "a", qualityScore: 10, payoutRateBps: 0 },
    ],
  };

  it("throws when rankFn mutates baseInput in place", () => {
    // A rankFn that sorts baseInput.candidates in place (instead of copying
    // first) corrupts the one baseInput every later scenario mutates from.
    // baseInput starts out-of-order ("b" before "a") so the in-place sort
    // actually changes it and the guard has something to detect.
    function inPlaceSortingRank(input: RankInput): RankResult {
      input.candidates.sort((a, b) => b.qualityScore - a.qualityScore);
      return { orderedIds: input.candidates.map((c) => c.id), topPick: input.candidates[0]?.id ?? null };
    }
    expect(() => assertPayoutInvariance(inPlaceSortingRank, structuredClone(baseInput), [bumpAllPayouts])).toThrow(
      /modified baseInput in place/,
    );
  });

  it("throws when mutate edits baseInput in place instead of returning a copy", () => {
    const badMutation: PayoutMutationScenario<RankInput> = {
      name: "forgot to copy",
      mutate: (input) => {
        // Deliberately testing the in-place-mutation guard: edits baseInput
        // instead of returning a copy.
        input.candidates[0]!.payoutRateBps += 500;
        return input;
      },
    };
    expect(() => assertPayoutInvariance(honestRank, structuredClone(baseInput), [badMutation])).toThrow(
      /modified baseInput in place/,
    );
  });

  it("throws when rankFn reuses and mutates its own earlier result (regression)", () => {
    // A rankFn that clears and refills one shared output array on every call
    // would make `baseline` and `actual` literally the same object by the
    // time they are compared, so a real payout dependence would never show
    // up as a difference — the check would pass no matter what.
    const sharedResult: RankResult = { orderedIds: [], topPick: null };
    function cachingPayoutSensitiveRank(input: RankInput): RankResult {
      const sorted = [...input.candidates].sort(
        (a, b) => b.qualityScore + b.payoutRateBps - (a.qualityScore + a.payoutRateBps),
      );
      sharedResult.orderedIds = sorted.map((c) => c.id);
      sharedResult.topPick = sorted[0]?.id ?? null;
      return sharedResult;
    }
    // Boosting only the lower-quality candidate's payout enormously would
    // flip this scorer's order (were it not reusing sharedResult) — the
    // mutation matters, unlike an equal bump to every candidate.
    const flipOrderWithPayout: PayoutMutationScenario<RankInput> = {
      name: "the lower-quality candidate gets a huge payout boost",
      mutate: (input) => ({
        candidates: input.candidates.map((c) => (c.id === "b" ? { ...c, payoutRateBps: 1_000_000 } : c)),
      }),
    };
    expect(() =>
      assertPayoutInvariance(cachingPayoutSensitiveRank, structuredClone(baseInput), [flipOrderWithPayout]),
    ).toThrow(/modified its earlier .* result in place/);
  });
});

describe("assertPayoutInvariance: isEqual/hasChanged must return a boolean", () => {
  const baseInput: RankInput = { candidates: [{ id: "a", qualityScore: 1, payoutRateBps: 0 }] };

  it("throws if isEqual returns a non-boolean (e.g. a Promise from an accidentally-async comparator)", () => {
    expect(() =>
      assertPayoutInvariance(honestRank, baseInput, [bumpAllPayouts], {
        // @ts-expect-error isEqual must return boolean
        isEqual: async () => true,
      }),
    ).toThrow(/isEqual must return a boolean/);
  });

  it("throws if hasChanged returns a non-boolean", () => {
    expect(() =>
      assertPayoutInvariance(honestRank, baseInput, [bumpAllPayouts], {
        // @ts-expect-error hasChanged must return boolean
        hasChanged: () => 1,
      }),
    ).toThrow(/hasChanged must return a boolean/);
  });
});

describe("assertPayoutInvariance: error propagation", () => {
  const baseInput: RankInput = { candidates: [{ id: "a", qualityScore: 1, payoutRateBps: 0 }] };

  it("rethrows a rankFn error on the baseline call, with the original as cause", () => {
    const boom = new Error("boom");
    const throwing = () => {
      throw boom;
    };
    try {
      assertPayoutInvariance(throwing, baseInput, [bumpAllPayouts]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/rankFn threw on the baseline input/);
      expect((error as Error).cause).toBe(boom);
    }
  });

  it("rethrows a rankFn error on a mutated input, naming the scenario", () => {
    function throwsOnMutated(input: RankInput): RankResult {
      if (input.candidates[0]?.payoutRateBps !== 0) throw new Error("mutated boom");
      return honestRank(input);
    }
    expect(() => assertPayoutInvariance(throwsOnMutated, baseInput, [bumpAllPayouts])).toThrow(
      /scenario "every candidate's payout goes up"/,
    );
  });

  it("rethrows a mutate() error, naming the scenario", () => {
    const badMutation: PayoutMutationScenario<RankInput> = {
      name: "explodes",
      mutate: () => {
        throw new Error("mutate boom");
      },
    };
    expect(() => assertPayoutInvariance(honestRank, baseInput, [badMutation])).toThrow(
      /scenario "explodes": mutate\(\) threw: mutate boom/,
    );
  });
});

describe("assertPayoutInvariance: ties, tie-breaking, and ranking stability", () => {
  const tiedInput: RankInput = {
    candidates: [
      { id: "a", qualityScore: 50, payoutRateBps: 0 },
      { id: "b", qualityScore: 50, payoutRateBps: 0 }, // tied with "a"
      { id: "c", qualityScore: 10, payoutRateBps: 0 },
    ],
  };

  it("an honest ranker that breaks ties by original order is invariant to payout", () => {
    // Array.prototype.sort is stable (ES2019+), so honestRank preserves
    // input order among equal-quality candidates regardless of payout.
    const result = assertPayoutInvariance(honestRank, tiedInput, [
      bumpAllPayouts,
      { name: "only the tied pair gets a payout bump", mutate: (i) => ({
        candidates: i.candidates.map((c) => (c.qualityScore === 50 ? { ...c, payoutRateBps: 999 } : c)),
      }) },
    ]);
    expect(result.baseline.orderedIds).toEqual(["a", "b", "c"]);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("catches a ranker that uses payout only to break ties", () => {
    function tieBreaksByPayout(input: RankInput): RankResult {
      const sorted = [...input.candidates].sort((a, b) => {
        if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
        return b.payoutRateBps - a.payoutRateBps; // bug: payout decides ties
      });
      return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
    }
    const result = assertPayoutInvariance(tieBreaksByPayout, tiedInput, [
      { name: "give the second-place tied candidate a higher payout", mutate: (i) => ({
        candidates: i.candidates.map((c) => (c.id === "b" ? { ...c, payoutRateBps: 999 } : c)),
      }) },
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.actual.orderedIds).toEqual(["b", "a", "c"]);
  });
});

describe("assertPayoutInvariance: NaN and undefined payout values", () => {
  it("treats a NaN payout consistently and does not spuriously fail because NaN !== NaN", () => {
    interface Loose {
      candidates: (Candidate & { payoutRateBps: number })[];
    }
    const input: Loose = {
      candidates: [
        { id: "a", qualityScore: 10, payoutRateBps: NaN },
        { id: "b", qualityScore: 1, payoutRateBps: 0 },
      ],
    };
    const result = assertPayoutInvariance(honestRank, input, [bumpAllPayouts]);
    expect(result.baseline.topPick).toBe("a");
    expect(result.passed).toBe(true);
  });

  it("treats undefined payout fields as a real value change when mutated to a number", () => {
    interface WithOptionalPayout {
      candidates: { id: string; qualityScore: number; payoutRateBps?: number }[];
    }
    function rankIgnoringPayout(input: WithOptionalPayout): RankResult {
      const sorted = [...input.candidates].sort((a, b) => b.qualityScore - a.qualityScore);
      return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
    }
    const input: WithOptionalPayout = {
      candidates: [
        { id: "a", qualityScore: 10 }, // payoutRateBps left undefined
        { id: "b", qualityScore: 1 },
      ],
    };
    const result = assertPayoutInvariance(rankIgnoringPayout, input, [
      { name: "undefined payout becomes a huge number", mutate: (i) => ({
        candidates: i.candidates.map((c) => ({ ...c, payoutRateBps: Number.MAX_SAFE_INTEGER })),
      }) },
    ]);
    expect(result.vacuous).toEqual([]); // the mutation really did change the input
    expect(result.passed).toBe(true);
  });
});

describe("assertPayoutInvariance: duplicate candidate ids", () => {
  it("compares ranking results correctly even when candidate ids repeat", () => {
    const input: RankInput = {
      candidates: [
        { id: "dup", qualityScore: 90, payoutRateBps: 0 },
        { id: "dup", qualityScore: 20, payoutRateBps: 0 }, // same id, different score
        { id: "unique", qualityScore: 55, payoutRateBps: 0 },
      ],
    };
    const result = assertPayoutInvariance(honestRank, input, [bumpAllPayouts]);
    expect(result.baseline.orderedIds).toEqual(["dup", "unique", "dup"]);
    expect(result.passed).toBe(true);

    // A payout-sensitive ranker swapping the two "dup" entries is still caught.
    function payoutSensitive(i: RankInput): RankResult {
      const sorted = [...i.candidates].sort(
        (a, b) => b.qualityScore + b.payoutRateBps - (a.qualityScore + a.payoutRateBps),
      );
      return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
    }
    const biased = assertPayoutInvariance(payoutSensitive, input, [
      { name: "boost the lower-scoring duplicate's payout enormously", mutate: (i) => ({
        candidates: i.candidates.map((c, idx) => (c.id === "dup" && idx === 1 ? { ...c, payoutRateBps: 1_000_000 } : c)),
      }) },
    ]);
    expect(biased.passed).toBe(false);
  });
});

describe("assertPayoutInvariance: empty candidate lists", () => {
  it("an empty candidate list makes a payout mutation vacuous, not a silent pass", () => {
    const emptyInput: RankInput = { candidates: [] };
    const result = assertPayoutInvariance(honestRank, emptyInput, [bumpAllPayouts]);
    expect(result.baseline).toEqual({ orderedIds: [], topPick: null });
    // mutate() maps over zero candidates, so the "mutated" input is
    // identical to the baseline: nothing was actually tested.
    expect(result.vacuous).toEqual(["every candidate's payout goes up"]);
    expect(result.passed).toBe(false);
  });

  it("a scenario that changes something even on an empty list is not vacuous", () => {
    interface WithGlobalFee {
      candidates: Candidate[];
      globalPayoutMultiplier: number;
    }
    function rankIgnoringMultiplier(input: WithGlobalFee): RankResult {
      return honestRank(input);
    }
    const result = assertPayoutInvariance(rankIgnoringMultiplier, { candidates: [], globalPayoutMultiplier: 1 }, [
      { name: "raise the global payout multiplier", mutate: (i) => ({ ...i, globalPayoutMultiplier: 5 }) },
    ]);
    expect(result.vacuous).toEqual([]);
    expect(result.passed).toBe(true);
  });
});
