/**
 * Runnable example: both payout-invariance functions exercised against a
 * tiny, self-contained toy ranking engine (a generic "marketplace listing"
 * ranker). Nothing here references any real product, card, program, or
 * business — it's illustrative only.
 *
 * Run with: npx vitest run
 */
import { describe, expect, it } from "vitest";

import { assertPayoutInvariance, assertNoPayoutImports } from "../src/index";
import type { PayoutMutationScenario } from "../src/index";

// ---------------------------------------------------------------------------
// Toy domain: rank "candidates" (could be listings, cards, policies, jobs...)
// by a quality score. Each candidate ALSO carries a payoutRateBps field
// (how much the platform would earn if a user picks it) — the point of the
// exercise is that `rank()` below never reads that field.
// ---------------------------------------------------------------------------

interface Candidate {
  id: string;
  qualityScore: number; // 0-100, higher is better for the end user
  payoutRateBps: number; // basis points earned by the platform — NOT read by rank()
}

interface RankInput {
  candidates: Candidate[];
}

interface RankResult {
  orderedIds: string[];
  topPick: string | null;
}

/** The engine under test. Ranks purely on qualityScore. */
function rank(input: RankInput): RankResult {
  const sorted = [...input.candidates].sort((a, b) => b.qualityScore - a.qualityScore);
  return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
}

const baseInput: RankInput = {
  candidates: [
    { id: "candidate-a", qualityScore: 92, payoutRateBps: 50 },
    { id: "candidate-b", qualityScore: 78, payoutRateBps: 50 },
    { id: "candidate-c", qualityScore: 61, payoutRateBps: 50 },
    { id: "candidate-d", qualityScore: 40, payoutRateBps: 0 }, // e.g. a "pay nothing" option
  ],
};

// Adversarial, boundary-seeking mutations — not just one easy case. See
// README.md "limits" section for why this variety matters.
const equalGenerousPayoutMutation: PayoutMutationScenario<RankInput> = {
  name: "every candidate gets an equal, generous payout",
  mutate: (input) => ({
    candidates: input.candidates.map((c) => ({ ...c, payoutRateBps: 500 })),
  }),
};

const worstCandidateHighestPayoutMutation: PayoutMutationScenario<RankInput> = {
  name: "the worst-quality candidate gets the single highest payout",
  mutate: (input) => {
    const worst = [...input.candidates].sort((a, b) => a.qualityScore - b.qualityScore)[0];
    return {
      candidates: input.candidates.map((c) =>
        c.id === worst?.id ? { ...c, payoutRateBps: 10_000 } : { ...c, payoutRateBps: 0 },
      ),
    };
  },
};

const invertedPayoutMutation: PayoutMutationScenario<RankInput> = {
  name: "payout is exactly inverted relative to quality rank",
  mutate: (input) => {
    const byQuality = [...input.candidates].sort((a, b) => a.qualityScore - b.qualityScore);
    const payoutById = new Map(byQuality.map((c, i) => [c.id, (i + 1) * 1000]));
    return {
      candidates: input.candidates.map((c) => ({
        ...c,
        payoutRateBps: payoutById.get(c.id) ?? 0,
      })),
    };
  },
};

const zeroPayoutBumpedToExtremeMutation: PayoutMutationScenario<RankInput> = {
  name: "a zero-payout candidate is bumped to an extreme payout value",
  mutate: (input) => ({
    candidates: input.candidates.map((c) =>
      c.payoutRateBps === 0 ? { ...c, payoutRateBps: Number.MAX_SAFE_INTEGER } : c,
    ),
  }),
};

const mutations: PayoutMutationScenario<RankInput>[] = [
  equalGenerousPayoutMutation,
  worstCandidateHighestPayoutMutation,
  invertedPayoutMutation,
  zeroPayoutBumpedToExtremeMutation,
];

