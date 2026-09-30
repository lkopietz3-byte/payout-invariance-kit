import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertNoPayoutImports } from "../src/index";

// ---------------------------------------------------------------------------
// assertNoPayoutImports is a text-pattern grep, not a real parser. These
// tests cover what it catches, and — just as importantly — what it does NOT
// catch (false negatives are the dangerous direction for this kind of check:
// a caller trusts an empty result). See README.md, "Honest limits".
// ---------------------------------------------------------------------------

describe("assertNoPayoutImports: what it catches", () => {
  it("matches a plain identifier as a whole word, case-insensitively by default", () => {
    const offenses = assertNoPayoutImports({ "a.ts": "const COMMISSION = 1;" }, ["commission"]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.matches[0]?.identifier).toBe("commission");
  });

  it("can be made case-sensitive", () => {
    const offenses = assertNoPayoutImports({ "a.ts": "const COMMISSION = 1;" }, ["commission"], {
      caseInsensitive: false,
    });
    expect(offenses).toEqual([]);
  });

  it("matches an import specifier segment", () => {
    const offenses = assertNoPayoutImports({ "a.ts": 'import { rate } from "./payout/rate";' }, ["payout"]);
    expect(offenses.map((o) => o.file)).toEqual(["a.ts"]);
  });

  it("accepts a RegExp for patterns a plain word can't express", () => {
    const offenses = assertNoPayoutImports({ "a.ts": "const getPayoutForTier = () => 1;" }, [/getPayout\w*/]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.matches[0]?.identifier).toBe("getPayout\\w*");
  });

  it("respects a RegExp's own case sensitivity instead of the caseInsensitive option", () => {
    const offenses = assertNoPayoutImports({ "a.ts": "const COMMISSION = 1;" }, [/commission/]);
    expect(offenses).toEqual([]); // no 'i' flag on the RegExp itself
  });

  it("reports every matched identifier and line number, and dedupes nothing across lines", () => {
    const src = ["const commission = 1;", "const payout = 2;", "const commission2 = commission;"].join("\n");
    const offenses = assertNoPayoutImports({ "a.ts": src }, ["commission", "payout"]);
    expect(offenses[0]?.matches.map((m) => [m.identifier, m.line])).toEqual([
      ["commission", 1],
      ["payout", 2],
      ["commission", 3], // "commission2" doesn't match (word boundary), but the RHS "commission" does
    ]);
  });

  it("checks every file in the map/list independently and only reports offending ones", () => {
    const offenses = assertNoPayoutImports(
      { "clean.ts": "const x = 1;", "dirty.ts": "const commission = 1;" },
      ["commission"],
    );
    expect(offenses.map((o) => o.file)).toEqual(["dirty.ts"]);
  });

  it("strips a full single-line block comment mention", () => {
    const offenses = assertNoPayoutImports({ "a.ts": "/* commission */ const x = 1;" }, ["commission"]);
    expect(offenses).toEqual([]);
  });

  it("strips a multi-line block comment mention", () => {
    const src = ["/*", " * we used to look at commission here", " */", "const x = 1;"].join("\n");
    expect(assertNoPayoutImports({ "a.ts": src }, ["commission"])).toEqual([]);
  });

  it("can be told not to strip comments at all", () => {
    const offenses = assertNoPayoutImports({ "a.ts": "// commission" }, ["commission"], { stripComments: false });
    expect(offenses).toHaveLength(1);
  });
});

