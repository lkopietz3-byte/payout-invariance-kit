/**
 * Verdict rows for `matchIdentifierParts`, the opt-in mode that matches a
 * string identifier as one segment of a longer identifier (camelCase,
 * snake_case, kebab-case, SCREAMING_CASE). FLAG means assertNoPayoutImports
 * reports the file; CLEAN means it reports nothing.
 *
 * Origin: a README-style word list found 0 of 68 real references because
 * `affiliateUrl` is one token to a whole-word match.
 */
import { describe, expect, it } from "vitest";

import { assertNoPayoutImports } from "../src/index";

type Verdict = "FLAG" | "CLEAN";

interface Row {
  name: string;
  source: string;
  identifiers: (string | RegExp)[];
  expected: Verdict;
  opts?: { stripComments?: boolean; caseInsensitive?: boolean; matchIdentifierParts?: boolean };
  lines?: number[];
}

const PARTS = { matchIdentifierParts: true };

function verdictOf(row: Row): Verdict {
  const offenses = assertNoPayoutImports({ "file.ts": row.source }, row.identifiers, row.opts);
  if (row.lines) expect([...new Set(offenses[0]?.matches.map((m) => m.line))]).toEqual(row.lines);
  return offenses.length > 0 ? "FLAG" : "CLEAN";
}

function runRows(rows: Row[]): void {
  for (const row of rows) {
    it(`${row.name} -> ${row.expected}`, () => {
      expect(verdictOf(row)).toBe(row.expected);
    });
  }
}

describe("matchIdentifierParts: default stays whole-word", () => {
  runRows([
    { name: "default: affiliateUrl is one token", source: "const u = card.affiliateUrl;", identifiers: ["affiliate"], expected: "CLEAN" },
    { name: "default: snake_case is one token", source: "const u = card.affiliate_url;", identifiers: ["affiliate"], expected: "CLEAN" },
    { name: "default: kebab-case is still found", source: 'import x from "./affiliate-link";', identifiers: ["affiliate"], expected: "FLAG" },
    { name: "explicit false behaves like the default", source: "const u = card.affiliateUrl;", identifiers: ["affiliate"], expected: "CLEAN", opts: { matchIdentifierParts: false } },
  ]);
});

describe("matchIdentifierParts: segments are found", () => {
  runRows([
    { name: "camelCase suffix", source: "const u = card.affiliateUrl;", identifiers: ["affiliate"], expected: "FLAG", opts: PARTS },
    { name: "camelCase prefix", source: "const u = getAffiliate(card);", identifiers: ["affiliate"], expected: "FLAG", opts: PARTS },
    { name: "camelCase middle", source: "const u = computePayoutForCard(card);", identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "PascalCase type name", source: "type PayoutRate = number;", identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "snake_case middle", source: "const r = row.payout_rate_bps;", identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "leading underscore", source: "const _payout = 1;", identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "trailing underscore", source: "const payout_ = 1;", identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "SCREAMING_CASE", source: "const AFFILIATE_URL = 'x';", identifiers: ["affiliate"], expected: "FLAG", opts: PARTS },
    { name: "kebab-case import path", source: 'import x from "./payout-rates";', identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "acronym then word", source: "const x = PAYOUTRate;", identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "word then acronym", source: "const x = payoutURL;", identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "acronym in the middle", source: "const x = XMLHttpRequest;", identifiers: ["http"], expected: "FLAG", opts: PARTS },
    { name: "digit after", source: "const x = payout2;", identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "digit before", source: "const x = v2Payout;", identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "dollar prefix", source: "const x = $affiliateUrl;", identifiers: ["affiliate"], expected: "FLAG", opts: PARTS },
    { name: "member access", source: "this.sponsoredRank = 1;", identifiers: ["sponsored"], expected: "FLAG", opts: PARTS },
    { name: "whole word still found", source: "const payout = 1;", identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "whole word inside a string", source: "t('see the payout report')", identifiers: ["payout"], expected: "FLAG", opts: PARTS },
    { name: "next to Chinese text", source: "t('查看affiliate报表')", identifiers: ["affiliate"], expected: "FLAG", opts: PARTS },
    { name: "non-Latin camelCase", source: "const x = получитьКомиссия;", identifiers: ["комиссия"], expected: "FLAG", opts: PARTS },
    { name: "identifier made of two parts", source: "const x = getPayoutRateBps();", identifiers: ["payoutRate"], expected: "FLAG", opts: PARTS },
    { name: "identifier with a symbol edge", source: "const x = a.$payout;", identifiers: ["$payout"], expected: "FLAG", opts: PARTS },
  ]);
});

