/**
 * Regressions for the 2026-09-28 audit findings (PIK-001..005) and the
 * bug-class sweep. Most of these failed on 0.1.1; the rest pin behavior
 * that the fixes must keep (real in-place edits still detected, line
 * numbers, the documented regex-literal limit, ordinary clean scans).
 */
import { describe, expect, it } from "vitest";

import { assertNoPayoutImports, assertPayoutInvariance } from "../src/index";
import type { PayoutMutationScenario } from "../src/index";

interface Input {
  payout: number;
  items?: Uint8Array & { label?: string };
}

const bump: PayoutMutationScenario<Input> = { name: "payout rises", mutate: (input) => ({ ...input, payout: 100 }) };

describe("assertPayoutInvariance: comparator and snapshot (PIK-001, PIK-004)", () => {
  it("does not pass a ranker whose fresh, masked Map output depends on payout (R08)", () => {
    const rank = (input: Input): Map<string, number> => {
      const out = new Map([["rank", input.payout]]);
      Object.defineProperty(out, Symbol.toStringTag, { value: undefined, enumerable: true });
      return out;
    };
    const result = assertPayoutInvariance(rank, { payout: 0 }, [bump]);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.vacuous).toEqual([]);
  });

  it("does not accuse a ranker that only reads an annotated typed array (R07)", () => {
    const items = Object.assign(new Uint8Array([1, 2]), { label: "quality" });
    const rank = (input: Input): number => input.items?.[0] ?? 0;
    const result = assertPayoutInvariance(rank, { payout: 0, items }, [bump]);
    expect(result.passed).toBe(true);
  });

  it("still detects a ranker that changes the annotated typed array in place", () => {
    const items = Object.assign(new Uint8Array([1, 2]), { label: "quality" });
    const rank = (input: Input): number => {
      if (input.items) input.items.label = "changed";
      return 0;
    };
    expect(() => assertPayoutInvariance(rank, { payout: 0, items }, [bump])).toThrow(/modified baseInput in place/);
  });
});

