/**
 * payout-invariance-kit
 * ----------------------
 * Two framework-agnostic checks for any ranking, recommendation, or
 * comparison engine (job boards, marketplaces, insurance comparison sites,
 * real-estate listing sites, review aggregators, credit-card/points
 * optimizers, ...) that wants to check — not merely claim — that its output
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
 * A passing `assertPayoutInvariance` result means "no difference in the
 * scenarios you tested", not "the ranking function ignores payout in
 * general". See README.md, "Honest limits".
 *
 * Zero runtime dependencies. Pure TypeScript. Nothing here calls a test
 * framework's `expect()` — both functions return plain data so you can wire
 * them into vitest, jest, node:test, or a plain script. See README.md for
 * adapter examples.
 */

import { deepEqual, kindOf, regExpParts } from "./deepEqual.js";
import { snapshot } from "./snapshot.js";

export { deepEqual };

// ---------------------------------------------------------------------------
// 1. assertPayoutInvariance — runtime invariance under payout mutation.
// ---------------------------------------------------------------------------

/**
 * One named, adversarial way of rewriting the payout data on an input before
 * re-ranking. `mutate` must be pure and synchronous: it must return a new
 * input (or a deliberately-mutated copy) without depending on anything
 * outside its arguments, and it must not modify `baseInput` in place — every
 * scenario is mutated from the same `baseInput`, so an in-place edit would
 * corrupt every later scenario. `assertPayoutInvariance` detects and throws
 * on both an in-place edit and a mutate that returns a Promise.
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
  /** Pure, synchronous function: base input -> mutated input (payout field(s) changed). */
  mutate: (baseInput: TInput) => TInput;
}

