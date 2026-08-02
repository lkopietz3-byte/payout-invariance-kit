/**
 * payout-invariance
 * ------------------
 * Two framework-agnostic checks for any ranking, recommendation, or
 * comparison engine (job boards, marketplaces, insurance comparison sites,
 * real-estate listing sites, review aggregators, credit-card/points
 * optimizers, ...) that wants to PROVE — not merely claim — that its output
 * ordering is not influenced by which option pays the operator more.
 *
 *   1. assertPayoutInvariance — a RUNTIME check. Re-runs a pure ranking
 *      function under a set of adversarial payout mutations and confirms
 *      the result is unchanged.
 *
 *   2. assertNoPayoutImports — a STATIC check. Greps a set of source files
 *      for any reference to payout-related identifiers, so you can assert
 *      the ranking engine's code never even has payout data in scope.
 *
 * Zero runtime dependencies. Pure TypeScript. Nothing here calls a test
 * framework's `expect()` — both functions return plain data so you can wire
 * them into vitest, jest, node:test, or a plain script. See README.md for
 * adapter examples.
 */

// Only used by assertNoPayoutImports' file-path mode (reading files off
// disk). This is a Node built-in, not a third-party package, so the
// "zero runtime dependencies" promise (no npm dependencies) still holds.
// If you only ever use the path -> content map form of assertNoPayoutImports,
// this import is never called.
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Shared: a small, dependency-free structural deep-equal.
// ---------------------------------------------------------------------------

/**
 * Structural deep equality for plain JS values: primitives, Date, RegExp,
 * arrays, Maps, Sets, and plain objects. Good enough for comparing ranking
 * results (arrays/objects of candidates, scores, ids) without pulling in a
 * dependency. NaN === NaN is treated as equal (matches Object.is semantics
 * for that one case), which is what you want when comparing scores.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false; // primitives already handled by Object.is

  const objA = a as object;
  const objB = b as object;

  if (objA instanceof Date || objB instanceof Date) {
    return objA instanceof Date && objB instanceof Date && objA.getTime() === objB.getTime();
  }

  if (objA instanceof RegExp || objB instanceof RegExp) {
    return objA instanceof RegExp && objB instanceof RegExp && String(objA) === String(objB);
  }

  if (Array.isArray(objA) || Array.isArray(objB)) {
    if (!Array.isArray(objA) || !Array.isArray(objB)) return false;
    if (objA.length !== objB.length) return false;
    return objA.every((item, i) => deepEqual(item, objB[i]));
  }

  if (objA instanceof Map || objB instanceof Map) {
    if (!(objA instanceof Map) || !(objB instanceof Map)) return false;
    if (objA.size !== objB.size) return false;
    for (const [key, val] of objA) {
      if (!objB.has(key) || !deepEqual(val, objB.get(key))) return false;
    }
    return true;
  }

  if (objA instanceof Set || objB instanceof Set) {
    if (!(objA instanceof Set) || !(objB instanceof Set)) return false;
    if (objA.size !== objB.size) return false;
    for (const val of objA) {
      let found = false;
      for (const other of objB) {
        if (deepEqual(val, other)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }

  const keysA = Object.keys(objA as Record<string, unknown>);
  const keysB = Object.keys(objB as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    Object.prototype.hasOwnProperty.call(objB, key) &&
    deepEqual((objA as Record<string, unknown>)[key], (objB as Record<string, unknown>)[key]),
  );
}

// ---------------------------------------------------------------------------
// 1. assertPayoutInvariance — runtime invariance under payout mutation.
// ---------------------------------------------------------------------------

/**
 * One named, adversarial way of rewriting the payout data on an input before
 * re-ranking. `mutate` must be pure: it should return a new input (or a
 * deliberately-mutated copy) and must NOT depend on anything outside its
 * arguments, so the check stays reproducible.
 *
 * Name mutations for what they attack, not just "test 1" — e.g. "every
 * candidate gets an equal juicy payout", "the worst candidate gets the
 * single highest payout", "payout is set to Infinity on a normally-losing
 * candidate". See README.md for why boundary/adversarial cases matter more
 * than one easy case.
 */
export interface PayoutMutationScenario<TInput> {
  /** Short, descriptive name for this mutation — shown in failure output. */
  name: string;
  /** Pure function: base input -> mutated input (payout field(s) changed). */
  mutate: (baseInput: TInput) => TInput;
}

