/**
 * Shared regression suite: values that look like a built-in (by prototype,
 * from this realm or another, by `constructor`, or by
 * `Object.prototype.toString`) but fail the built-in's brand check. They must
 * be "not comparable" (equal only to themselves), never compared as ordinary
 * objects. Plain objects and ordinary class instances must not change. The
 * same file lives in payout-invariance-kit and mutation-invariance-kit; only
 * the two import lines differ.
 */
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { deepEqual } from "../src/deepEqual";
import { snapshot } from "../src/snapshot";

const realm: object = createContext({});
/** Evaluate `code` in a second realm (its own Date, Map, Error, ...). */
const inRealm = (code: string): object => runInContext(code, realm) as object;

describe("a Proxy around a built-in from another realm is not comparable", () => {
  const cases: [string, string, string][] = [
    ["Date", "new Proxy(new Date(1), {})", "new Proxy(new Date(2), {})"],
    ["Number", "new Proxy(new Number(1), {})", "new Proxy(new Number(2), {})"],
    ["String", "new Proxy(new String('a'), {})", "new Proxy(new String('b'), {})"],
    ["Boolean", "new Proxy(new Boolean(true), {})", "new Proxy(new Boolean(false), {})"],
    ["RegExp", "new Proxy(/a/, {})", "new Proxy(/b/, {})"],
    ["Map", "new Proxy(new Map([[1, 1]]), {})", "new Proxy(new Map([[1, 2]]), {})"],
    ["Set", "new Proxy(new Set([1]), {})", "new Proxy(new Set([2]), {})"],
    ["Uint8Array", "new Proxy(new Uint8Array([1]), {})", "new Proxy(new Uint8Array([2]), {})"],
  ];

  it.each(cases)("%s: different contents compare different", (_name, left, right) => {
    expect(deepEqual(inRealm(left), inRealm(right))).toBe(false);
  });

  it.each(cases)("%s: even equal contents compare different, and each equals itself", (_name, left) => {
    const proxy = inRealm(left);
    expect(deepEqual(proxy, inRealm(left))).toBe(false);
    expect(deepEqual(proxy, proxy)).toBe(true);
    expect(snapshot(proxy)).toBe(proxy);
  });

  it("does not equal the real built-in it wraps", () => {
    expect(deepEqual(inRealm("new Proxy(new Date(1), {})"), inRealm("new Date(1)"))).toBe(false);
  });
});

describe("a Proxy around a built-in from this realm is not comparable", () => {
  it.each([
    ["Date", (): object => new Proxy(new Date(1), {})],
    ["Number", (): object => new Proxy(new Number(1), {})],
    ["String", (): object => new Proxy(new String("a"), {})],
    ["Boolean", (): object => new Proxy(new Boolean(true), {})],
    ["RegExp", (): object => new Proxy(/a/, {})],
    ["Set", (): object => new Proxy(new Set([1]), {})],
    ["Float64Array", (): object => new Proxy(new Float64Array([1]), {})],
  ])("%s", (_name, make) => {
    const proxy = make();
    expect(deepEqual(proxy, make())).toBe(false);
    expect(deepEqual(proxy, proxy)).toBe(true);
  });

  it("sees through a getPrototypeOf trap that hides the built-in (its constructor still says Date)", () => {
    const disguised = (time: number): object =>
      new Proxy(new Date(time), { getPrototypeOf: () => Object.prototype });
    expect(deepEqual(disguised(1), disguised(2))).toBe(false);
    expect(deepEqual(disguised(1), disguised(1))).toBe(false);
    expect(deepEqual(disguised(1), {})).toBe(false);
  });

  it("does not compare an object whose Object.prototype.toString claims a built-in as a plain object", () => {
    const claimsDate = (): object =>
      new Proxy({}, { get: (target, key) => (key === Symbol.toStringTag ? "Date" : Reflect.get(target, key) as unknown) });
    expect(Object.prototype.toString.call(claimsDate())).toBe("[object Date]");
    expect(deepEqual(claimsDate(), claimsDate())).toBe(false);
    expect(deepEqual({}, claimsDate())).toBe(false);
  });
});