export interface AssertPayoutInvarianceOptions<TInput, TResult> {
  /**
   * How to compare two ranking results for equality. Defaults to a
   * structural deep-equal (see `deepEqual` above), which is byte-identical
   * comparison for plain data. Override this if your rank function returns
   * something with non-comparable fields (timestamps, random ids) that you
   * want to ignore — project those out before comparing, or supply a custom
   * comparator. Must return a boolean; anything else (including a Promise)
   * makes `assertPayoutInvariance` throw.
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
   * unrelated field. Must return a boolean; anything else makes
   * `assertPayoutInvariance` throw.
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

function isThenable(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

const SHORT_ESCAPES = new Map([
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
]);

/**
 * Escape control characters, line and paragraph separators, and bidi
 * formatting characters, so caller text inside an error message cannot start
 * a fake new line, reorder what a reader sees, or send a terminal escape.
 */
function escapeText(text: string): string {
  return text.replace(
    /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu,
    (ch) => SHORT_ESCAPES.get(ch) ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** A caller string as a quoted, escaped label for an error message. */
function quote(text: string): string {
  return `"${escapeText(text.replace(/["\\]/g, "\\$&"))}"`;
}

/** A thrown value's message, escaped; never throws itself. */
function describeError(error: unknown): string {
  try {
    return escapeText(error instanceof Error ? String(error.message) : String(error));
  } catch {
    return "(unprintable thrown value)";
  }
}

const hasOwn = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

/** Only a plain `{}` or `Object.create(null)` object counts as an options or content record. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || kindOf(value) !== "Object") return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Blank means only whitespace and default-ignorable characters (zero-width and bidi formatting marks). */
function isBlank(text: string): boolean {
  return /^[\s\p{Default_Ignorable_Code_Point}]*$/u.test(text);
}

/**
 * Validate `mutations` with one indexed pass (holes rejected, inherited
 * elements ignored), reading each scenario's `name` and `mutate` exactly
 * once, and return that snapshot. The run uses only this snapshot, so what
 * was validated is exactly what runs, whatever the array's iterator or the
 * scenario's getters do later.
 */
function snapshotMutations<TInput>(mutations: unknown): PayoutMutationScenario<TInput>[] {
  if (!Array.isArray(mutations)) {
    throw new TypeError("assertPayoutInvariance: mutations must be an array of { name, mutate } objects.");
  }
  const length = mutations.length;
  if (length === 0) {
    throw new Error(
      "assertPayoutInvariance: mutations is empty, so nothing would be tested. Pass at least one scenario.",
    );
  }
  const list: PayoutMutationScenario<TInput>[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!hasOwn(mutations, index)) {
      throw new TypeError(
        `assertPayoutInvariance: mutations[${index}] is missing (a hole in a sparse array). Pass a dense array.`,
      );
    }
    const candidate: unknown = mutations[index];
    const name: unknown = typeof candidate === "object" && candidate !== null ? Reflect.get(candidate, "name") : undefined;
    const mutate: unknown =
      typeof candidate === "object" && candidate !== null ? Reflect.get(candidate, "mutate") : undefined;
    if (typeof name !== "string" || typeof mutate !== "function") {
      throw new TypeError(
        `assertPayoutInvariance: mutations[${index}] must be an object with a string "name" and a "mutate" function.`,
      );
    }
    list.push({ name, mutate: mutate as (baseInput: TInput) => TInput });
  }
  return list;
}

type Hook = ((...args: never[]) => unknown) | undefined;

/** Read `opts` once: undefined or a plain object whose hooks are functions or undefined. */
function readRuntimeOptions(opts: unknown): { isEqual: Hook; hasChanged: Hook } {
  if (opts === undefined) return { isEqual: undefined, hasChanged: undefined };
  if (!isPlainRecord(opts)) {
    throw new TypeError("assertPayoutInvariance: opts must be a plain object (or omitted).");
  }
  const isEqual = opts.isEqual;
  const hasChanged = opts.hasChanged;
  for (const [hook, value] of [
    ["isEqual", isEqual],
    ["hasChanged", hasChanged],
  ] as const) {
    if (value !== undefined && typeof value !== "function") {
      throw new TypeError(`assertPayoutInvariance: opts.${hook} must be a function (or omitted).`);
    }
  }
  return { isEqual: isEqual as Hook, hasChanged: hasChanged as Hook };
}

/**
 * Re-run a pure ranking function once per payout-mutation scenario and
 * confirm the output is unchanged from the unmutated baseline.
 *
 * `rankFn` must be pure and synchronous (same input -> same output, no
 * hidden state, no Promise) or the comparison is meaningless. This library
 * calls it exactly once per scenario (plus once for the baseline) and never
 * mutates its input or its result.
 *
 * Returns a plain result object rather than throwing or calling a test
 * framework's `expect()`, so it works with any test runner (or none). See
 * README.md for a vitest adapter example.
 *
 * `mutations` is validated and copied with one indexed pass before
 * anything runs: each scenario's `name` and `mutate` are read once, and the
 * run uses only that copy, so the scenarios that were checked are exactly
 * the scenarios that run.
 *
 * Throws, rather than returning a result, when the run cannot be trusted:
 * - `rankFn` is not a function, `mutations` is not a non-empty, dense array
 *   of `{ name, mutate }` (a hole in a sparse array is rejected), or `opts`
 *   is not a plain object whose `isEqual`/`hasChanged` are functions or
 *   undefined (all checked before anything runs).
 * - `rankFn` throws on the baseline or on a mutated input, or `mutate`
 *   throws. The error names the scenario and keeps the original error as
 *   `cause`. Scenario names and thrown messages are escaped in the text
 *   (newlines, control and bidi characters), so they cannot fake extra
 *   lines of output.
 * - `rankFn` or `mutate` returns a Promise (or any thenable). This function
 *   is synchronous; awaiting inside `rankFn`/`mutate` and passing the
 *   resolved value in is the fix — see README.md, "Async ranking functions".
 * - `rankFn` or `mutate` modified `baseInput` in place (detected by
 *   comparing against a deep copy taken before the first call). Every
 *   scenario starts from the same `baseInput`, so an in-place edit by an
 *   earlier call would corrupt every later scenario.
 * - a later `rankFn` call modified the ranking result object it returned for
 *   the baseline (for example, a rank function that clears and refills one
 *   shared output array). Undetected, this would make `baseline` and
 *   `actual` the same mutated object and always compare equal, regardless of
 *   whether payout actually changed the ranking.
 * - `isEqual` or `hasChanged` returns anything but a boolean (for example a
 *   Promise, which is always truthy and would make every scenario "pass").
 */
export function assertPayoutInvariance<TInput, TResult>(
  rankFn: (input: TInput) => TResult,
  baseInput: TInput,
  mutations: PayoutMutationScenario<TInput>[],
  opts: AssertPayoutInvarianceOptions<TInput, TResult> = {},
): PayoutInvarianceResult<TInput, TResult> {
  if (typeof rankFn !== "function") {
    throw new TypeError("assertPayoutInvariance: rankFn must be a function.");
  }
  const list = snapshotMutations<TInput>(mutations);
  const options = readRuntimeOptions(opts);
  const isEqual = (options.isEqual as ((expected: TResult, actual: TResult) => unknown) | undefined) ?? deepEqual;
  const hasChanged =
    (options.hasChanged as ((base: TInput, mutated: TInput) => unknown) | undefined) ??
    ((base: TInput, mutated: TInput) => !deepEqual(base, mutated));

  const pristineInput = snapshot(baseInput);
  const assertBaseUntouched = (who: string): void => {
    if (!deepEqual(pristineInput, baseInput)) {
      throw new Error(
        `assertPayoutInvariance: ${who} modified baseInput in place. Neither rankFn nor mutate may change ` +
          `their argument (copy before sorting or editing); every scenario starts from the same baseInput, ` +
          `so the comparison can no longer be trusted.`,
      );
    }
  };

  const callRankFn = (input: TInput, where: string): TResult => {
    let output: TResult | undefined;
    let rankError: unknown;
    let rankFailed = false;
    try {
      output = rankFn(input);
    } catch (error) {
      rankFailed = true;
      rankError = error;
    }
    if (rankFailed) {
      throw new Error(`assertPayoutInvariance: rankFn threw ${where}: ${describeError(rankError)}`, {
        cause: rankError,
      });
    }
    if (isThenable(output)) {
      throw new TypeError(
        `assertPayoutInvariance: rankFn returned a Promise (or thenable) ${where}. assertPayoutInvariance ` +
          `is synchronous and would compare two Promise objects (which are always "equal" once their own ` +
          `properties are compared), not the values they resolve to. Await rankFn yourself and pass the ` +
          `resolved value in. See README.md, "Async ranking functions".`,
      );
    }
    return output as TResult;
  };

  const checkedBoolean = (hook: string, where: string, value: unknown): boolean => {
    if (typeof value !== "boolean") {
      throw new TypeError(
        `assertPayoutInvariance: ${hook} must return a boolean, got ${
          isThenable(value) ? "a Promise (or thenable)" : value === null ? "null" : typeof value
        } ${where}.`,
      );
    }
    return value;
  };

  const baseline = callRankFn(baseInput, "on the baseline input");
  assertBaseUntouched("rankFn (on the baseline input)");
  // rankFn may return an object it later reuses (a buffer it clears and
  // refills). If a later call rewrote the baseline result in place, baseline
  // and actual would be the same object and always compare equal, so detect
  // that too.
  const baselineCopy = snapshot(baseline);

  const failures: PayoutInvarianceFailure<TInput, TResult>[] = [];
  const vacuous: string[] = [];

  for (const { name, mutate } of list) {
    const label = `scenario ${quote(name)}`;
    let mutatedInput: TInput;
    try {
      mutatedInput = mutate(baseInput);
    } catch (error) {
      throw new Error(`assertPayoutInvariance: ${label}: mutate() threw: ${describeError(error)}`, {
        cause: error,
      });
    }
    if (isThenable(mutatedInput)) {
      throw new TypeError(
        `assertPayoutInvariance: ${label}: mutate() returned a Promise (or thenable). mutate must ` +
          `be synchronous.`,
      );
    }
    assertBaseUntouched(`${label}: mutate()`);

    // Precondition guard: a mutation that changed nothing can't prove
    // invariance. Flag it instead of letting it silently count as a pass.
    if (!checkedBoolean("hasChanged", `for ${label}`, hasChanged(baseInput, mutatedInput))) {
      vacuous.push(name);
      continue;
    }

    const actual = callRankFn(
      mutatedInput,
      `on the mutated input for ${label} (it did not throw on the baseline input)`,
    );
    assertBaseUntouched(`${label}: rankFn`);
    if (!deepEqual(baselineCopy, baseline)) {
      throw new Error(
        `assertPayoutInvariance: rankFn modified its earlier (baseline) result in place during ${label}. ` +
          `Return a fresh value from every call, or the baseline can no longer be compared.`,
      );
    }

    if (!checkedBoolean("isEqual", `for ${label}`, isEqual(baseline, actual))) {
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
   * Strip single-line comments (`// ...`) and `/* ... *\/` block comments
   * before matching, so a comment that merely MENTIONS a forbidden
   * identifier doesn't count as a reference. A removed block comment leaves
   * a space behind, so `return/* x *\/commission` still shows `commission`
   * as its own word, and line numbers stay the same. String and template
   * literals on the same line are tracked so a `//` inside one (e.g.
   * `"https://example.com/payout"`) is not mistaken for the start of a line
   * comment. This is still a best-effort, line-based strip (not a real
   * parser) — see README.md "Honest limits": a string or template literal
   * that spans multiple lines is not tracked across the line break, and a
   * regular-expression literal containing `/*` or `//` (such as `/[/*]/`)
   * is mistaken for the start of a comment, which can hide the code after
   * it. Pass `false` for files like that. Must be a boolean when given.
   * Defaults to true.
   */
  stripComments?: boolean;
  /**
   * Case-insensitive matching for string identifiers (RegExp patterns are
   * used as-is; give them their own `i` flag if you want that). Defaults to
   * true, since missing a reference due to casing is worse than an
   * occasional over-match. Must be a boolean when given.
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

/** Build a word-boundary matcher regex for one plain-string identifier. */
function toMatcher(identifier: string, caseInsensitive: boolean): RegExp {
  // \b works on word characters, so this also catches identifiers embedded
  // in import specifiers like "@/lib/affiliate" (the '/' and quote around
  // it are non-word characters, so the boundary still lands correctly).
  // It will NOT catch this identifier as a fragment of a larger camelCase or
  // snake_case identifier (e.g. "payout" inside "computePayoutForCard" or
  // "payout_rate_bps") — pass a RegExp without \b (e.g. /payout/i) for that.
  const flags = "g" + (caseInsensitive ? "i" : "");
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`, flags);
}

/**
 * Strip `//` line comments and lines that are purely part of a block
 * comment, while tracking same-line single/double-quoted and template
 * string literals so a `//` or `/*` sequence inside one is not mistaken for
 * the start of a comment (e.g. a URL like `"https://host/payout"`, or a
 * `/* not a comment *\/`-looking substring inside a string). A string that
 * itself spans multiple lines (an unterminated literal, or a multi-line
 * template literal) is not tracked past the line break — this remains a
 * best-effort, line-based strip, not a real parser. A block comment is
 * replaced by one space (never by nothing), so the tokens on either side of
 * it stay separate. A regular-expression literal that contains `/*` or `//`
 * is not recognized and is treated as a comment start.
 */
function stripCommentLines(src: string): string {
  let inBlockComment = false;
  return src
    .split("\n")
    .map((rawLine) => {
      let out = "";
      let inString: string | null = null;
      let i = 0;
      while (i < rawLine.length) {
        // .charAt() always returns `string` (empty past the end), unlike
        // indexed access, which TypeScript would otherwise widen to
        // `string | undefined` under noUncheckedIndexedAccess.
        const ch = rawLine.charAt(i);
        const next = rawLine.charAt(i + 1);

        if (inBlockComment) {
          const end = rawLine.indexOf("*/", i);
          if (end === -1) return out; // rest of the line is inside the block comment
          i = end + 2;
          inBlockComment = false;
          continue;
        }

        if (inString !== null) {
          out += ch;
          if (ch === "\\" && next !== "") {
            out += next;
            i += 2;
            continue;
          }
          if (ch === inString) inString = null;
          i += 1;
          continue;
        }

        if (ch === "/" && next === "/") return out; // rest of the line is a line comment
        if (ch === "/" && next === "*") {
          // Leave a space where the comment was, so `return/* x */commission`
          // still reads as two tokens (and `pay/* x */out` does not become one).
          out += " ";
          inBlockComment = true;
          i += 2;
          continue;
        }
        if (ch === "'" || ch === '"' || ch === "`") {
          inString = ch;
          out += ch;
          i += 1;
          continue;
        }

        out += ch;
        i += 1;
      }
      return out;
    })
    .join("\n");
}

/**
 * Load Node's built-in `fs` module lazily, without a static top-level
 * `import ... from "node:fs"` anywhere in this file. A static import of a
 * Node built-in is resolved at BUNDLE time, not at call time — bundlers
 * targeting a browser or a Workers runtime (which have no `fs`) fail to
 * resolve it even for callers who never invoke the file-path mode below.
 * `process.getBuiltinModule` (Node >=20.16, >=22.3) is a plain property
 * lookup at runtime, invisible to static bundler analysis, so only callers
 * who actually reach this function need Node's `fs` to exist at all.
 */
function loadNodeFs(): typeof import("node:fs") {
  if (typeof process === "undefined" || typeof process.getBuiltinModule !== "function") {
    throw new Error(
      "assertNoPayoutImports: reading files by path requires Node's process.getBuiltinModule " +
        "(Node >=20.16.0 or >=22.3.0), which isn't available in this runtime. Pass a pre-loaded " +
        '{ path: content } map instead of an array of paths — see README.md, "Option B".',
    );
  }
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs") | undefined;
  if (!fs) {
    throw new Error(
      "assertNoPayoutImports: node:fs is not available in this runtime (not Node, or fs was " +
        'disabled). Pass a pre-loaded { path: content } map instead — see README.md, "Option B".',
    );
  }
  return fs;
}

/** Read `opts` once: undefined or a plain object whose flags are booleans or undefined. */
function readScanOptions(opts: unknown): Required<AssertNoPayoutImportsOptions> {
  if (opts === undefined) return { ...DEFAULT_OPTIONS };
  if (!isPlainRecord(opts)) throw new TypeError("assertNoPayoutImports: opts must be a plain object (or omitted).");
  const resolved = { ...DEFAULT_OPTIONS };
  for (const key of ["stripComments", "caseInsensitive"] as const) {
    const value = opts[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") throw new TypeError(`assertNoPayoutImports: opts.${key} must be a boolean (or omitted).`);
    resolved[key] = value;
  }
  return resolved;
}

/** Validate every identifier with one indexed pass and build its matcher. */
function readMatchers(payoutIdentifiers: unknown, caseInsensitive: boolean): { label: string; regex: RegExp }[] {
  if (!Array.isArray(payoutIdentifiers)) {
    throw new TypeError("assertNoPayoutImports: payoutIdentifiers must be an array of strings and/or RegExps.");
  }
  const length = payoutIdentifiers.length;
  if (length === 0) {
    throw new TypeError(
      "assertNoPayoutImports: payoutIdentifiers is empty, so nothing would be matched. Pass at least one identifier.",
    );
  }
  const matchers: { label: string; regex: RegExp }[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!hasOwn(payoutIdentifiers, index)) {
      throw new TypeError(`assertNoPayoutImports: payoutIdentifiers[${index}] is missing (a hole in a sparse array).`);
    }
    const identifier: unknown = payoutIdentifiers[index];
    if (typeof identifier === "string") {
      if (isBlank(identifier)) {
        throw new TypeError(
          `assertNoPayoutImports: payoutIdentifiers[${index}] is blank (only whitespace or invisible characters).`,
        );
      }
      matchers.push({ label: identifier, regex: toMatcher(identifier, caseInsensitive) });
    } else if (typeof identifier === "object" && identifier !== null && kindOf(identifier) === "RegExp") {
      // Read through the RegExp's internal slots, not its own `source`/`flags`.
      const { source, flags } = regExpParts(identifier);
      matchers.push({ label: source, regex: new RegExp(source, flags.includes("g") ? flags : flags + "g") });
    } else {
      throw new TypeError(`assertNoPayoutImports: payoutIdentifiers[${index}] must be a string or a RegExp.`);
    }
  }
  return matchers;
}

/**
 * Validate `files` and return `[path, content]` pairs, read once. Only the
 * path-list form touches the filesystem, and only after validation.
 */
function readSourceFiles(files: unknown): [string, string][] {
  const empty = "assertNoPayoutImports: files is empty, so nothing would be scanned. Pass at least one file.";
  if (Array.isArray(files)) {
    const length = files.length;
    if (length === 0) throw new TypeError(empty);
    const paths: string[] = [];
    for (let index = 0; index < length; index += 1) {
      if (!hasOwn(files, index)) {
        throw new TypeError(`assertNoPayoutImports: files[${index}] is missing (a hole in a sparse array).`);
      }
      const path: unknown = files[index];
      if (typeof path !== "string" || isBlank(path)) {
        throw new TypeError(`assertNoPayoutImports: files[${index}] must be a non-blank path string.`);
      }
      paths.push(path);
    }
    const { readFileSync } = loadNodeFs();
    return paths.map((path) => [path, readFileSync(path, "utf8")]);
  }
  if (!isPlainRecord(files)) {
    throw new TypeError(
      "assertNoPayoutImports: files must be an array of paths or a plain { path: content } object.",
    );
  }
  const entries = Object.entries(files);
  if (entries.length === 0) throw new TypeError(empty);
  for (const [path, content] of entries) {
    if (typeof content !== "string") {
      throw new TypeError(`assertNoPayoutImports: files[${quote(path)}] must be a string of file content.`);
    }
  }
  return entries as [string, string][];
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
 *
 * This is a text-pattern grep, not a type checker or bundler: it cannot see
 * indirect dependence (a value smuggled through a generically-named field),
 * closures that capture a payout value without naming it in the scanned
 * file, computed/dynamic property access (`obj["pay" + "out"]`), a `payout`
 * re-exported under an aliased name, or a `require`/`import()` built from a
 * runtime string. It also will not catch a forbidden word embedded inside a
 * larger identifier with no delimiter (see `toMatcher`). See README.md,
 * "Honest limits", for the full list — an empty result is a signal, not a
 * guarantee.
 *
 * Throws a TypeError, before reading any file, when the scan could not
 * mean anything: `files` is empty, is neither an array of non-blank path
 * strings nor a plain `{ path: content }` object, has a hole, or has a
 * non-string content; `payoutIdentifiers` is empty, has a hole, or has an
 * entry that is a blank string (only whitespace or invisible characters)
 * or neither a string nor a real `RegExp`; or `opts` is not a plain object
 * with boolean flags. A missing file in path-list mode throws the error
 * from Node's `fs`.
 */
export function assertNoPayoutImports(
  files: SourceFiles,
  payoutIdentifiers: (string | RegExp)[],
  opts: AssertNoPayoutImportsOptions = {},
): PayoutImportOffense[] {
  const { stripComments, caseInsensitive } = readScanOptions(opts);
  const matchers = readMatchers(payoutIdentifiers, caseInsensitive);
  const sources = readSourceFiles(files);

  const offenses: PayoutImportOffense[] = [];

  for (const [path, rawContent] of sources) {
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
