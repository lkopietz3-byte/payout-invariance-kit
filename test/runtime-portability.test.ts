/**
 * The comparator and snapshot in runtimes that lack some built-ins (a
 * browser page without cross-origin isolation has no SharedArrayBuffer;
 * older engines lack WeakRef, FinalizationRegistry, Float16Array or the
 * RegExp `v` flag), values from another realm, and endless prototype
 * chains. The same file lives in both kits; only the import paths differ.
 */
import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import { deepEqual } from "../src/deepEqual";
import { snapshot } from "../src/snapshot";

type Modules = [typeof import("../src/deepEqual"), typeof import("../src/snapshot")];

async function loadWithout(globals: string[]): Promise<Modules> {
  for (const name of globals) vi.stubGlobal(name, undefined);
  vi.resetModules();
  return Promise.all([import("../src/deepEqual"), import("../src/snapshot")]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("runtimes that lack some built-ins", () => {
  it("loads and compares without SharedArrayBuffer, WeakRef, FinalizationRegistry, BigInt or Float16Array", async () => {
    const Float16 = Reflect.get(globalThis, "Float16Array") as (new (values: number[]) => object) | undefined;
    const float16 = Float16 ? new Float16([1]) : undefined;
    const [{ deepEqual: equal }, { snapshot: copy }] = await loadWithout([
      "SharedArrayBuffer",
      "WeakRef",
      "FinalizationRegistry",
      "BigInt",
      "Float16Array",
    ]);
    expect(equal(new Map([["a", 1]]), new Map([["a", 1]]))).toBe(true);
    expect(equal(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false);
    expect(equal(Object(1) as object, Object(1) as object)).toBe(true);
    expect(equal({ a: new Uint8Array([1]) }, { a: new Uint8Array([1]) })).toBe(true);
    expect(equal(new WeakMap(), new WeakMap())).toBe(false);
    const value = { list: [1, 2], at: new Date(3) };
    expect(equal(copy(value), value)).toBe(true);
    if (float16) expect(copy(float16)).toBe(float16); // no constructor to copy with: kept by reference
  });

  it("compares RegExp flags when the engine has no unicodeSets getter", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, "unicodeSets");
    if (descriptor) Reflect.deleteProperty(RegExp.prototype, "unicodeSets");
    try {
      const [{ deepEqual: equal }] = await loadWithout([]);
      expect(equal(/a/g, /a/g)).toBe(true);
      expect(equal(/a/g, /a/i)).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(RegExp.prototype, "unicodeSets", descriptor);
    }
  });
});

describe("values from another realm", () => {
  it("compares Errors, Maps and Dates created in another realm by content", () => {
    const [errorA, errorB, errorC] = runInNewContext("[new Error('x'), new Error('x'), new Error('y')]") as object[];
    expect(deepEqual(errorA, errorB)).toBe(true);
    expect(deepEqual(errorA, errorC)).toBe(false);
    const [mapA, mapB] = runInNewContext("[new Map([['a', 1]]), new Map([['a', 2]])]") as object[];
    expect(deepEqual(mapA, mapB)).toBe(false);
    const [dateA, dateB] = runInNewContext("[new Date(1), new Date(1)]") as object[];
    expect(deepEqual(dateA, dateB)).toBe(true);
    expect(deepEqual(snapshot(dateA), dateA)).toBe(true);
  });
});

describe("prototype chains", () => {
  it("treats an endless Proxy prototype chain as not comparable instead of hanging", () => {
    const endless = (): object => new Proxy({}, { getPrototypeOf: () => endless() });
    const value = endless();
    expect(deepEqual(value, endless())).toBe(false);
    expect(deepEqual(value, value)).toBe(true);
  });

  it("keeps the prototype of built-in subclasses in a snapshot", () => {
    class Registry extends Map<string, number> {}
    class Stamp extends Date {}
    class Pattern extends RegExp {}
    for (const value of [new Registry([["a", 1]]), new Stamp(5), new Pattern("a", "g")]) {
      const copy = snapshot(value);
      expect(Object.getPrototypeOf(copy)).toBe(Object.getPrototypeOf(value));
      expect(deepEqual(copy, value)).toBe(true);
    }
  });
});

describe("stack-trace switch during brand checks", () => {
  const original = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  afterEach(() => {
    if (original) Object.defineProperty(Error, "stackTraceLimit", original);
  });

  it("still classifies values when Error.stackTraceLimit is missing or frozen, and leaves it as it was", () => {
    Reflect.deleteProperty(Error, "stackTraceLimit");
    expect(deepEqual(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false);
    expect("stackTraceLimit" in Error).toBe(false);
    Object.defineProperty(Error, "stackTraceLimit", { value: 7, writable: false, configurable: true });
    expect(deepEqual(new Set([1]), new Set([2]))).toBe(false);
    expect((Error as { stackTraceLimit?: unknown }).stackTraceLimit).toBe(7);
  });

  it("restores Error.stackTraceLimit after a probe", () => {
    const before = (Error as { stackTraceLimit?: unknown }).stackTraceLimit;
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect((Error as { stackTraceLimit?: unknown }).stackTraceLimit).toBe(before);
  });
});
