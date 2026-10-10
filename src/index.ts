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
import type { DeepEqualOptions } from "./deepEqual.js";
import { snapshot } from "./snapshot.js";

export { deepEqual };
export type { DeepEqualOptions };

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

/** Optional hooks for `assertPayoutInvariance`. Pass a plain object; both hooks must be synchronous. */
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
  /**
   * Make the order of a `Map`'s entries, a `Set`'s members and an object's
   * own enumerable keys significant. Defaults to false: those three are
   * compared without regard to order, so a ranker that returns its ranking
   * as a `Set`, a `Map` or a keyed object can reorder it without failing the
   * check. If your ranker returns one of those in rank order, pass
   * `orderSensitive: true` or return an array (array order always matters).
   * Applies to the default `isEqual`, the default `hasChanged` and the
   * in-place-change checks; a custom `isEqual` or `hasChanged` decides for
   * itself. Must be a boolean when given.
   */
  orderSensitive?: boolean;
}

/** One scenario whose ranking result differed from the baseline. */
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

/** What `assertPayoutInvariance` returns when it could run every scenario. */
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
function readRuntimeOptions(opts: unknown): { isEqual: Hook; hasChanged: Hook; orderSensitive: boolean } {
  if (opts === undefined) return { isEqual: undefined, hasChanged: undefined, orderSensitive: false };
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
  const orderSensitive = opts.orderSensitive;
  if (orderSensitive !== undefined && typeof orderSensitive !== "boolean") {
    throw new TypeError("assertPayoutInvariance: opts.orderSensitive must be a boolean (or omitted).");
  }
  return { isEqual: isEqual as Hook, hasChanged: hasChanged as Hook, orderSensitive: orderSensitive === true };
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
 * - `rankFn` returns `undefined` on the baseline input (almost always a
 *   forgotten `return`). `null` and `NaN` are accepted as ordinary values; a
 *   later call that returns `undefined` is reported as a failure.
 *
 * The default comparison ignores the order of a `Map`'s entries, a `Set`'s
 * members and an object's keys. If the ranker returns one of those in rank
 * order, pass `{ orderSensitive: true }` or return an array.
 */
export function assertPayoutInvariance<TInput, TResult>(
  rankFn: (input: TInput) => TResult,
  baseInput: TInput,
  mutations: PayoutMutationScenario<TInput>[],
  opts?: AssertPayoutInvarianceOptions<TInput, TResult>,
): PayoutInvarianceResult<TInput, TResult> {
  if (typeof rankFn !== "function") {
    throw new TypeError("assertPayoutInvariance: rankFn must be a function.");
  }
  const list = snapshotMutations<TInput>(mutations);
  const options = readRuntimeOptions(opts);
  const sameValue = (x: unknown, y: unknown): boolean => deepEqual(x, y, { orderSensitive: options.orderSensitive });
  const isEqual = (options.isEqual as ((expected: TResult, actual: TResult) => unknown) | undefined) ?? sameValue;
  const hasChanged =
    (options.hasChanged as ((base: TInput, mutated: TInput) => unknown) | undefined) ??
    ((base: TInput, mutated: TInput) => !sameValue(base, mutated));

  const pristineInput = snapshot(baseInput);
  const assertBaseUntouched = (who: string): void => {
    if (!sameValue(pristineInput, baseInput)) {
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
          `is synchronous and would compare two Promise objects, not the values they resolve to (and each ` +
          `Promise is equal only to itself, since its state cannot be read). Await rankFn yourself and pass ` +
          `the resolved value in. See README.md, "Async ranking functions".`,
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
  if (baseline === undefined) {
    throw new TypeError(
      "assertPayoutInvariance: rankFn returned undefined on the baseline input. That is almost always a " +
        "forgotten `return`, and a ranker that always returns undefined would pass every scenario. Return " +
        "the ranking (an empty array for an empty ranking).",
    );
  }
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
    if (!sameValue(baselineCopy, baseline)) {
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

/** Options for `assertNoPayoutImports`. Pass a plain object with boolean flags. */
export interface AssertNoPayoutImportsOptions {
  /**
   * Strip single-line comments (`// ...`) and `/* ... *\/` block comments
   * before matching, so a comment that merely MENTIONS a forbidden
   * identifier doesn't count as a reference. A removed block comment leaves
   * a space behind, so `return/* x *\/commission` still shows `commission`
   * as its own word, and line numbers stay the same. Strings, template
   * literals (across lines, including nested `${ }` expressions) and regex
   * literals are skipped, so a `//` or `/*` inside one (e.g.
   * `"https://example.com/payout"`, or `rm -rf dist/*` in a template) is not
   * mistaken for a comment. A `//` comment ends at `\n`, `\r`, U+2028 or
   * U+2029. JSX closing and self-closing tags and `i++ / 2` are not read as
   * regex starts. This is a small lexer, not a parser; see README.md "Honest
   * limits": a regex literal right after `)` or `]` is read as division, a
   * lone backtick in JSX text opens a template that never closes, and JSX
   * text is not tokenized; after any of these, a `/*` or `//` can hide the
   * code that follows. Pass `false` for files like that. Must be a boolean
   * when given. Defaults to true.
   */
  stripComments?: boolean;
  /**
   * Case-insensitive matching for string identifiers, in any script (RegExp
   * patterns are used as written; give them their own `i` flag if you want
   * that). Defaults to true, since missing a reference due to casing is
   * worse than an occasional over-match. Must be a boolean when given.
   */
  caseInsensitive?: boolean;
}

/** One scanned file that references a forbidden identifier, with every matching line. */
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

/** Characters that continue an identifier: letters, decimal and letter-like digits, combining marks, `_`. */
const IDENTIFIER_CHARS = "\\p{L}\\p{Nd}\\p{Nl}\\p{M}_";
/**
 * Scripts written without spaces between words. Text in them runs straight
 * into an embedded Latin word (`查看payout报表`, `payout을`), so next to an
 * identifier that starts or ends with an ASCII character they do not count
 * as part of the same word.
 */
const UNSPACED_SCRIPTS = "\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Hangul}";
const STARTS_WITH_ASCII_WORD_CHAR = /^[A-Za-z0-9_]/;
const ENDS_WITH_ASCII_WORD_CHAR = /[A-Za-z0-9_]$/;
const STARTS_WITH_IDENTIFIER_CHAR = new RegExp(`^[${IDENTIFIER_CHARS}]`, "u");
const ENDS_WITH_IDENTIFIER_CHAR = new RegExp(`[${IDENTIFIER_CHARS}]$`, "u");

/**
 * Build a matcher regex for one plain-string identifier.
 *
 * Word boundaries are Unicode-aware lookarounds, not `\b` (which only knows
 * ASCII letters, digits and `_`): the identifier must not be directly
 * preceded or followed by a letter, digit, combining mark or `_` in any
 * script. So "комиссия" and "佣金" are found, and "commission" is not found
 * inside "commissionés". A boundary is only required on a side where the
 * identifier itself starts or ends with such a character, so "$payout",
 * "@payout/core" and "rate%" are found too. `$` does not continue an
 * identifier here, so "payout" is still found in a Svelte-style `$payout`.
 * Characters like `²` and `½` are not identifier characters either. On an
 * ASCII edge, Han, kana and Hangul neighbors do not count as part of the word
 * (see UNSPACED_SCRIPTS); a non-ASCII identifier edge is strict, so "佣金" is
 * not found inside "佣金率". It will NOT catch this identifier as a fragment
 * of a larger camelCase or snake_case identifier (e.g. "payout" inside
 * "computePayoutForCard" or "payout_rate_bps"); pass a RegExp without a
 * boundary (e.g. /payout/i) for that.
 */
function toMatcher(identifier: string, caseInsensitive: boolean): RegExp {
  const startsWord = STARTS_WITH_IDENTIFIER_CHAR.test(identifier);
  const endsWord = ENDS_WITH_IDENTIFIER_CHAR.test(identifier);
  const word = (ascii: boolean): string => (ascii ? `(?![${UNSPACED_SCRIPTS}])[${IDENTIFIER_CHARS}]` : `[${IDENTIFIER_CHARS}]`);
  const before = startsWord ? `(?<!${word(STARTS_WITH_ASCII_WORD_CHAR.test(identifier))})` : "";
  const after = endsWord ? `(?!${word(ENDS_WITH_ASCII_WORD_CHAR.test(identifier))})` : "";
  return new RegExp(`${before}${escapeRegExp(identifier)}${after}`, "gu" + (caseInsensitive ? "i" : ""));
}

/** Leading and trailing whitespace and invisible (default-ignorable) characters of an identifier. */
const IDENTIFIER_PADDING = /^[\s\p{Default_Ignorable_Code_Point}]+|[\s\p{Default_Ignorable_Code_Point}]+$/gu;

/** Keywords after which a `/` starts a regular expression, not a division. */
const REGEX_AFTER_KEYWORD = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/** Punctuators after which a `/` starts a regular expression, not a division. */
const REGEX_AFTER_PUNCTUATOR = new Set([..."(,=:[!&|?{};+-*%<>~^}"]);

/** Keywords directly followed by a statement block (`else {`, `catch {`, `static {`). */
const BLOCK_AFTER_KEYWORD = new Set(["else", "try", "finally", "do", "catch", "static"]);

/** Keywords that start a declaration or clause whose `{` opens a body (a class body, a case block). */
const BLOCK_CUE_KEYWORD = new Set(["class", "interface", "enum", "namespace", "module", "case", "default"]);

/** The line terminators of JavaScript: LF, CR, U+2028 and U+2029. A `//` comment ends at any of them. */
function isLineTerminator(ch: string): boolean {
  return ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";
}

function isWordChar(ch: string): boolean {
  return /[\p{ID_Continue}$]/u.test(ch);
}

/** Index of the first line terminator at or after `from`, or the end of `src`. */
function endOfLine(src: string, from: number): number {
  for (let j = from; j < src.length; j += 1) {
    if (isLineTerminator(src.charAt(j))) return j;
  }
  return src.length;
}

/** Index just past a quoted string that starts at `start`, or of the line break that ends it unterminated. */
function endOfQuoted(src: string, start: number, quote: string): number {
  let j = start + 1;
  while (j < src.length) {
    const ch = src.charAt(j);
    if (ch === "\\") {
      // An escape, including a line continuation (a CRLF counts as one).
      j += src.charAt(j + 1) === "\r" && src.charAt(j + 2) === "\n" ? 3 : 2;
      continue;
    }
    if (ch === quote) return j + 1;
    if (ch === "\n" || ch === "\r") return j;
    j += 1;
  }
  return src.length;
}

/** Index just past a regex literal that starts at `start`, or of the line break that ends it unterminated. */
function endOfRegex(src: string, start: number): number {
  let inClass = false;
  let j = start + 1;
  while (j < src.length) {
    const ch = src.charAt(j);
    if (isLineTerminator(ch)) return j;
    if (ch === "\\") {
      if (isLineTerminator(src.charAt(j + 1))) return j + 1;
      j += 2;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return j + 1;
    j += 1;
  }
  return src.length;
}

/** A JSX closing tag, from its `/` on: `/div>`, `/>`, `/Ui.Card >`, `/svg:g>`. */
const closingTag = /\/\s*(?:[\p{ID_Start}_$][\p{ID_Continue}$.:-]*\s*)?>/uy;

/**
 * Whether JSX tag rules apply to a file: always in `.jsx` and `.tsx`, never in
 * `.ts`, `.mts` and `.cts` (TypeScript has no JSX there), and in any other
 * file (`.js`, `.svelte`, a name with no extension) only after a JSX opener
 * such as `<Foo` or `<>` has been seen in a place where an expression can start.
 */
type JsxMode = "always" | "never" | "auto";

function jsxModeFor(path: string): JsxMode {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  if (extension === "jsx" || extension === "tsx") return "always";
  if (extension === "ts" || extension === "mts" || extension === "cts") return "never";
  return "auto";
}

/** An open template literal, or a `${ }` expression inside one (with the `{` opened inside it). */
type LexFrame = { kind: "template" } | { kind: "expression"; braces: number };

/**
 * Remove `//` line comments and block comments, keeping everything else,
 * including every line break, so line numbers do not move. A small lexer, not
 * a parser: it skips single- and double-quoted strings (which end at a line
 * break), template literals across lines (including nested `${ }`
 * expressions, with brace depth tracked, and the strings, templates and
 * comments inside them), and regular-expression literals, so a `//` or `/*`
 * inside any of those is not mistaken for a comment. A line comment ends at
 * any JavaScript line terminator (`\n`, `\r`, U+2028 or U+2029). A block
 * comment is replaced by one space (never by nothing), so the tokens on either
 * side of it stay separate.
 *
 * Whether a `/` starts a regex literal or is a division (or part of JSX) is
 * guessed from the code before it:
 * - at the start of the file, after a keyword such as `return`, or after an
 *   operator or opening bracket, it starts a regex;
 * - right after `<` it is part of a closing tag only when a tag name (or
 *   nothing) and `>` follow (`</div>`, `</>`, `</Ui.Card>`); otherwise
 *   (`a</[/*]/.test(b)`, or `a < /re/` with a space) it starts a regex;
 * - after a `}` it starts a regex when the brace closed a statement block
 *   (`if (x) {...}`, `else {...}`, an arrow body, a bare block) and divides
 *   when it closed an object literal or JSX expression (`{a} / {b}`,
 *   `{} /= 2`); a `/` followed by `>` after any `}` is a self-closing tag
 *   (`<Foo {...p} />`);
 * - after `>` it does not start a regex when the next character is `>`
 *   (`<Foo<T> />`) unless a line break came first;
 * - after `++` or `--` it divides when the operator is postfix (`i++ / 2`,
 *   `a[0]-- / 2`, judged by what precedes it) and starts a regex when it is
 *   prefix (`++/re/.lastIndex`); after a single `+` or `-` it starts a regex.
 *
 * Known limits: a regex literal right after `)` or `]` (`if (ok) /re/`) is
 * read as division, JSX text is not tokenized (a `//` in it starts a
 * comment), and a lone backtick in
 * JSX text opens a template literal that never closes. Either can
 * desynchronize the lexer, and a later `/*` can then hide the code after it.
 */
function removeComments(src: string, jsxMode: JsxMode): string {
  const frames: LexFrame[] = [];
  let out = "";
  let prev = ""; // last significant code character ("" at the start of the file)
  let prevIndex = -1; // where `prev` is in `src`, or -1 when it ends a string, template or regex
  let lineBreak = false; // a line terminator came after `prev`
  let word = ""; // the identifier or keyword that ends at `prev`
  const braces: boolean[] = []; // for each open `{` in code: true when it opens a statement block
  let closedBlock = true; // whether the `}` that is `prev` closed a statement block
  let blockCue = false; // `class`, `case` or similar was read in this statement, so the next `{` is a body
  let jsxSeen = false; // a JSX opener (`<Foo`, `<>`) was read
  const jsxOn = (): boolean => jsxMode === "always" || (jsxMode === "auto" && jsxSeen);
  let i = 0;

  /** True when the code before the current character is one after which an expression can start. */
  const startsExpression = (): boolean =>
    prev === "" || (isWordChar(prev) ? REGEX_AFTER_KEYWORD.has(word) : REGEX_AFTER_PUNCTUATOR.has(prev));

  /** True when the `{` being read opens a statement block (`if (x) {`), false for an object literal or JSX expression. */
  const opensBlock = (): boolean => {
    if (blockCue || prev === "") return true;
    if (isWordChar(prev)) return BLOCK_AFTER_KEYWORD.has(word);
    switch (prev) {
      case ")":
      case ";":
        return true;
      case "}":
        return closedBlock; // `} {` after a block is a block; `{a}{b}` in JSX is not
      case "{":
        return braces.at(-1) ?? true; // directly inside a block is a block; inside an object it is an object
      case ">":
        return src.charAt(prevIndex - 1) === "="; // `=> {` is a body, `<p>{` is a JSX expression
      case ":":
        return isLabel(prevIndex); // `outer: {` is a labeled block, `a: {` is an object property
      default:
        return false;
    }
  };

  /** True when the `:` at `colon` ends a statement label (`outer:`) rather than a property name or a ternary branch. */
  const isLabel = (colon: number): boolean => {
    let j = colon - 1;
    while (j >= 0 && /\s/.test(src.charAt(j))) j -= 1;
    const labelEnd = j;
    while (j >= 0 && isWordChar(src.charAt(j))) j -= 1;
    if (j === labelEnd) return false;
    while (j >= 0 && /\s/.test(src.charAt(j))) j -= 1;
    const before = j >= 0 ? src.charAt(j) : "";
    if (before === "" || before === ";" || before === "}") return true;
    return before === "{" && (braces.at(-1) ?? true); // a label is the first thing in a block; a property is the first thing in an object
  };

  /** True when the `++` or `--` that ends at `prev` is postfix (`i++`, `a[0]--`), judged by what precedes it. */
  const isPostfixStep = (): boolean => {
    let j = prevIndex - 2;
    while (j >= 0 && /\s/.test(src.charAt(j))) j -= 1;
    const before = j >= 0 ? src.charAt(j) : "";
    return before === ")" || before === "]" || (before !== "" && isWordChar(before));
  };

  /** True when a `/` at index `at` starts a regex literal rather than dividing. */
  const startsRegex = (at: number): boolean => {
    if (prev === "") return true;
    if (isWordChar(prev)) return REGEX_AFTER_KEYWORD.has(word);
    if (!REGEX_AFTER_PUNCTUATOR.has(prev)) return false;
    switch (prev) {
      case "<": {
        // `</div>`, `</>` and `</a.b>` close a JSX tag. Anything else after `</` is a regex.
        if (!jsxOn() || prevIndex !== at - 1) return true;
        closingTag.lastIndex = at;
        return !closingTag.test(src);
      }
      case "}":
        if (jsxOn() && src.charAt(at + 1) === ">") return false; // `<Foo {...p} />`
        return closedBlock; // after a statement block a slash starts a regex; after an expression it divides
      case ">":
        if (!jsxOn() || src.charAt(prevIndex - 1) === "=") return true; // `x => />/.test(s)`
        return src.charAt(at + 1) !== ">" || lineBreak; // `<Foo<T> />`
      case "+":
      case "-":
        return !(prevIndex > 0 && src.charAt(prevIndex - 1) === prev && isPostfixStep()); // `i++ / 2` divides
      default:
        return true;
    }
  };

  while (i < src.length) {
    const ch = src.charAt(i);
    const frame = frames.at(-1);

    if (frame?.kind === "template") {
      if (ch === "\\") {
        out += src.slice(i, i + 2);
        i += 2;
      } else if (ch === "`") {
        frames.pop();
        out += ch;
        prev = ch;
        prevIndex = -1;
        lineBreak = false;
        i += 1;
      } else if (ch === "$" && src.charAt(i + 1) === "{") {
        frames.push({ kind: "expression", braces: 0 });
        out += "${";
        prev = "{";
        prevIndex = -1;
        lineBreak = false;
        i += 2;
      } else {
        out += ch;
        i += 1;
      }
      continue;
    }

    const next = src.charAt(i + 1);
    if (ch === "/" && next === "/") {
      i = endOfLine(src, i); // keep the line break itself
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end;
      // Leave a space where the comment was, so `return/* x */commission`
      // still reads as two tokens (and `pay/* x */out` does not become one),
      // plus the comment's own line breaks.
      const inside = src.slice(i + 2, stop);
      if (/[\n\r\u2028\u2029]/.test(inside)) lineBreak = true;
      out += " " + inside.replace(/[^\r\n]/g, "");
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = endOfQuoted(src, i, ch);
      out += src.slice(i, end);
      prev = ch;
      prevIndex = -1;
      lineBreak = false;
      i = end;
      continue;
    }
    if (ch === "`") {
      frames.push({ kind: "template" });
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && startsRegex(i)) {
      const end = endOfRegex(src, i);
      out += src.slice(i, end);
      prev = ")"; // a `/` right after a regex literal divides
      prevIndex = -1;
      lineBreak = false;
      i = end;
      continue;
    }
    if (frame?.kind === "expression") {
      if (ch === "{") {
        frame.braces += 1;
      } else if (ch === "}") {
        if (frame.braces === 0) {
          frames.pop(); // back inside the template
          out += ch;
          i += 1;
          continue;
        }
        frame.braces -= 1;
      }
    }
    if (!/\s/.test(ch)) {
      if (ch === "{") {
        braces.push(opensBlock());
        blockCue = false;
      } else if (ch === "}") {
        closedBlock = braces.pop() ?? true;
        blockCue = false;
      } else if (ch === ";" || ch === "=") {
        blockCue = false;
      } else if (ch === "<" && jsxMode !== "never" && startsExpression() && /[\p{ID_Start}$_>]/u.test(src.charAt(i + 1))) {
        jsxSeen = true; // `<Foo` or `<>` where an expression can start: JSX
      }
      word = isWordChar(ch) ? (isWordChar(src.charAt(i - 1)) ? word + ch : ch) : "";
      if (isWordChar(ch) && !isWordChar(src.charAt(i + 1)) && BLOCK_CUE_KEYWORD.has(word)) blockCue = true;
      prev = ch;
      prevIndex = i;
      lineBreak = false;
    } else if (isLineTerminator(ch)) {
      lineBreak = true;
    }
    out += ch;
    i += 1;
  }
  return out;
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
      const trimmed = identifier.replace(IDENTIFIER_PADDING, "");
      if (trimmed === "") {
        throw new TypeError(
          `assertNoPayoutImports: payoutIdentifiers[${index}] is blank (only whitespace or invisible characters).`,
        );
      }
      matchers.push({ label: trimmed, regex: toMatcher(trimmed, caseInsensitive) });
    } else if (typeof identifier === "object" && identifier !== null && kindOf(identifier) === "RegExp") {
      // Read through the RegExp's internal slots, not its own `source`/`flags`.
      // The pattern runs over the whole file (see `findMatches`): `g` makes it
      // find every match, `m` keeps `^` and `$` meaning line start and end, and
      // a sticky `y` would only match at one position, so it is dropped.
      const { source, flags } = regExpParts(identifier);
      const scanFlags = [...new Set([...flags.replace("y", ""), "g", "m"])].join("");
      matchers.push({ label: source, regex: new RegExp(source, scanFlags) });
    } else {
      throw new TypeError(`assertNoPayoutImports: payoutIdentifiers[${index}] must be a string or a RegExp.`);
    }
  }
  return matchers;
}

/** The text and start offset of every line of `content` (lines end at LF, CRLF or a lone CR). */
function splitLines(content: string): { text: string; start: number }[] {
  const lines: { text: string; start: number }[] = [];
  const terminator = /\r\n|\r|\n/g;
  let start = 0;
  for (let found = terminator.exec(content); found !== null; found = terminator.exec(content)) {
    lines.push({ text: content.slice(start, found.index), start });
    start = found.index + found[0].length;
  }
  lines.push({ text: content.slice(start), start });
  return lines;
}

/**
 * Run every matcher over the whole content (so a pattern may span lines) and
 * report each line where a match starts, once per matcher, in line order.
 */
function findMatches(content: string, matchers: { label: string; regex: RegExp }[]): PayoutImportOffense["matches"] {
  const lines = splitLines(content);
  const found: { line: number; order: number; match: PayoutImportOffense["matches"][number] }[] = [];
  matchers.forEach(({ label, regex }, order) => {
    regex.lastIndex = 0;
    let lineIndex = 0;
    let reported = -1;
    for (let hit = regex.exec(content); hit !== null; hit = regex.exec(content)) {
      if (hit[0] === "") {
        // An empty match must not loop forever. In a Unicode pattern, step over a whole
        // code point: stopping inside a surrogate pair makes the next search back up.
        const unicode = regex.flags.includes("u") || regex.flags.includes("v");
        regex.lastIndex += unicode && (content.codePointAt(regex.lastIndex) ?? 0) > 0xffff ? 2 : 1;
      }
      while (lineIndex + 1 < lines.length && (lines[lineIndex + 1]?.start ?? Infinity) <= hit.index) lineIndex += 1;
      if (lineIndex === reported) continue;
      reported = lineIndex;
      found.push({
        line: lineIndex + 1,
        order,
        match: { identifier: label, line: lineIndex + 1, text: (lines[lineIndex]?.text ?? "").trim() },
      });
    }
  });
  found.sort((x, y) => x.line - y.line || x.order - y.order);
  return found.map((entry) => entry.match);
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
 * `payoutIdentifiers` is a list of plain identifiers (trimmed, then matched
 * as whole words / import-path segments with Unicode-aware boundaries, e.g.
 * `"commission"`, `"affiliateRate"`, `"payout"`, `"комиссия"`) and/or regular
 * expressions for more specific patterns. A RegExp runs over the whole file
 * (with `g` and `m` added and `y` dropped) and is reported at the line where
 * each match starts.
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
  opts?: AssertNoPayoutImportsOptions,
): PayoutImportOffense[] {
  const { stripComments, caseInsensitive } = readScanOptions(opts);
  const matchers = readMatchers(payoutIdentifiers, caseInsensitive);
  const sources = readSourceFiles(files);

  const offenses: PayoutImportOffense[] = [];

  for (const [path, rawContent] of sources) {
    const content = stripComments ? removeComments(rawContent, jsxModeFor(path)) : rawContent;
    const matches = findMatches(content, matchers);

    if (matches.length > 0) {
      offenses.push({ file: path, matches });
    }
  }

  return offenses;
}
