/**
 * Verdict table: one named case per verdict a real user can get, each
 * asserting the CORRECT answer. A case is either a regression case (it
 * failed before the 2026-10 fixes) or a guard case (it must keep giving the
 * same verdict, so a fix cannot trade one wrong answer for another).
 *
 * Static cases use the verdict words FLAG (assertNoPayoutImports reports the
 * file) and CLEAN (it reports nothing). Runtime cases use PASS and FAIL.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { assertNoPayoutImports, assertPayoutInvariance, deepEqual } from "../src/index";

type Verdict = "FLAG" | "CLEAN";

interface StaticCase {
  name: string;
  source: string;
  identifiers: (string | RegExp)[];
  expected: Verdict;
  opts?: { stripComments?: boolean; caseInsensitive?: boolean };
  /** The file name to scan under; its extension decides whether JSX rules apply. Defaults to file.tsx. */
  file?: string;
  /** When FLAG: the 1-based lines the first offense must report. */
  lines?: number[];
}

function scan(source: string, identifiers: (string | RegExp)[], opts?: StaticCase["opts"], file = "file.tsx") {
  return assertNoPayoutImports({ [file]: source }, identifiers, opts);
}

function runStaticCases(cases: StaticCase[]): void {
  for (const c of cases) {
    it(`${c.name} -> ${c.expected}`, () => {
      const offenses = scan(c.source, c.identifiers, c.opts, c.file);
      const verdict: Verdict = offenses.length > 0 ? "FLAG" : "CLEAN";
      expect(verdict).toBe(c.expected);
      if (c.lines) {
        expect([...new Set(offenses[0]?.matches.map((m) => m.line))]).toEqual(c.lines);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Static, regression cases (each was a wrong verdict before the fixes).
// ---------------------------------------------------------------------------

describe("verdict table: static, regressions", () => {
  runStaticCases([
    // False FAIL: a comment after JSX or after a postfix operator was read as code.
    { name: "JSX comment after a closing tag", source: "const a = <h2>x</h2> {/* commission */};", identifiers: ["commission"], expected: "CLEAN" },
    { name: "JSX comment after a closing tag in a return", source: "return (<ul><li>a</li>{/* payout todo */}</ul>);", identifiers: ["payout"], expected: "CLEAN" },
    { name: "line comment after a self-closing tag", source: "const a = <Foo bar={1} />; // commission is not used\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "line comment after a closing tag", source: "const a = <p>hi</p>; // commission note\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "postfix ++ then division then a line comment", source: "let n = i++ / 2; // commission is applied elsewhere\nrank(n);\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "postfix -- then division then a line comment", source: "let half = total-- / 2; // payout ignored\n", identifiers: ["payout"], expected: "CLEAN" },
    { name: "JSX text with a slash between expressions, then a comment", source: "const a = <span>{x} / {y}</span>; // commission note\n", identifiers: ["commission"], expected: "CLEAN" },

    // False PASS: identifiers the matcher could not see.
    { name: "Cyrillic identifier", source: "const комиссия = 1;", identifiers: ["комиссия"], expected: "FLAG" },
    { name: "CJK identifier", source: "const 佣金 = row.佣金;", identifiers: ["佣金"], expected: "FLAG" },
    { name: "Greek identifier", source: "const προμήθεια = 1;", identifiers: ["προμήθεια"], expected: "FLAG" },
    { name: "accented identifier ending in a non-ASCII letter", source: "const comissão = row.comissão;", identifiers: ["comissão"], expected: "FLAG" },
    { name: "identifier starting with a non-ASCII letter", source: "const Ábono = 1;", identifiers: ["Ábono"], expected: "FLAG" },
    { name: "identifier starting with $", source: "const r = $payout;", identifiers: ["$payout"], expected: "FLAG" },
    { name: "identifier starting with @ (package scope)", source: "import x from '@payout/core';", identifiers: ["@payout/core"], expected: "FLAG" },
    { name: "identifier ending with a symbol", source: "rate% = 1", identifiers: ["rate%"], expected: "FLAG" },
    { name: "whitespace-padded string identifier is trimmed", source: "const r = row.commission;", identifiers: [" commission "], expected: "FLAG" },
    { name: "multi-line RegExp matches across lines", source: "import {\n  commission,\n} from './x';", identifiers: [/import\s*\{[^}]*\bcommission\b/], expected: "FLAG", lines: [1] },
    { name: "sticky RegExp still searches the file", source: "const r = row.commission;", identifiers: [/commission/y], expected: "FLAG" },
    { name: "global RegExp reports every line", source: "a.commission;\nb.commission;\n", identifiers: [/commission/g], expected: "FLAG", lines: [1, 2] },
    { name: "// comment ended by a lone CR hides nothing", source: "// harmless\rconst r = row.commission;\n", identifiers: ["commission"], expected: "FLAG", lines: [2] },
    { name: "// comment ended by U+2028 hides nothing", source: "// harmless const r = row.commission;\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "// comment ended by U+2029 hides nothing", source: "// harmless const r = row.commission;\n", identifiers: ["commission"], expected: "FLAG" },

    // False FAIL: ASCII word inside a longer accented word.
    { name: "ASCII identifier inside a longer accented word", source: "const x = row.commissionés;", identifiers: ["commission"], expected: "CLEAN" },
    { name: "ASCII identifier after a non-ASCII letter", source: "const ñcommission = 1;", identifiers: ["commission"], expected: "CLEAN" },
  ]);

  it("// comment text ended by CR is still removed", () => {
    expect(scan("// commission note\rconst x = 1;\n", ["commission"])).toEqual([]);
  });

  it("line numbers stay right on CR-only and CRLF files", () => {
    const lf = scan("a;\nb;\nrow.commission;\n", ["commission"])[0]?.matches[0]?.line;
    const cr = scan("a;\rb;\rrow.commission;\r", ["commission"])[0]?.matches[0]?.line;
    const crlf = scan("a;\r\nb;\r\nrow.commission;\r\n", ["commission"])[0]?.matches[0]?.line;
    expect([lf, cr, crlf]).toEqual([3, 3, 3]);
  });
});

// ---------------------------------------------------------------------------
// Static, guard cases (must keep their verdict).
// ---------------------------------------------------------------------------

describe("verdict table: static, guards", () => {
  runStaticCases([
    // Comments and strings in ordinary TS and TSX.
    { name: "line comment mentioning the word", source: "// commission is complicated\nconst x = 1;\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "block comment mentioning the word", source: "/* commission */ const x = 1;\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "URL with // in a string, comment after it", source: 'const u = "https://api.example.com/v1"; // payout\n', identifiers: ["payout"], expected: "CLEAN" },
    { name: "word inside a string is still a reference", source: 'const label = "commission";\n', identifiers: ["commission"], expected: "FLAG" },
    { name: "import path segment", source: 'import { x } from "@/lib/affiliate";\n', identifiers: ["affiliate"], expected: "FLAG" },
    { name: "TSX comment inside JSX expression", source: "const a = (<div>{/* commission */}<p>hi</p></div>);\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "template literal with a slash-star glob", source: "const s = `rm -rf dist/*`;\nconst c = row.commission;\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "code after a block comment", source: "return/* note */commission;\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "template expression holds the word", source: "const s = `${row.commission}`;\n", identifiers: ["commission"], expected: "FLAG" },

    // Documented camelCase and word-boundary behavior.
    { name: "camelCase fragment is not matched (documented)", source: "const computePayoutForCard = 1;\n", identifiers: ["payout"], expected: "CLEAN" },
    { name: "snake_case fragment is not matched (documented)", source: "const payout_rate_bps = 1;\n", identifiers: ["payout"], expected: "CLEAN" },
    { name: "plural is not matched", source: "import { rates } from './payouts';\n", identifiers: ["payout"], expected: "CLEAN" },
    { name: "camelCase fragment is matched by a substring RegExp", source: "const computePayoutForCard = 1;\n", identifiers: [/payout/i], expected: "FLAG" },
    { name: "Svelte-style store reference matches the bare name", source: "const r = $payout;\n", identifiers: ["payout"], expected: "FLAG" },
    { name: "member access", source: "const r = row.payout;\n", identifiers: ["payout"], expected: "FLAG" },

    // Case handling.
    { name: "case-insensitive by default", source: "const r = row.Commission;\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "caseInsensitive: false is case-sensitive", source: "const r = row.Commission;\n", identifiers: ["commission"], expected: "CLEAN", opts: { caseInsensitive: false } },
    { name: "caseInsensitive: false still matches the exact case", source: "const r = row.commission;\n", identifiers: ["commission"], expected: "FLAG", opts: { caseInsensitive: false } },
    { name: "RegExp is used as given (case-sensitive)", source: "const r = row.Commission;\n", identifiers: [/commission/], expected: "CLEAN" },
    { name: "non-Latin identifier is case-insensitive", source: "const КОМИССИЯ = 1;\n", identifiers: ["комиссия"], expected: "FLAG" },

    // Documented lexer limits stay documented (and the opt-out works).
    { name: "regex after ) is read as division, /* hides code (documented)", source: "if (ok) /[/*]/.test(s);\nconst c = row.commission;\n/* */", identifiers: ["commission"], expected: "CLEAN" },
    { name: "same file with stripComments: false", source: "if (ok) /[/*]/.test(s);\nconst c = row.commission;\n/* */", identifiers: ["commission"], expected: "FLAG", opts: { stripComments: false } },
    { name: "stripComments: false also scans comments", source: "// commission\n", identifiers: ["commission"], expected: "FLAG", opts: { stripComments: false } },

    // Real code after the same shapes the lexer fixes were made for.
    { name: "regex after a single + is still a regex, code after it is scanned", source: "const ok = a + /[/*]/.test(s);\nconst c = row.commission;\n/* */", identifiers: ["commission"], expected: "FLAG", lines: [2] },
    { name: "regex after a single - is still a regex", source: "const ok = a - /[/*]/.exec(s);\nconst c = row.commission;\n/* */", identifiers: ["commission"], expected: "FLAG", lines: [2] },
    { name: "regex after < with a space is still a regex", source: "if (a < /[/*]/.test(b)) {}\nconst c = row.commission;\n/* */", identifiers: ["commission"], expected: "FLAG", lines: [2] },
    { name: "regex starting a statement after a } line is still a regex", source: "if (a) {\n}\n/[/*]/.test(s);\nconst c = row.commission;\n/* */", identifiers: ["commission"], expected: "FLAG", lines: [4] },
    { name: "regex starting with > after ( is still a regex", source: 's.replace(/>[/*]/g, "");\nconst c = row.commission;\n/* */', identifiers: ["commission"], expected: "FLAG", lines: [2] },
    { name: "real code after a closing tag is scanned", source: "const a = <p>x</p>; const c = row.commission; // note\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "real code after a self-closing tag is scanned", source: "const a = <Foo bar={1} />; const c = row.commission; // note\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "real code after ++ and division is scanned", source: "let n = i++ / 2; const c = row.commission; // note\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "code after a CRLF-ended comment is scanned", source: "// note\r\nconst c = row.commission;\n", identifiers: ["commission"], expected: "FLAG", lines: [2] },
    { name: "string with a CRLF line continuation keeps the string open", source: 'const s = "a\\\r\nb // commission";\n', identifiers: ["commission"], expected: "FLAG" },
  ]);
});

// ---------------------------------------------------------------------------
// Realistic probes added after the fixes (real TSX, Svelte-style stores,
// non-English codebases). Each one tried to break a fix.
// ---------------------------------------------------------------------------

const TSX_LIST = `import React from "react";
type Props<T> = { items: T[]; score: (t: T) => number };
export function List<T,>({ items, score }: Props<T>) {
  const avg = items.length / 2; // commission is not used here
  return (
    <ul>
      {items.map((it, i) => (
        <li key={i}>
          <b>{score(it)}</b> / <i>{avg}</i> {/* payout badge removed */}
        </li>
      ))}
      <Footer total={items.length} />{/* affiliate links hidden */}
    </ul>
  );
}
`;

describe("verdict table: static, self-hunt probes", () => {
  runStaticCases([
    { name: "a real TSX component full of slashes and JSX comments", source: TSX_LIST, identifiers: ["commission", "payout", "affiliate"], expected: "CLEAN" },
    { name: "the same component with a real reference after a self-closing tag", source: TSX_LIST.replace("<Footer total={items.length} />", "<Footer total={items.length} rate={row.payout} />"), identifiers: ["payout"], expected: "FLAG", lines: [12] },
    { name: "Svelte-style script and markup", source: "<script>\n  import { payout } from './stores';\n  $: total = $payout * 2;\n</script>\n<p>{$payout}</p>", identifiers: ["payout"], expected: "FLAG", lines: [2, 3, 5] },
    { name: "Svelte-style store identifier with its dollar sign", source: "$: total = $commission / 2; // fine\n", identifiers: ["$commission"], expected: "FLAG" },
    { name: "German word", source: "const satz = row.Provision; // Vergütung\n", identifiers: ["Provision"], expected: "FLAG" },
    { name: "German compound is a camelCase-style fragment (documented)", source: "const Provisionssatz = 1;\n", identifiers: ["Provision"], expected: "CLEAN" },
    { name: "Portuguese word only in a comment", source: "// calcula a comissão do parceiro\nconst x = 1;\n", identifiers: ["comissão"], expected: "CLEAN" },
    { name: "Spanish ñ next to the identifier", source: "const año = tarifa;\n", identifiers: ["tarifa"], expected: "FLAG" },
    { name: "Japanese word in a string", source: 'const label = "手数料";\n', identifiers: ["手数料"], expected: "FLAG" },
    { name: "ASCII fragment of a decomposed accented word is not matched", source: "const comisio\u0301n = 1;\n", identifiers: ["comisio"], expected: "CLEAN" },
    { name: "anchored RegExp still means line start", source: 'x\nimport a from "payout";\n', identifiers: [/^import .*payout/], expected: "FLAG", lines: [2] },
    { name: "end-anchored RegExp still means line end", source: "export default payout\nfoo\n", identifiers: [/payout$/], expected: "FLAG", lines: [1] },
    { name: "empty-match RegExp does not loop and reports line 1", source: "abc", identifiers: [/x*/], expected: "FLAG", lines: [1] },
    { name: "ranking code with division, a regex and a comment", source: 'const mean = xs.reduce((a, b) => a + b, 0) / xs.length;\nconst clean = name.replace(/\\s+/g, " "); // commission stripped\n', identifiers: ["commission"], expected: "CLEAN" },
    { name: "the same ranking code with a real reference", source: "const mean = xs.reduce((a, b) => a + b, 0) / xs.length;\nreturn xs.map((x) => x / mean + x.commission);\n", identifiers: ["commission"], expected: "FLAG", lines: [2] },
    { name: "prefix -- then division then real code", source: "let h = --i / 2; const r = row.commission; /* c */\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "fragment closing tag then a comment", source: "const a = <><b>x</b></>; // commission\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "multi-line self-closing tag then a comment", source: "const a = (\n  <Foo\n    a={1}\n    />\n); // commission\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "generic JSX self-closing tag then a comment", source: "const a = <Foo<string> a={1} />; // commission\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "regex after } on the same line is still a regex when not followed by a space", source: "if (x) { y() } /[/*]/.test(s); row.payout; /* c */\n", identifiers: ["payout"], expected: "FLAG" },
    { name: "a space after the slash following } is division, then a comment", source: "const t = <b>{a} / {b}</b>; // payout\n", identifiers: ["payout"], expected: "CLEAN" },
    { name: "/= after } is division, then a comment", source: "const t = {a: 1}; t.a /= 2; x = {} /= 2; // payout\n", identifiers: ["payout"], expected: "CLEAN" },
    { name: "// inside JSX text is read as a comment (documented)", source: "const a = <p>Split 50/50 // not a comment? payout</p>;\n", identifiers: ["payout"], expected: "CLEAN" },
  ]);
});

// ---------------------------------------------------------------------------
// Review round: empty matches, regex after `<`, regex after a block, prefix
// ++, and identifiers written against CJK text.
// ---------------------------------------------------------------------------

/**
 * Run a snippet against a fresh transpile of src/ in a child process, so a
 * hang is a failed test (the child is killed at the timeout) instead of a
 * frozen test run.
 */
function runIsolated(snippet: string, timeoutMs: number): { status: number | null; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), "pik-isolated-"));
  try {
    for (const file of ["index", "deepEqual", "snapshot"]) {
      const source = readFileSync(new URL(`../src/${file}.ts`, import.meta.url), "utf8");
      const out = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
      writeFileSync(join(dir, `${file}.js`), out.outputText);
    }
    writeFileSync(join(dir, "package.json"), '{"type":"module"}');
    writeFileSync(join(dir, "probe.js"), `import * as k from "./index.js";\n${snippet}`);
    const run = spawnSync(process.execPath, [join(dir, "probe.js")], { timeout: timeoutMs, encoding: "utf8" });
    return { status: run.status, stdout: run.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("verdict table: static, review round", () => {
  it("an empty match from a Unicode RegExp before an astral character terminates and is reported -> FLAG", () => {
    const run = runIsolated(
      'const r = k.assertNoPayoutImports({ "f.ts": "a\u{1F600}b" }, [/(?:)/u, /(?:)/v]);\nconsole.log(JSON.stringify(r.map((o) => o.matches.map((m) => m.line))));',
      15000,
    );
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe("[[1,1]]"); // one file, one report per matcher, both on line 1
  });

  runStaticCases([
    // Regex directly after `<`: a closing tag needs an identifier (or nothing) and `>`.
    { name: "regex directly after < is a regex, code after it is scanned", source: "const ok = a</[/*]/.test(b);\nrow.commission;\n/* */", identifiers: ["commission"], expected: "FLAG", lines: [2] },
    { name: "anchored URL regex directly after < hides nothing", source: "if (n</^https?:\\/\\//.test(url)) row.payout = 1;\n", identifiers: ["payout"], expected: "FLAG" },
    { name: "regex starting with an identifier directly after < is a regex", source: "const ok = a</foo[/*]/.test(b);\nrow.commission;\n/* */", identifiers: ["commission"], expected: "FLAG", lines: [2] },
    { name: "fragment closing tag </> then a comment", source: "const a = <><b>x</b></>; // commission\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "member-name closing tag then a comment", source: "const a = <Ui.Card>x</Ui.Card>; // commission\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "namespaced closing tag with a space then a comment", source: "const a = <svg:g>x</svg:g >; // commission\n", identifiers: ["commission"], expected: "CLEAN" },

    // Regex after a block versus a slash after an expression-ending brace.
    { name: "regex starting with = after a block is a regex", source: "if (x) { y() } /=[/*]/.test(s); row.commission; /* */\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "regex starting with a space after a block is a regex", source: "if (x) { y() } / [/*]/.test(s); row.commission; /* */\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "regex after an else block", source: "if (x) { y() } else { z() } /[/*]/.test(s); row.commission; /* */\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "regex after an arrow body block", source: "const f = () => { y() }; const g = () => { z() } /[/*]/.test(s); row.commission; /* */\n", identifiers: ["commission"], expected: "FLAG" },
    { name: "division after an object literal across lines, then a comment", source: "const o = {\n  a: 1,\n}\n/ 2; // commission\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "division after adjacent JSX expressions, then a comment", source: "const t = <p>{a}{b} / {c}</p>; // commission\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "division after a spread attribute brace, then a comment", source: "const t = <Foo a {...p} />; // commission\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "division after a style object brace, then a comment", source: "const t = <b style={{ a: 1 }} />; // commission\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "division-assign after an empty object, then a comment", source: "x = {} /= 2; // commission\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "real code after an object literal and division is scanned", source: "const r = ({ a: 1 }).a / 2; const c = row.commission; // note\n", identifiers: ["commission"], expected: "FLAG" },

    // Prefix versus postfix ++.
    { name: "prefix ++ before a regex is a regex", source: "const n = ++/[/*]/.lastIndex;\nrow.commission;\n/* */", identifiers: ["commission"], expected: "FLAG", lines: [2] },
    { name: "prefix -- after an operator is a regex", source: "const n = a + --/[/*]/.lastIndex;\nrow.commission;\n/* */", identifiers: ["commission"], expected: "FLAG", lines: [2] },
    { name: "postfix ++ on an index expression divides", source: "const n = a[0]++ / 2; // commission\n", identifiers: ["commission"], expected: "CLEAN" },
    { name: "postfix -- on a call result divides", source: "const n = f()-- / 2; // commission\n", identifiers: ["commission"], expected: "CLEAN" },

    // Identifiers written against CJK text and other non-identifier characters.
    { name: "ASCII identifier between CJK characters in a UI string", source: "t('查看payout报表');\n", identifiers: ["payout"], expected: "FLAG" },
    { name: "ASCII identifier before kana", source: "t('payoutです');\n", identifiers: ["payout"], expected: "FLAG" },
    { name: "ASCII identifier before a Korean particle", source: "t('payout을 확인');\n", identifiers: ["payout"], expected: "FLAG" },
    { name: "ASCII identifier before a superscript", source: "const r = payout\u00B2;\n", identifiers: ["payout"], expected: "FLAG" },
    { name: "ASCII identifier before a vulgar fraction", source: "const r = payout\u00BD;\n", identifiers: ["payout"], expected: "FLAG" },
    { name: "ASCII identifier before a Cyrillic letter is one word", source: "const payout\u0430 = 1;\n", identifiers: ["payout"], expected: "CLEAN" },
    { name: "ASCII identifier with a longer ASCII word between CJK text", source: "t('查看payouts报表');\n", identifiers: ["payout"], expected: "CLEAN" },
    { name: "CJK identifier inside a longer CJK word is not matched (no word breaks in CJK)", source: "const 佣金率 = 1;\n", identifiers: ["佣金"], expected: "CLEAN" },
    { name: "CJK identifier alone", source: "const 佣金 = 1;\n", identifiers: ["佣金"], expected: "FLAG" },
  ]);
});

// ---------------------------------------------------------------------------
// Final lexer round: more statement blocks, and JSX rules only in JSX files.
// ---------------------------------------------------------------------------

describe("verdict table: static, final lexer round", () => {
  const tail = " /[/*]/.test(s); row.payout; /* */\n";
  runStaticCases([
    // Statement blocks that end in a `}` followed by a regex.
    { name: "regex after try/catch without a parameter", source: "try { a() } catch { b() }" + tail, identifiers: ["payout"], expected: "FLAG" },
    { name: "regex after try/catch with a parameter", source: "try { a() } catch (e) { b() }" + tail, identifiers: ["payout"], expected: "FLAG" },
    { name: "regex after finally", source: "try { a() } finally { b() }" + tail, identifiers: ["payout"], expected: "FLAG" },
    { name: "regex after a class body", source: "class A { m() {} }" + tail, identifiers: ["payout"], expected: "FLAG" },
    { name: "regex after a class body with extends", source: "class A extends B { m() {} }" + tail, identifiers: ["payout"], expected: "FLAG" },
    { name: "regex after a labeled block", source: "outer: { a() }" + tail, identifiers: ["payout"], expected: "FLAG" },
    { name: "regex after a labeled block inside a block", source: "function f() { outer: { a() }" + tail + "}\n", identifiers: ["payout"], expected: "FLAG" },
    { name: "regex after a bare block following a semicolon", source: "a(); { b() }" + tail, identifiers: ["payout"], expected: "FLAG" },
    { name: "regex after a bare block following another block", source: "if (a) { c() } { b() }" + tail, identifiers: ["payout"], expected: "FLAG" },
    { name: "regex after a case block", source: "switch (k) { case 1: { a() }" + tail + "}\n", identifiers: ["payout"], expected: "FLAG" },
    { name: "regex after a default block", source: "switch (k) { default: { a() }" + tail + "}\n", identifiers: ["payout"], expected: "FLAG" },
    // Guards: braces that end an expression still divide.
    { name: "division after a nested object literal property", source: "const v = { a: { b: 1 } } / 2; // payout\n", identifiers: ["payout"], expected: "CLEAN" },
    { name: "division after an object with a default key", source: "const v = { default: { b: 1 } } / 2; // payout\n", identifiers: ["payout"], expected: "CLEAN" },
    { name: "division after an object in an argument list", source: "const v = f({ a: 1 }) / 2; // payout\n", identifiers: ["payout"], expected: "CLEAN" },
    { name: "JSX attribute named class does not make the next brace a block", source: 'const t = <b class="x" title={a} />; // payout\n', identifiers: ["payout"], expected: "CLEAN" },
    { name: "division after a template-free ternary object", source: "const v = ok ? { a: 1 } : { b: 2 }; const w = v / 2; // payout\n", identifiers: ["payout"], expected: "CLEAN" },

    // JSX tag rules only apply in JSX files.
    { name: "plain .ts: a regex after > starting with > is a regex", source: "const ok = a > />[/*]/.test(b);\nrow.payout;\n/* */", identifiers: ["payout"], expected: "FLAG", file: "f.ts" },
    { name: "plain .ts: a regex after </foo> is a regex", source: "const ok = a</foo>[/*]/.test(b);\nrow.payout;\n/* */", identifiers: ["payout"], expected: "FLAG", file: "f.ts" },
    { name: "plain .js without JSX: a regex after > starting with > is a regex", source: "const ok = a > />[/*]/.test(b);\nrow.payout;\n/* */", identifiers: ["payout"], expected: "FLAG", file: "f.js" },
    { name: "plain .js without JSX: a regex after </foo> is a regex", source: "const ok = a</foo>[/*]/.test(b);\nrow.payout;\n/* */", identifiers: ["payout"], expected: "FLAG", file: "f.js" },
    { name: ".tsx: an arrow body that is a regex starting with >", source: "const f = (s: string) => />[/*]/.test(s);\nrow.payout;\n/* */", identifiers: ["payout"], expected: "FLAG" },
    { name: ".js with a JSX opener still gets the JSX rules", source: "const a = <p>hi</p>; // payout\n", identifiers: ["payout"], expected: "CLEAN", file: "f.js" },
    { name: ".js with a JSX self-closing tag still gets the JSX rules", source: "const a = <Foo bar={1} />; // payout\n", identifiers: ["payout"], expected: "CLEAN", file: "f.js" },
    { name: ".jsx always gets the JSX rules", source: "const a = (<ul><li>a</li>{/* payout */}</ul>);\n", identifiers: ["payout"], expected: "CLEAN", file: "f.jsx" },
    { name: "unknown extension with a JSX opener gets the JSX rules", source: "<script>\n  const a = <p>hi</p>; // payout\n</script>\n", identifiers: ["payout"], expected: "CLEAN", file: "f.svelte" },
    { name: "plain .ts: closing-tag-looking text is not JSX (documented)", source: "const a = <p>x</p>; // payout\n", identifiers: ["payout"], expected: "FLAG", file: "f.ts" },
    { name: "plain .ts still divides after postfix ++", source: "let n = i++ / 2; // payout\n", identifiers: ["payout"], expected: "CLEAN", file: "f.ts" },
  ]);
});

// ---------------------------------------------------------------------------
// Runtime.
// ---------------------------------------------------------------------------

const base = {
  cands: [
    { id: "x", score: 50, pay: 0 },
    { id: "y", score: 50, pay: 0 },
    { id: "z", score: 10, pay: 0 },
  ],
};
type Base = typeof base;
const bump = [
  { name: "pay x", mutate: (i: Base): Base => ({ cands: i.cands.map((c) => (c.id === "x" ? { ...c, pay: 900 } : c)) }) },
  { name: "pay z", mutate: (i: Base): Base => ({ cands: i.cands.map((c) => (c.id === "z" ? { ...c, pay: 900 } : c)) }) },
];
// Payout-driven order: the biased ranker.
const biasedOrder = (i: Base): string[] =>
  [...i.cands].sort((a, b) => b.pay - a.pay || b.score - a.score || a.id.localeCompare(b.id)).map((c) => c.id);
const honestOrder = (i: Base): string[] =>
  [...i.cands].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map((c) => c.id);

const asSet = (ids: string[]): Set<string> => new Set(ids);
const asMap = (ids: string[]): Map<string, number> => new Map(ids.map((id, n) => [id, n === -1 ? 0 : 1]));
const asObject = (ids: string[]): Record<string, boolean> => Object.fromEntries(ids.map((id) => [id, true]));

describe("verdict table: runtime, regressions", () => {
  const shapes: [string, (ids: string[]) => unknown][] = [
    ["Set", asSet],
    ["Map", asMap],
    ["keyed object", asObject],
  ];
  for (const [shape, wrap] of shapes) {
    it(`biased ranker returning a ${shape} in rank order: PASS by default (documented)`, () => {
      const r = assertPayoutInvariance((i: Base) => wrap(biasedOrder(i)), base, bump);
      expect(r.passed).toBe(true);
    });
    it(`biased ranker returning a ${shape} in rank order: FAIL with orderSensitive: true`, () => {
      const r = assertPayoutInvariance((i: Base) => wrap(biasedOrder(i)), base, bump, { orderSensitive: true });
      expect(r.passed).toBe(false);
      expect(r.failures.length).toBeGreaterThan(0);
    });
    it(`honest ranker returning a ${shape}: PASS with orderSensitive: true`, () => {
      const r = assertPayoutInvariance((i: Base) => wrap(honestOrder(i)), base, bump, { orderSensitive: true });
      expect(r.passed).toBe(true);
    });
  }

  it("deepEqual ignores Set, Map and key order by default and honors orderSensitive", () => {
    expect(deepEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(deepEqual(new Set([1, 2]), new Set([2, 1]), { orderSensitive: true })).toBe(false);
    expect(deepEqual(new Map([[1, "a"], [2, "b"]]), new Map([[2, "b"], [1, "a"]]))).toBe(true);
    expect(deepEqual(new Map([[1, "a"], [2, "b"]]), new Map([[2, "b"], [1, "a"]]), { orderSensitive: true })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }, { orderSensitive: true })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 }, { orderSensitive: true })).toBe(true);
  });

  it("a ranker that forgets to return (undefined baseline) throws a clear error", () => {
    expect(() =>
      assertPayoutInvariance(
        (i: Base) => {
          biasedOrder(i);
        },
        base,
        bump,
      ),
    ).toThrow(/returned undefined/);
  });
});

describe("verdict table: runtime, guards", () => {
  it("honest array ranker: PASS", () => {
    expect(assertPayoutInvariance(honestOrder, base, bump).passed).toBe(true);
  });
  it("biased array ranker: FAIL", () => {
    const r = assertPayoutInvariance(biasedOrder, base, bump);
    expect(r.passed).toBe(false);
    expect(r.failures.map((f) => f.scenario)).toEqual(["pay z"]);
  });
  it("ranker returning null or NaN is not an error (a legitimate empty answer)", () => {
    expect(assertPayoutInvariance(() => null, base, bump).passed).toBe(true);
    expect(assertPayoutInvariance(() => Number.NaN, base, bump).passed).toBe(true);
  });
  it("ranker that returns undefined for a mutated input only is a FAIL, not an error", () => {
    const r = assertPayoutInvariance((i: Base) => (i.cands.some((c) => c.pay > 0) ? undefined : ["x"]), base, bump);
    expect(r.passed).toBe(false);
  });
  it("async ranker is rejected", () => {
    expect(() => assertPayoutInvariance(async (i: Base) => honestOrder(i), base, bump)).toThrow(/Promise/);
  });
  it("in-place edit of baseInput is caught", () => {
    const sneaky = (i: Base): string[] => {
      i.cands.reverse();
      return ["x"];
    };
    expect(() => assertPayoutInvariance(sneaky, structuredClone(base), bump)).toThrow(/in place/);
  });
  it("orderSensitive must be a boolean", () => {
    expect(() => assertPayoutInvariance(honestOrder, base, bump, { orderSensitive: "yes" as unknown as boolean })).toThrow(
      /orderSensitive/,
    );
  });
  it("a vacuous scenario is still not a pass", () => {
    const r = assertPayoutInvariance(honestOrder, base, [{ name: "noop", mutate: (i: Base) => i }]);
    expect(r.passed).toBe(false);
    expect(r.vacuous).toEqual(["noop"]);
  });
  it("class-instance input works with the synchronous check", () => {
    class Candidate {
      constructor(
        public id: string,
        public score: number,
        public pay: number,
      ) {}
    }
    const input = { cands: [new Candidate("a", 9, 0), new Candidate("b", 5, 0)] };
    type In = typeof input;
    const r = assertPayoutInvariance(
      (i: In) => [...i.cands].sort((a, b) => b.score - a.score).map((c) => c.id),
      input,
      [{ name: "b pays", mutate: (i: In): In => ({ cands: i.cands.map((c) => new Candidate(c.id, c.score, c.id === "b" ? 90 : 0)) }) }],
    );
    expect(r.passed).toBe(true);
  });
});

describe("verdict table: runtime, self-hunt probes", () => {
  it("a nested Map and Set that stay in the same order pass with orderSensitive", () => {
    const r = assertPayoutInvariance(
      (i: Base) => ({ order: new Map([...i.cands].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map((c) => [c.id, c.score])), tags: new Set(["a", "b"]) }),
      base,
      bump,
      { orderSensitive: true },
    );
    expect(r.passed).toBe(true);
  });

  it("orderSensitive makes a mutation that only reorders keys non-vacuous; the default calls it vacuous", () => {
    const input = { a: 1, b: 2, cands: base.cands };
    const reorder = [{ name: "reorder", mutate: (i: typeof input) => ({ b: 2, a: 1, cands: i.cands }) }];
    const rank = (i: typeof input): string[] => i.cands.map((c) => c.id);
    expect(assertPayoutInvariance(rank, input, reorder).vacuous).toEqual(["reorder"]);
    expect(assertPayoutInvariance(rank, input, reorder, { orderSensitive: true }).vacuous).toEqual([]);
  });

  it("orderSensitive does not trip the in-place check on circular, Symbol-keyed and Map-holding input", () => {
    const input: Record<PropertyKey, unknown> = { a: 1, [Symbol.for("s")]: 2, m: new Map([["p", { z: 1 }]]) };
    input.self = input;
    const r = assertPayoutInvariance(() => ["x"], input, [{ name: "add", mutate: (i) => ({ ...i, extra: 1 }) }], { orderSensitive: true });
    expect(r.passed).toBe(true);
  });

  it("deepEqual orderSensitive covers Set members that are objects and Map keys that are objects", () => {
    expect(deepEqual(new Set([{ a: 1 }, { a: 2 }]), new Set([{ a: 2 }, { a: 1 }]))).toBe(true);
    expect(deepEqual(new Set([{ a: 1 }, { a: 2 }]), new Set([{ a: 2 }, { a: 1 }]), { orderSensitive: true })).toBe(false);
    expect(deepEqual(new Map([[{ k: 1 }, 1], [{ k: 2 }, 2]]), new Map([[{ k: 2 }, 2], [{ k: 1 }, 1]]), { orderSensitive: true })).toBe(false);
    expect(deepEqual(new Map([[{ k: 1 }, 1], [{ k: 2 }, 2]]), new Map([[{ k: 1 }, 1], [{ k: 2 }, 2]]), { orderSensitive: true })).toBe(true);
  });

  it("deepEqual rejects options that are not a plain object with a boolean flag", () => {
    for (const bad of [null, 1, "x", [], new Map(), { orderSensitive: 1 }]) {
      expect(() => deepEqual(1, 1, bad as never)).toThrow(TypeError);
    }
  });
});

describe("verdict table: a discarding Array.prototype setter cannot hide a verdict", () => {
  /** Accessors on Array.prototype indexes 0..count-1: the setter discards writes. Always removed afterwards. */
  function polluted<T>(count: number, run: () => T): T {
    for (let index = 0; index < count; index += 1) {
      Object.defineProperty(Array.prototype, index, { get: () => undefined, set: () => undefined, configurable: true });
    }
    try {
      return run();
    } finally {
      for (let index = 0; index < count; index += 1) {
        delete (Array.prototype as unknown as Record<number, unknown>)[index];
      }
    }
  }

  const base = { v: 1 };

  it("FAIL: a failing run is still reported as failing, with every failing scenario named", () => {
    const result = polluted(6, () =>
      assertPayoutInvariance((input: typeof base) => [input.v], base, [
        { name: "bumps output", mutate: () => ({ v: 2 }) },
        { name: "changes nothing", mutate: (input) => ({ ...input }) },
        { name: "bumps again", mutate: () => ({ v: 3 }) },
      ]),
    );
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.scenario)).toEqual(["bumps output", "bumps again"]);
    expect(result.vacuous).toEqual(["changes nothing"]);
  });

  it("PASS: a run that ignores the mutated input still passes", () => {
    const result = polluted(6, () =>
      assertPayoutInvariance(() => ["x"], base, [{ name: "bump", mutate: () => ({ v: 2 }) }]),
    );
    expect(result.passed).toBe(true);
  });

  it("FLAG: assertNoPayoutImports still reports every offending file and line", () => {
    const offenses = polluted(6, () =>
      assertNoPayoutImports(
        {
          "a.ts": "const commission = 1;\nconst y = commission;\n",
          "b.ts": "const ok = 1;",
          "c.ts": "// fine\nlet x = commission;\n",
        },
        ["commission"],
      ),
    );
    expect(offenses.map((offense) => offense.file)).toEqual(["a.ts", "c.ts"]);
    expect(offenses[0]?.matches.map((match) => match.line)).toEqual([1, 2]);
  });

  it("FAIL: an in-place edit of the input is still caught when index writes are discarded", () => {
    const input = { n: 1, a: { x: 1 }, b: { y: 1 }, c: new Set([{ z: 1 }]) };
    const edit = (i: typeof input): string[] => {
      i.b.y = 2;
      return ["x"];
    };
    expect(() => polluted(6, () => assertPayoutInvariance(edit, input, [{ name: "s", mutate: (i) => ({ ...i, n: 2 }) }]))).toThrow(
      /modified baseInput in place/,
    );
  });
});