describe("matchIdentifierParts: partial words are not found", () => {
  runRows([
    { name: "plural is a different word", source: "const x = affiliates;", identifiers: ["affiliate"], expected: "CLEAN", opts: PARTS },
    { name: "past tense is a different word", source: "const x = isAffiliated;", identifiers: ["affiliate"], expected: "CLEAN", opts: PARTS },
    { name: "prefix glued on", source: "const x = prepayout;", identifiers: ["payout"], expected: "CLEAN", opts: PARTS },
    { name: "suffix glued on", source: "const x = payouts;", identifiers: ["payout"], expected: "CLEAN", opts: PARTS },
    { name: "lowercase run, no boundary", source: "const x = mypayoutrate;", identifiers: ["payout"], expected: "CLEAN", opts: PARTS },
    { name: "uppercase run, no boundary", source: "const x = MYPAYOUTRATE;", identifiers: ["payout"], expected: "CLEAN", opts: PARTS },
    { name: "lowercase start glued to a word", source: "const x = unaffiliatedUrl;", identifiers: ["affiliate"], expected: "CLEAN", opts: PARTS },
    { name: "mid-word capital does not split a longer word", source: "const x = repayoutRate;", identifiers: ["payout"], expected: "CLEAN", opts: PARTS },
    { name: "touching a non-Latin letter", source: "const x = commissionés;", identifiers: ["commission"], expected: "CLEAN", opts: PARTS },
    { name: "non-ASCII identifier stays strict next to Han", source: "t('佣金率')", identifiers: ["佣金"], expected: "CLEAN", opts: PARTS },
    { name: "comment is still skipped", source: "// affiliateUrl is not used here\nconst x = 1;", identifiers: ["affiliate"], expected: "CLEAN", opts: PARTS },
    { name: "case-sensitive: wrong case in the code", source: "const x = getAffiliate();", identifiers: ["affiliate"], expected: "CLEAN", opts: { matchIdentifierParts: true, caseInsensitive: false } },
  ]);
});

describe("matchIdentifierParts: overlap, case and reporting", () => {
  runRows([
    { name: "rejected candidate does not hide a later valid one", source: "const x = banAna;", identifiers: ["ana"], expected: "FLAG", opts: PARTS },
    { name: "case-sensitive with the written case", source: "const x = getAffiliate();", identifiers: ["Affiliate"], expected: "FLAG", opts: { matchIdentifierParts: true, caseInsensitive: false } },
    { name: "reports the right lines", source: "const a = 1;\nconst b = card.affiliateUrl;\nconst c = 2;\nconst d = payout_rate;", identifiers: ["affiliate", "payout"], expected: "FLAG", opts: PARTS, lines: [2, 4] },
    { name: "RegExp entries are unchanged", source: "const x = affiliateUrl;", identifiers: [/\baffiliate\b/], expected: "CLEAN", opts: PARTS },
  ]);

  it("rejects a non-boolean option", () => {
    expect(() => assertNoPayoutImports({ "f.ts": "x" }, ["a"], { matchIdentifierParts: "yes" as unknown as boolean })).toThrow(
      /opts\.matchIdentifierParts must be a boolean/,
    );
  });

  it("reports the identifier as written, trimmed", () => {
    const offenses = assertNoPayoutImports({ "f.ts": "card.affiliateUrl" }, ["  affiliate "], PARTS);
    expect(offenses[0]?.matches[0]?.identifier).toBe("affiliate");
  });

  it("finds all three spellings of one field in a mixed file", () => {
    const source = ["card.affiliateUrl", "row.affiliate_url", "AFFILIATE_URL", "'./affiliate-url'"].join("\n");
    const offenses = assertNoPayoutImports({ "f.ts": source }, ["affiliate"], PARTS);
    expect(offenses[0]?.matches.map((m) => m.line)).toEqual([1, 2, 3, 4]);
  });

  it("scans a large file in linear time", () => {
    // Every candidate is rejected, which is the worst case for the boundary check.
    const source = "payout".repeat(200_000) + " affiliateUrl";
    const started = process.cpuUsage();
    const offenses = assertNoPayoutImports({ "big.ts": source }, ["payout", "affiliate"], PARTS);
    const spent = process.cpuUsage(started);
    expect(offenses[0]?.matches.map((m) => m.identifier)).toEqual(["affiliate"]);
    expect((spent.user + spent.system) / 1000).toBeLessThan(3000);
  });

  it("README example: the word list finds the spellings listed in its comment", () => {
    const source = [
      "const a = card.affiliateUrl;",
      "const b = row.commission_rate_bps;",
      "const c = AFFILIATE_URL;",
      "const d = getPayoutRate();",
      'import bonus from "./referral-bonus";',
      "const e = sponsored;",
      "const clean = card.score;",
    ].join("\n");
    const words = ["affiliate", "commission", "payout", "referral", "sponsored"];
    const offenses = assertNoPayoutImports({ "src/lib/rank.ts": source }, words, { matchIdentifierParts: true });
    expect(offenses[0]?.matches.map((m) => m.line)).toEqual([1, 2, 3, 4, 5, 6]);
    // The same list without the option misses all but the whole words.
    const plain = assertNoPayoutImports({ "src/lib/rank.ts": source }, words);
    expect(plain[0]?.matches.map((m) => m.line)).toEqual([5, 6]);
  });
});
