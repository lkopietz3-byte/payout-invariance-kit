// Strict NodeNext type probe: compiled (not run) by scripts/verify-package.mjs
// against the installed declarations. Type-level usage only — no node:assert,
// since this kit has no @types/node in a form guaranteed to resolve here (see
// the shared standard's note on this file).
import {
  assertNoPayoutImports,
  assertPayoutInvariance,
  deepEqual,
  type AssertNoPayoutImportsOptions,
  type AssertPayoutInvarianceOptions,
  type PayoutImportOffense,
  type PayoutInvarianceFailure,
  type PayoutInvarianceResult,
  type PayoutMutationScenario,
  type SourceFiles,
} from 'payout-invariance-kit';

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

const rank = (input: RankInput): RankResult => {
  const sorted = [...input.candidates].sort((a, b) => b.qualityScore - a.qualityScore);
  return { orderedIds: sorted.map((c) => c.id), topPick: sorted[0]?.id ?? null };
};

const baseInput: RankInput = {
  candidates: [{ id: 'a', qualityScore: 1, payoutRateBps: 0 }],
};

const scenarios: PayoutMutationScenario<RankInput>[] = [
  {
    name: 'bump payout',
    mutate: (input) => ({ candidates: input.candidates.map((c) => ({ ...c, payoutRateBps: c.payoutRateBps + 1 })) }),
  },
];

const options: AssertPayoutInvarianceOptions<RankInput, RankResult> = {
  isEqual: (expected, actual) => deepEqual(expected, actual),
  hasChanged: (before, after) => !deepEqual(before, after),
};

const result: PayoutInvarianceResult<RankInput, RankResult> = assertPayoutInvariance(rank, baseInput, scenarios, options);
const passed: boolean = result.passed;
const baseline: RankResult = result.baseline;
const vacuous: string[] = result.vacuous;
const firstFailure: PayoutInvarianceFailure<RankInput, RankResult> | undefined = result.failures[0];
const failedScenarioName: string | undefined = firstFailure?.scenario;
const mutatedInput: RankInput | undefined = firstFailure?.mutatedInput;

const files: SourceFiles = { 'rank.ts': 'export function rank(x: number) { return x; }' };
const staticOptions: AssertNoPayoutImportsOptions = { stripComments: true, caseInsensitive: true };
const offenses: PayoutImportOffense[] = assertNoPayoutImports(files, ['commission', /payout/i], staticOptions);
const firstOffenseFile: string | undefined = offenses[0]?.file;
const firstMatchLine: number | undefined = offenses[0]?.matches[0]?.line;

// @ts-expect-error mutate must return the same TInput shape.
const wrongShape: PayoutMutationScenario<RankInput> = { name: 'bad', mutate: () => 42 };
// @ts-expect-error assertNoPayoutImports needs an array of identifiers, not a bare string.
assertNoPayoutImports(files, 'commission');

export {
  passed,
  baseline,
  vacuous,
  failedScenarioName,
  mutatedInput,
  firstOffenseFile,
  firstMatchLine,
  wrongShape,
};
