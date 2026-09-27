import { describe, expect, it } from "vitest";

import { assertPayoutInvariance } from "../src/index";

// This test's body is the README.md "Quickstart" example, copy-pasted, minus
// the two comments. If this test breaks, the README is lying about what you
// can paste and run.
describe("README Quickstart", () => {
  it("runs as pasted and reports passed: true", () => {
    const baseInput = {
      candidates: [
        { id: "a", score: 90, payoutRateBps: 50 },
        { id: "b", score: 60, payoutRateBps: 0 },
        { id: "c", score: 30, payoutRateBps: 500 },
      ],
    };

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

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.vacuous).toEqual([]);
    expect(result.baseline).toEqual({ orderedIds: ["a", "b", "c"] });
  });
});
