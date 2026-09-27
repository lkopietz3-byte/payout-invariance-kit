import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertNoPayoutImports } from "../src/index";

// ---------------------------------------------------------------------------
// A bundler targeting a browser or a Workers runtime (esbuild/webpack with
// platform "browser", wrangler, etc.) resolves a static `import ... from
// "node:fs"` at BUNDLE time, before tree-shaking can decide the import is
// unreachable. That broke every consumer's build, even one that only ever
// used the path -> content MAP mode of assertNoPayoutImports and never
// touched the filesystem. See README.md, "Install", and the kit's
// package-polish notes.
// ---------------------------------------------------------------------------

describe("bundler portability: node:fs is never imported at the top level", () => {
  it("src/index.ts has no top-level `from \"node:fs\"` import", () => {
    const srcPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    const source = readFileSync(srcPath, "utf8");
    expect(source).not.toMatch(/^\s*import[^;]*from\s*["']node:fs["']/m);
  });

  it("the array (file-path) mode still reads real files from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "payout-invariance-kit-"));
    const file = join(dir, "rank.ts");
    writeFileSync(file, 'import { commission } from "./payout";\n', "utf8");
    const offenses = assertNoPayoutImports([file], ["commission"]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.file).toBe(file);
  });

  it("gives a clear error, not a raw ReferenceError, when process.getBuiltinModule is unavailable", () => {
    const original = process.getBuiltinModule;
    // Simulate a runtime without this Node 20.16+/22.3+ API (an older Node,
    // or a non-Node runtime that still defines `process` partially).
    // @ts-expect-error -- deleting a real method to simulate its absence
    delete process.getBuiltinModule;
    try {
      expect(() => assertNoPayoutImports(["some/file.ts"], ["commission"])).toThrow(
        /process\.getBuiltinModule/,
      );
    } finally {
      process.getBuiltinModule = original;
    }
  });

  it("the map mode never needs node:fs at all, even when process.getBuiltinModule is unavailable", () => {
    const original = process.getBuiltinModule;
    // @ts-expect-error -- deleting a real method to simulate its absence
    delete process.getBuiltinModule;
    try {
      const offenses = assertNoPayoutImports({ "a.ts": "const commission = 1;" }, ["commission"]);
      expect(offenses).toHaveLength(1);
    } finally {
      process.getBuiltinModule = original;
    }
  });
});