describe("fake subclasses of another realm's built-ins are not comparable", () => {
  it("an object that only inherits from another realm's Date.prototype or Number.prototype", () => {
    const dateProto = inRealm("Date.prototype");
    expect(deepEqual(Object.create(dateProto) as object, Object.create(dateProto) as object)).toBe(false);
    const numberProto = inRealm("Number.prototype");
    expect(deepEqual(Object.create(numberProto) as object, Object.create(numberProto) as object)).toBe(false);
    // The prototype object itself is not comparable either.
    expect(deepEqual(dateProto, inRealm("Date.prototype"))).toBe(true); // same object
    expect(deepEqual(dateProto, Object.create(null) as object)).toBe(false);
  });

  it("an old-style subclass whose instances never got the internal slot", () => {
    const Fake = inRealm("(() => { function FakeDate() { this.shown = 1; } FakeDate.prototype = Object.create(Date.prototype); return FakeDate; })()");
    const make = (): object => new (Fake as new () => object)();
    expect(deepEqual(make(), make())).toBe(false);
  });

  it("a real subclass instance (constructed through super) is still compared by content", () => {
    const Sub = inRealm("class Sub extends Date {}; Sub");
    const make = (time: number): object => new (Sub as new (time: number) => object)(time);
    expect(deepEqual(make(1), make(1))).toBe(true);
    expect(deepEqual(make(1), make(2))).toBe(false);
  });
});

describe("Error state is ordinary properties, so an Error-like value is compared by them", () => {
  it("a Proxy around another realm's Error is compared by name, message and cause", () => {
    expect(deepEqual(inRealm("new Proxy(new Error('a'), {})"), inRealm("new Proxy(new Error('b'), {})"))).toBe(false);
    expect(deepEqual(inRealm("new Proxy(new Error('a'), {})"), inRealm("new Proxy(new Error('a'), {})"))).toBe(true);
    expect(deepEqual(inRealm("new Proxy(new TypeError('a'), {})"), inRealm("new Proxy(new TypeError('a', { cause: 1 }), {})"))).toBe(
      false,
    );
  });

  it("a Proxy around this realm's Error is compared the same way", () => {
    expect(deepEqual(new Proxy(new Error("a"), {}), new Proxy(new Error("b"), {}))).toBe(false);
    expect(deepEqual(new Proxy(new Error("a"), {}), new Proxy(new Error("a"), {}))).toBe(true);
  });

  it("a Proxy whose getPrototypeOf trap hides an Error is not comparable", () => {
    const hidden = (message: string): object => new Proxy(new Error(message), { getPrototypeOf: () => Object.prototype });
    expect(deepEqual(hidden("a"), hidden("a"))).toBe(false);
  });
});

describe("plain objects and ordinary class instances are unchanged", () => {
  it("plain and null-prototype objects, from this realm or another", () => {
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    const bare = (): object => Object.assign(Object.create(null) as object, { a: 1 });
    expect(deepEqual(bare(), bare())).toBe(true);
    expect(deepEqual(inRealm("({ a: 1 })"), inRealm("({ a: 1 })"))).toBe(true);
    expect(deepEqual(inRealm("({ a: 1 })"), inRealm("({ a: 2 })"))).toBe(false);
  });

  it("class instances with public fields", () => {
    class Ranked {
      constructor(public ids: string[]) {}
    }
    expect(deepEqual(new Ranked(["a"]), new Ranked(["a"]))).toBe(true);
    expect(deepEqual(new Ranked(["a"]), new Ranked(["b"]))).toBe(false);
    expect(snapshot(new Ranked(["a"]))).toEqual(new Ranked(["a"]));
  });

  it("a user class that happens to be named like a built-in", () => {
    const TileMap = class Map {
      constructor(public tiles: number[]) {}
    };
    const DateLike = class Date {
      constructor(public day: string) {}
    };
    expect(TileMap.name).toBe("Map");
    expect(deepEqual(new TileMap([1]), new TileMap([1]))).toBe(true);
    expect(deepEqual(new TileMap([1]), new TileMap([2]))).toBe(false);
    expect(deepEqual(new DateLike("mon"), new DateLike("mon"))).toBe(true);
  });

  it("a plain object that stores a built-in constructor under the key 'constructor'", () => {
    expect(deepEqual({ constructor: Map }, { constructor: Map })).toBe(true);
    expect(deepEqual({ constructor: Map }, { constructor: Set })).toBe(false);
  });

  it("a Proxy around a plain object is still compared through its traps", () => {
    expect(deepEqual(new Proxy({ a: 1 }, {}), new Proxy({ a: 1 }, {}))).toBe(true);
    expect(deepEqual(new Proxy({ a: 1 }, {}), new Proxy({ a: 2 }, {}))).toBe(false);
  });

  it("real built-ins from another realm are still compared by content", () => {
    expect(deepEqual(inRealm("new Date(1)"), inRealm("new Date(1)"))).toBe(true);
    expect(deepEqual(inRealm("new Date(1)"), inRealm("new Date(2)"))).toBe(false);
    expect(deepEqual(inRealm("new Number(1)"), inRealm("new Number(2)"))).toBe(false);
    expect(deepEqual(inRealm("new Error('a')"), inRealm("new Error('b')"))).toBe(false);
    expect(deepEqual(inRealm("new Error('a')"), inRealm("new Error('a')"))).toBe(true);
  });
});