export interface AssertPayoutInvarianceOptions<TInput, TResult> {
  /**
   * How to compare two ranking results for equality. Defaults to a
   * structural deep-equal (see `deepEqual` above), which is byte-identical
   * comparison for plain data. Override this if your rank function returns
   * something with non-comparable fields (timestamps, random ids) that you
   * want to ignore — project those out before comparing, or supply a custom
   * comparator.
   */
  isEqual?: (expected: TResult, actual: TResult) => boolean;
  /**
   * How to decide whether a mutation actually changed the input at all.
   * Defaults to "the mutated input is not deep-equal to the base input".
   * This is a generic proxy for "did anything payout-related change": if
   * `mutate()` produced something indistinguishable from the baseline, it
   * clearly didn't change anything payout-related either, and re-running
   * the rank function would just be comparing an input to itself — a
   * vacuous check that would pass no matter how payout-sensitive the
   * ranking function secretly is.
   *
   * Supply your own to be more precise (e.g. compare only the known payout
   * field(s) instead of the whole input) if you want a tighter guarantee
   * that the CHANGED part is specifically the payout data and not some
   * unrelated field.
   */
  hasChanged?: (baseInput: TInput, mutatedInput: TInput) => boolean;
}

export interface PayoutInvarianceFailure<TInput, TResult> {
  /** The mutation scenario's name. */
  scenario: string;
  /** The mutated input that produced a different result. */
  mutatedInput: TInput;
  /** The baseline (unmutated) ranking result. */
  expected: TResult;
  /** The ranking result produced after the mutation. */
  actual: TResult;
}

export interface PayoutInvarianceResult<TInput, TResult> {
  /**
   * True only if every mutation scenario ran (none were vacuous) AND every
   * one produced a result identical to the baseline. A run with zero
   * failures but one or more vacuous scenarios is NOT `passed: true` —
   * a vacuous scenario proves nothing, so it cannot count as a pass.
   */
  passed: boolean;
  /** The unmutated baseline ranking result, for reference. */
  baseline: TResult;
  /** Scenarios whose mutated result differed from the baseline. */
  failures: PayoutInvarianceFailure<TInput, TResult>[];
  /**
   * Names of scenarios whose `mutate` did not actually change the input
   * (per `hasChanged`/the default deep-equal check) — i.e. the precondition
   * that makes the invariance check meaningful was never satisfied. These
   * are neither passes nor failures; they mean "this scenario tested
   * nothing" and should be fixed rather than ignored.
   */
  vacuous: string[];
}

/**
 * Re-run a pure ranking function once per payout-mutation scenario and
 * confirm the output is unchanged from the unmutated baseline.
 *
 * `rankFn` must be pure (same input -> same output, no hidden state) or the
 * comparison is meaningless. This library does not call it more than once
 * per scenario and never mutates its result.
 *
 * Returns a plain result object rather than throwing or calling a test
 * framework's `expect()`, so it works with any test runner (or none). See
 * README.md for a vitest adapter example.
 */
export function assertPayoutInvariance<TInput, TResult>(
  rankFn: (input: TInput) => TResult,
  baseInput: TInput,
  mutations: PayoutMutationScenario<TInput>[],
  opts: AssertPayoutInvarianceOptions<TInput, TResult> = {},
): PayoutInvarianceResult<TInput, TResult> {
  const isEqual = opts.isEqual ?? deepEqual;
  const hasChanged = opts.hasChanged ?? ((base, mutated) => !deepEqual(base, mutated));

  const baseline = rankFn(baseInput);

  const failures: PayoutInvarianceFailure<TInput, TResult>[] = [];
  const vacuous: string[] = [];

  for (const { name, mutate } of mutations) {
    const mutatedInput = mutate(baseInput);

    // Precondition guard: a mutation that changed nothing can't prove
    // invariance. Flag it instead of letting it silently count as a pass.
    if (!hasChanged(baseInput, mutatedInput)) {
      vacuous.push(name);
      continue;
    }

    const actual = rankFn(mutatedInput);
    if (!isEqual(baseline, actual)) {
      failures.push({ scenario: name, mutatedInput, expected: baseline, actual });
    }
  }

  return {
    passed: failures.length === 0 && vacuous.length === 0,
    baseline,
    failures,
    vacuous,
  };
}

// ---------------------------------------------------------------------------
// 2. assertNoPayoutImports — static grep for payout references.
// ---------------------------------------------------------------------------

/**
 * Either a list of file paths to read from disk, or an already-loaded map
 * of `path -> file content`. Use the map form to stay platform-agnostic
 * (e.g. content already gathered by your own import-graph walk, a bundler
 * plugin, or a test running outside Node) — the map form never touches the
 * filesystem.
 */
export type SourceFiles = string[] | Record<string, string>;