describe("assertPayoutInvariance: one dense, validated scenario snapshot (bug class 1 and 2)", () => {
  it("runs every scenario even when the array's Symbol.iterator is overridden", () => {
    const seen: number[] = [];
    const mutations = [bump];
    Object.defineProperty(mutations, Symbol.iterator, { value: function* () {} });
    const result = assertPayoutInvariance(
      (input: Input) => {
        seen.push(input.payout);
        return input.payout;
      },
      { payout: 0 },
      mutations,
    );
    expect(seen).toEqual([0, 100]);
    expect(result.passed).toBe(false);
  });

  it("rejects a sparse mutations array before rankFn runs", () => {
    let calls = 0;
    const rank = (): number => (calls += 1);
    const sparse = new Array<PayoutMutationScenario<Input>>(1);
    expect(() => assertPayoutInvariance(rank, { payout: 0 }, sparse)).toThrow(TypeError);
    expect(() => assertPayoutInvariance(rank, { payout: 0 }, sparse)).toThrow(/mutations\[0\] is missing \(a hole/);
    const late = [bump, bump];
    Reflect.deleteProperty(late, 1);
    expect(() => assertPayoutInvariance(rank, { payout: 0 }, late)).toThrow(/mutations\[1\] is missing/);
    expect(calls).toBe(0);
  });

  it("reads each scenario's name and mutate once, before rankFn runs", () => {
    let reads = 0;
    const scenario = {
      get name(): string {
        reads += 1;
        return "payout rises";
      },
      get mutate(): (input: Input) => Input {
        reads += 1;
        return reads > 2 ? () => ({ payout: 0 }) : (input: Input) => ({ ...input, payout: 100 });
      },
    };
    const result = assertPayoutInvariance((input: Input) => input.payout, { payout: 0 }, [scenario]);
    expect(reads).toBe(2);
    expect(result.passed).toBe(false);
  });

  it("does not use an inherited element to fill a hole", () => {
    const sparse = new Array<PayoutMutationScenario<Input>>(1);
    Object.setPrototypeOf(sparse, Object.assign(Object.create(Array.prototype) as object, { 0: bump }));
    expect(() => assertPayoutInvariance((input: Input) => input.payout, { payout: 0 }, sparse)).toThrow(/is missing/);
  });
});

describe("assertPayoutInvariance: options (bug class 6 and 9)", () => {
  const rank = (input: Input): number => input.payout;

  it("rejects options that are not a plain object, before rankFn runs", () => {
    let calls = 0;
    const counted = (input: Input): number => {
      calls += 1;
      return input.payout;
    };
    for (const opts of [null, new Map(), [], "x", new Date()]) {
      expect(() => assertPayoutInvariance(counted, { payout: 0 }, [bump], opts as never)).toThrow(
        /opts must be a plain object/,
      );
    }
    expect(calls).toBe(0);
    expect(assertPayoutInvariance(rank, { payout: 0 }, [bump], Object.create(null) as object).passed).toBe(false);
  });

  it("rejects isEqual or hasChanged that are not functions, before rankFn runs", () => {
    expect(() => assertPayoutInvariance(rank, { payout: 0 }, [bump], { isEqual: true as never })).toThrow(
      /opts.isEqual must be a function/,
    );
    expect(() => assertPayoutInvariance(rank, { payout: 0 }, [bump], { hasChanged: "no" as never })).toThrow(
      /opts.hasChanged must be a function/,
    );
    expect(assertPayoutInvariance(rank, { payout: 0 }, [bump], { isEqual: undefined }).passed).toBe(false);
  });
});

describe("assertPayoutInvariance: error text built from caller strings (bug class 3 and 8)", () => {
  it("escapes newlines, control and bidi characters in scenario names inside error messages", () => {
    const name = "line\nFAKE: passed\u001b[2J\u202Eevil";
    const throwing = { name, mutate: (): Input => { throw new Error("boom\nsecond line"); } };
    let message = "";
    try {
      assertPayoutInvariance((input: Input) => input.payout, { payout: 0 }, [throwing]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(String.raw`"line\nFAKE: passed\u001b[2J\u202eevil"`);
    expect(message).toContain(String.raw`boom\nsecond line`);
    for (const raw of ["\n", "\u001b", "\u202E"]) expect(message).not.toContain(raw);
  });

  it("keeps its own message when a thrown value cannot be printed", () => {
    const unprintable = { message: { toString: (): string => { throw new Error("no"); } } };
    const error = Object.assign(new Error("x"), unprintable);
    const rank = (): number => {
      throw error;
    };
    expect(() => assertPayoutInvariance(rank, { payout: 0 }, [bump])).toThrow(
      /rankFn threw on the baseline input: \(unprintable thrown value\)/,
    );
    const nullProto = Object.create(null) as object;
    expect(() =>
      assertPayoutInvariance(
        () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error thrown value is the case under test
          throw nullProto;
        },
        { payout: 0 },
        [bump],
      ),
    ).toThrow(/\(unprintable thrown value\)/);
  });
});

describe("assertNoPayoutImports: comment stripping keeps token boundaries (PIK-002)", () => {
  it("finds an identifier glued to an inline block comment (R05)", () => {
    const files = { "rank.ts": "export default function () { return/* divider */commission; }" };
    expect(assertNoPayoutImports(files, ["commission"])).toEqual([
      { file: "rank.ts", matches: [{ identifier: "commission", line: 1, text: "export default function () { return commission; }" }] },
    ]);
  });

  it("does not glue the tokens on either side of a block comment into a new word", () => {
    expect(assertNoPayoutImports({ "a.ts": "const x = pay/* split */out;" }, ["payout"])).toEqual([]);
  });

  it("keeps line numbers across a multi-line block comment that ends mid-line", () => {
    const files = { "a.ts": "const a = 1;/* start\nmiddle commission mention\nend */commission();" };
    expect(assertNoPayoutImports(files, ["commission"])).toEqual([
      { file: "a.ts", matches: [{ identifier: "commission", line: 3, text: "commission();" }] },
    ]);
  });

  it("documents the regex-literal limit (R06): /[/*]/ opens a comment unless stripComments is false", () => {
    const files = { "a.ts": "const re = /[/*]/;\nconst x = commission;\n// */" };
    expect(assertNoPayoutImports(files, ["commission"])).toEqual([]);
    expect(assertNoPayoutImports(files, ["commission"], { stripComments: false })).toHaveLength(1);
  });
});

describe("assertNoPayoutImports: an empty or malformed scope is an error, not a clean scan (PIK-005)", () => {
  const content = { "a.ts": "const commission = 1;" };

  it("rejects an empty file map or path list", () => {
    expect(() => assertNoPayoutImports({}, ["commission"])).toThrow(TypeError);
    expect(() => assertNoPayoutImports({}, ["commission"])).toThrow(/files is empty/);
    expect(() => assertNoPayoutImports([], ["commission"])).toThrow(/files is empty/);
  });

  it("rejects an empty identifier list", () => {
    expect(() => assertNoPayoutImports(content, [])).toThrow(TypeError);
    expect(() => assertNoPayoutImports(content, [])).toThrow(/payoutIdentifiers is empty/);
  });

  it("rejects blank identifiers, including whitespace and invisible format characters", () => {
    for (const blank of ["", "  ", "\t\n", "\u200B", "\u2066\u2069", "\u061C", "\uFEFF"]) {
      expect(() => assertNoPayoutImports(content, [blank])).toThrow(/payoutIdentifiers\[0\] is blank/);
    }
  });

  it("rejects identifiers that are neither strings nor real RegExps", () => {
    const fakeRegExp = Object.create(RegExp.prototype) as RegExp;
    for (const bad of [1, null, new String("commission"), ["commission"], fakeRegExp]) {
      expect(() => assertNoPayoutImports(content, [bad as never])).toThrow(/payoutIdentifiers\[0\] must be a string or a RegExp/);
    }
    const sparse = new Array<string>(1);
    expect(() => assertNoPayoutImports(content, sparse)).toThrow(/payoutIdentifiers\[0\] is missing/);
    expect(() => assertNoPayoutImports(content, "commission" as never)).toThrow(/payoutIdentifiers must be an array/);
  });

  it("rejects a files value that is not an array or a plain object, and non-string contents or paths", () => {
    for (const bad of [new Map([["a.ts", "commission"]]), null, "a.ts", new Date()]) {
      expect(() => assertNoPayoutImports(bad as never, ["commission"])).toThrow(/files must be an array of paths or a plain/);
    }
    expect(() => assertNoPayoutImports({ "a.ts": 1 } as never, ["commission"])).toThrow(/files\["a.ts"\] must be a string/);
    expect(() => assertNoPayoutImports([1] as never, ["commission"])).toThrow(/files\[0\] must be a non-blank path string/);
    expect(() => assertNoPayoutImports(new Array<string>(1), ["commission"])).toThrow(/files\[0\] is missing/);
  });

  it("rejects non-boolean or non-plain options", () => {
    expect(() => assertNoPayoutImports(content, ["commission"], { stripComments: "false" as never })).toThrow(
      /opts.stripComments must be a boolean/,
    );
    expect(() => assertNoPayoutImports(content, ["commission"], { caseInsensitive: 0 as never })).toThrow(
      /opts.caseInsensitive must be a boolean/,
    );
    expect(() => assertNoPayoutImports(content, ["commission"], new Map() as never)).toThrow(/opts must be a plain object/);
  });

  it("still scans a legitimate file and reads a null-prototype content map", () => {
    const map = Object.assign(Object.create(null) as Record<string, string>, content);
    expect(assertNoPayoutImports(map, ["commission"])).toHaveLength(1);
    expect(assertNoPayoutImports({ "b.ts": "const quality = 1;" }, ["commission"])).toEqual([]);
  });

  it("copies a RegExp identifier through its internal slots, not its own source or flags", () => {
    const re = /commission/;
    Object.defineProperty(re, "source", { get: () => "nothing-matches-this" });
    Object.defineProperty(re, "flags", { get: () => "" });
    expect(assertNoPayoutImports(content, [re])).toEqual([
      { file: "a.ts", matches: [{ identifier: "commission", line: 1, text: "const commission = 1;" }] },
    ]);
  });
});

describe("remaining branches (tests audit)", () => {
  it("names the index of a non-object scenario", () => {
    for (const bad of [1, null, "x"]) {
      expect(() => assertPayoutInvariance((x: number) => x, 1, [bad as never])).toThrow(
        /mutations\[0\] must be an object with a string "name"/,
      );
    }
  });

  it("names null as the bad hook result", () => {
    expect(() =>
      assertPayoutInvariance((input: Input) => input.payout, { payout: 0 }, [bump], { hasChanged: () => null as never }),
    ).toThrow(/hasChanged must return a boolean, got null/);
  });

  it("explains a runtime where getBuiltinModule cannot provide node:fs", () => {
    const original = process.getBuiltinModule.bind(process);
    process.getBuiltinModule = () => undefined;
    try {
      expect(() => assertNoPayoutImports(["some/file.ts"], ["commission"])).toThrow(/node:fs is not available/);
    } finally {
      process.getBuiltinModule = original;
    }
  });

  it("keeps a RegExp identifier's existing g flag", () => {
    const files = { "a.ts": "const commission = 1;\nconst x = commission;" };
    expect(assertNoPayoutImports(files, [/commission/g])[0]?.matches.map((match) => match.line)).toEqual([1, 2]);
  });
});