describe("assertNoPayoutImports: comment-stripping does not eat string contents (regression)", () => {
  it("does not treat '//' inside a URL string literal as the start of a line comment", () => {
    // Before the fix, the comment stripper cut the line at the first "//" it
    // found anywhere in the raw text, including inside a string. A URL like
    // "https://api.example.com/payout" would have everything from the "//"
    // onward silently discarded before matching ever ran — the reference to
    // "payout" right there in the code would never be seen.
    const src = 'const url = "https://api.example.com/payout";';
    const offenses = assertNoPayoutImports({ "a.ts": src }, ["payout"]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.matches[0]?.identifier).toBe("payout");
  });

  it("does not treat '/*' inside a string literal as the start of a block comment", () => {
    const src = 'const label = "commission /* not a real comment */ rate";';
    const offenses = assertNoPayoutImports({ "a.ts": src }, ["commission"]);
    expect(offenses).toHaveLength(1);
  });

  it("still strips a real line comment that follows a string on the same line", () => {
    const src = 'const url = "https://example.com/x"; // mentions commission here, not code';
    const offenses = assertNoPayoutImports({ "a.ts": src }, ["commission"]);
    expect(offenses).toEqual([]);
  });

  it("handles an escaped quote inside a string without ending the string early", () => {
    const src = 'const s = "he said \\"payout\\" // not a comment"; const commission = 1;';
    const offenses = assertNoPayoutImports({ "a.ts": src }, ["payout", "commission"]);
    const identifiers = offenses[0]?.matches.map((m) => m.identifier).sort();
    expect(identifiers).toEqual(["commission", "payout"]);
  });
});

describe("assertNoPayoutImports: honestly documented blind spots", () => {
  it("does not catch a forbidden word embedded in a larger camelCase identifier", () => {
    // Documented in the README: whole-word matching means a compound
    // identifier like "computePayoutForCard" is invisible to the plain
    // string "payout". A RegExp without \b (e.g. /payout/i) does catch it.
    const src = "function computePayoutForCard() { return 1; }";
    expect(assertNoPayoutImports({ "a.ts": src }, ["payout"])).toEqual([]);
    expect(assertNoPayoutImports({ "a.ts": src }, [/payout/i])).toHaveLength(1);
  });

  it("does not catch a forbidden word embedded in a snake_case identifier", () => {
    const src = "const payout_rate_bps = 50;";
    expect(assertNoPayoutImports({ "a.ts": src }, ["payout"])).toEqual([]);
    expect(assertNoPayoutImports({ "a.ts": src }, [/payout/i])).toHaveLength(1);
  });

  it("does not see a value re-exported under an aliased name", () => {
    const src = 'export { commission as bonusRate } from "./payout-lib";';
    // "commission" and "payout" both appear as real tokens here and ARE
    // caught — the blind spot is the *consumer* of "bonusRate" elsewhere,
    // which no longer says "commission" or "payout" anywhere in its own file.
    const consumerSrc = 'import { bonusRate } from "./reexport"; \nfunction rank(x) { return x.score + bonusRate; }';
    expect(assertNoPayoutImports({ "reexport.ts": src }, ["commission", "payout"])).toHaveLength(1);
    expect(assertNoPayoutImports({ "consumer.ts": consumerSrc }, ["commission", "payout"])).toEqual([]);
  });

  it("does not see a payout value read through a computed/dynamic property name", () => {
    const src = 'const key = "pay" + "out"; const value = candidate[key];';
    expect(assertNoPayoutImports({ "a.ts": src }, ["payout"])).toEqual([]);
  });

  it("does not see a payout value smuggled through a generically-named field", () => {
    const src = "function rank(c) { return c.score + c.meta.extra1; }";
    expect(assertNoPayoutImports({ "a.ts": src }, ["payout", "commission"])).toEqual([]);
  });

  it("does not see a dynamic import() assembled from smaller string fragments", () => {
    const src = 'const mod = await import("./" + "pay" + "out" + "-rates.js");';
    // The word "payout" itself never appears intact anywhere in the source
    // text — it only exists once the fragments are concatenated at runtime —
    // so a token-level grep for "payout" has nothing to match.
    expect(assertNoPayoutImports({ "a.ts": src }, ["payout"])).toEqual([]);
  });

  it("does not follow closures: a captured payout value with no local reference to the word", () => {
    function makeRanker(bonus: number) {
      // "bonus" is a generic parameter name; nothing here says "payout".
      return (score: number) => score + bonus;
    }
    void makeRanker;
    const src = "function makeRanker(bonus) { return (score) => score + bonus; }";
    expect(assertNoPayoutImports({ "a.ts": src }, ["payout", "commission", "affiliateRate"])).toEqual([]);
  });

  it("a '//' on a later line of a multi-line template literal is template text, not a comment", () => {
    const src = ["const s = `line one", "// commission reads as template text on line two", "line three`;"].join("\n");
    expect(assertNoPayoutImports({ "a.ts": src }, ["commission"])).toEqual([
      { file: "a.ts", matches: [{ identifier: "commission", line: 2, text: "// commission reads as template text on line two" }] },
    ]);
  });
});