export interface AssertNoPayoutImportsOptions {
  /**
   * Strip single-line comments (`// ...`) and whole lines that are part of
   * a `/* ... *\/` block comment before matching, so a comment that merely
   * MENTIONS a forbidden identifier doesn't count as a reference. This is a
   * best-effort, line-based strip (not a real parser) — see README.md
   * "limits" section. Defaults to true.
   */
  stripComments?: boolean;
  /**
   * Case-insensitive matching for string identifiers (RegExp patterns are
   * used as-is; give them their own `i` flag if you want that). Defaults to
   * true, since missing a reference due to casing is worse than an
   * occasional over-match.
   */
  caseInsensitive?: boolean;
}

export interface PayoutImportOffense {
  /** The file path (or map key) that contains a forbidden reference. */
  file: string;
  /** Which of the supplied identifiers/patterns matched, and where. */
  matches: { identifier: string; line: number; text: string }[];
}

const DEFAULT_OPTIONS: Required<AssertNoPayoutImportsOptions> = {
  stripComments: true,
  caseInsensitive: true,
};

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a matcher regex for one identifier/pattern (word-boundary for plain strings). */
function toMatcher(identifier: string | RegExp, caseInsensitive: boolean): RegExp {
  if (identifier instanceof RegExp) {
    const flags = identifier.flags.includes("g") ? identifier.flags : identifier.flags + "g";
    return new RegExp(identifier.source, flags);
  }
  // \b works on word characters, so this also catches identifiers embedded
  // in import specifiers like "@/lib/affiliate" (the '/' and quote around
  // it are non-word characters, so the boundary still lands correctly).
  const flags = "g" + (caseInsensitive ? "i" : "");
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`, flags);
}

/** Strip `//` line comments and lines that are purely part of a block comment. */
function stripCommentLines(src: string): string {
  let inBlockComment = false;
  return src
    .split("\n")
    .map((rawLine) => {
      let line = rawLine;
      if (inBlockComment) {
        const end = line.indexOf("*/");
        if (end === -1) return "";
        line = line.slice(end + 2);
        inBlockComment = false;
      }
      const blockStart = line.indexOf("/*");
      if (blockStart !== -1) {
        const blockEnd = line.indexOf("*/", blockStart + 2);
        if (blockEnd !== -1) {
          line = line.slice(0, blockStart) + line.slice(blockEnd + 2);
        } else {
          line = line.slice(0, blockStart);
          inBlockComment = true;
        }
      }
      const lineCommentIdx = line.indexOf("//");
      if (lineCommentIdx !== -1) line = line.slice(0, lineCommentIdx);
      return line;
    })
    .join("\n");
}

function normalizeToMap(files: SourceFiles): Record<string, string> {
  if (Array.isArray(files)) {
    // Only this branch (file-path list) touches the filesystem. The
    // map-of-content form below never calls readFileSync.
    const map: Record<string, string> = {};
    for (const path of files) {
      map[path] = readFileSync(path, "utf8");
    }
    return map;
  }
  return files;
}

/**
 * Grep a set of source files for any reference to forbidden
 * payout/commission/affiliate-style identifiers.
 *
 * `files` is either a list of file paths (read from disk with Node's
 * built-in `fs`) or a pre-loaded map of `path -> content` (no filesystem
 * access at all — use this for non-Node runtimes or when you've already
 * walked an import graph yourself and gathered the file contents).
 *
 * `payoutIdentifiers` is a list of plain identifiers (matched as whole
 * words / import-path segments, e.g. `"commission"`, `"affiliateRate"`,
 * `"payout"`) and/or regular expressions for more specific patterns.
 *
 * Returns the list of offending files (empty if none) so a caller's test
 * can assert that list is empty:
 *
 *   const offenses = assertNoPayoutImports(files, ["commission", "payout"]);
 *   expect(offenses).toEqual([]);
 */
export function assertNoPayoutImports(
  files: SourceFiles,
  payoutIdentifiers: (string | RegExp)[],
  opts: AssertNoPayoutImportsOptions = {},
): PayoutImportOffense[] {
  const { stripComments, caseInsensitive } = { ...DEFAULT_OPTIONS, ...opts };
  const fileMap = normalizeToMap(files);
  const matchers = payoutIdentifiers.map((id) => ({
    label: id instanceof RegExp ? id.source : id,
    regex: toMatcher(id, caseInsensitive),
  }));

  const offenses: PayoutImportOffense[] = [];

  for (const [path, rawContent] of Object.entries(fileMap)) {
    const content = stripComments ? stripCommentLines(rawContent) : rawContent;
    const lines = content.split("\n");
    const matches: PayoutImportOffense["matches"] = [];

    lines.forEach((lineText, idx) => {
      for (const { label, regex } of matchers) {
        regex.lastIndex = 0;
        if (regex.test(lineText)) {
          matches.push({ identifier: label, line: idx + 1, text: lineText.trim() });
        }
      }
    });

    if (matches.length > 0) {
      offenses.push({ file: path, matches });
    }
  }

  return offenses;
}