describe("assertPayoutInvariance", () => {
  it("the ranking is unchanged across every adversarial payout mutation", () => {
    const result = assertPayoutInvariance(rank, baseInput, mutations);

    expect(result.vacuous).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
    // Sanity: the baseline itself is the honest, quality-ordered ranking.
    expect(result.baseline.topPick).toBe("candidate-a");
    expect(result.baseline.orderedIds).toEqual([
      "candidate-a",
      "candidate-b",
      "candidate-c",
      "candidate-d",
    ]);
  });

  it("flags a no-op mutation as vacuous instead of a silent pass", () => {
    // This mutation forgets to actually change anything — a common copy-paste
    // bug when writing new scenarios. The precondition guard must catch it.
    const noOpMutation: PayoutMutationScenario<RankInput> = {
      name: "forgot to change payoutRateBps",
      mutate: (input) => ({ candidates: input.candidates.map((c) => ({ ...c })) }),
    };

    const result = assertPayoutInvariance(rank, baseInput, [noOpMutation]);

    expect(result.vacuous).toEqual(["forgot to change payoutRateBps"]);
    expect(result.failures).toEqual([]); // it wasn't even run against rank()
    // A vacuous scenario means the check proved nothing, so passed is false
    // even though nothing "failed" in the ordinary sense.
    expect(result.passed).toBe(false);
  });

  it("catches a rank function that DOES let payout influence the order", () => {
    // A deliberately payout-sensitive ranker, to prove the check has teeth.
    function payoutInfluencedRank(input: RankInput): RankResult {
      const sorted = [...input.candidates].sort(
        (a, b) => b.qualityScore + b.payoutRateBps * 0.01 - (a.qualityScore + a.payoutRateBps * 0.01),
      );
      return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
    }

    const result = assertPayoutInvariance(payoutInfluencedRank, baseInput, [
      worstCandidateHighestPayoutMutation,
    ]);

    expect(result.passed).toBe(false);
    expect(result.vacuous).toEqual([]);
    expect(result.failures).toHaveLength(1);
    const [failure] = result.failures;
    expect(failure).toBeDefined();
    expect(failure?.scenario).toBe(worstCandidateHighestPayoutMutation.name);
    // The payout-influenced ranker moved the worst-quality candidate to the
    // top once it got the extreme payout — exactly what the check exists to
    // catch.
    expect(failure?.actual.topPick).toBe("candidate-d");
    expect(failure?.expected.topPick).toBe("candidate-a");
  });
});

// ---------------------------------------------------------------------------
// assertNoPayoutImports — static check against in-memory "source files".
// (A real caller would usually pass file paths and let the library read
// them; the map form is used here so the example has no filesystem
// dependency and stays fully self-contained.)
// ---------------------------------------------------------------------------

const cleanRankSource = `
// This module intentionally has nothing to do with payout or commission
// data — it only compares quality scores.
export function rank(input: RankInput): RankResult {
  const sorted = [...input.candidates].sort((a, b) => b.qualityScore - a.qualityScore);
  return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
}
`;

const leakyRankSource = `
import { commission } from "./payout";

export function rank(input: RankInput): RankResult {
  const sorted = [...input.candidates].sort(
    (a, b) => b.qualityScore + commission(b.id) - (a.qualityScore + commission(a.id)),
  );
  return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
}
`;

describe("assertNoPayoutImports", () => {
  const forbidden = ["commission", "payout", "affiliateRate"];

  it("returns an empty list for files that never reference payout identifiers in code", () => {
    const offenses = assertNoPayoutImports({ "src/rank.clean.ts": cleanRankSource }, forbidden);
    expect(offenses).toEqual([]);
  });

  it("flags a file that imports/uses a payout identifier in real code", () => {
    const offenses = assertNoPayoutImports(
      {
        "src/rank.clean.ts": cleanRankSource,
        "src/rank.leaky.ts": leakyRankSource,
      },
      forbidden,
    );

    expect(offenses.map((o) => o.file)).toEqual(["src/rank.leaky.ts"]);
    const [offense] = offenses;
    expect(offense).toBeDefined();
    // Both the "commission" identifier and the "./payout" import path are
    // caught (a file can rack up more than one match per line/identifier;
    // dedupe here since the test only cares WHICH identifiers were seen).
    const matchedIdentifiers = Array.from(
      new Set(offense?.matches.map((m) => m.identifier)),
    ).sort();
    expect(matchedIdentifiers).toEqual(["commission", "payout"]);
  });

  it("ignores a comment-only mention of a forbidden word (best-effort comment strip)", () => {
    const commentOnlyMention = `
      // TODO: some other team asked about a "commission" model once; not us.
      export function rank(input: RankInput): RankResult {
        const sorted = [...input.candidates].sort((a, b) => b.qualityScore - a.qualityScore);
        return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
      }
    `;
    const offenses = assertNoPayoutImports({ "src/rank.ts": commentOnlyMention }, forbidden);
    expect(offenses).toEqual([]);
  });
});