describe("assertNoPayoutImports: template literals never hide the code after them", () => {
  const lineOf = (src: string): number[] =>
    assertNoPayoutImports({ "f.ts": src }, ["payout"]).flatMap((offense) => offense.matches.map((match) => match.line));

  it("a multi-line template containing an unclosed '/*' (a shell glob)", () => {
    expect(lineOf("const sh = `\nrm -rf dist/*\n`;\nexport const score = (o) => o.payout;")).toEqual([4]);
  });

  it("a backtick inside a string inside a template expression, then '/*' in a string", () => {
    expect(lineOf('const s = `${"`"}` + "/*";\nexport const score = (o) => o.payout * 2;')).toEqual([2]);
  });

  it("nested templates and braces inside ${ } expressions", () => {
    expect(lineOf('const s = `a ${ `b ${ "}" } /*` } /* d`;\nreturn o.payout;')).toEqual([2]);
    expect(lineOf("const s = `${ { a: 1 }.a } /*`;\nreturn o.payout;")).toEqual([2]);
    expect(lineOf("const s = `${ f({ a: `/*` }) }\n/*`;\nreturn o.payout;")).toEqual([3]);
  });

  it("escaped backticks and dollar signs inside a template", () => {
    expect(lineOf("const s = `\\` /* \\${ /*`;\nreturn o.payout;")).toEqual([2]);
  });

  it("a URL on its own line inside a multi-line template is kept", () => {
    expect(lineOf("const u = `\nhttps://api.example.com/payout\n`;")).toEqual([2]);
  });

  it("the reviewer's single-line cases", () => {
    expect(lineOf("const g = `a/*`;\nreturn o.payout;")).toEqual([2]);
    expect(lineOf("const g = `${x}/*`;\nreturn o.payout;")).toEqual([2]);
    expect(lineOf("fetch(`https://x.com/*`); return o.payout;")).toEqual([1]);
  });

  it("still strips real comments before, inside ${ } and after a template, keeping line numbers", () => {
    expect(lineOf("const t = `\nx\n`; // payout\nconst y = 1;")).toEqual([]);
    expect(lineOf("const t = `${ /* payout */ 1 }`;")).toEqual([]);
    expect(lineOf("const t = `${ 1 // payout\n}`;")).toEqual([]);
    expect(lineOf("const t = `a\nb`; /* payout\n */ return o.payout;")).toEqual([3]);
  });

  it("a regex literal containing a backtick or '/*' does not start a template or a comment", () => {
    expect(lineOf("const re = /`/;\nconst sh = `rm -rf dist/*`;\nreturn o.payout;")).toEqual([3]);
    expect(lineOf("const re = /[/*]/;\nreturn o.payout;")).toEqual([2]);
    expect(lineOf("if (ok) return /\\/*x/.test(s);\nreturn o.payout;")).toEqual([2]);
    expect(lineOf("const n = a / b; /* note */ return o.payout;")).toEqual([1]);
  });

  it("a quote inside a regex or JSX text only lasts to the end of its line", () => {
    expect(lineOf("const re = /'/; return o.payout;")).toEqual([1]);
    expect(lineOf("const t = <p>Don't /* </p>;\nreturn o.payout;")).toEqual([2]);
  });
});

describe("assertNoPayoutImports: file-path mode", () => {
  it("reads real files from disk and reports offenses with the given path", () => {
    const dir = mkdtempSync(join(tmpdir(), "assert-no-payout-imports-"));
    const filePath = join(dir, "rank.ts");
    writeFileSync(filePath, 'import { commission } from "./payout";\n');

    const offenses = assertNoPayoutImports([filePath], ["commission"]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.file).toBe(filePath);
  });
});
