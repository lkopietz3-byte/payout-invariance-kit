/**
 * Direct tests for the comparison and copy code shared with
 * mutation-invariance-kit (src/deepEqual.ts and src/snapshot.ts, kept
 * byte-identical). Covers array and typed array fast paths, Proxy key order,
 * getters read once, very wide and deep inputs, an Array.prototype setter,
 * and the orderSensitive option.
 */
import { describe, expect, it } from "vitest";

import { deepEqual } from "../src/index.js";
import { snapshot } from "../src/snapshot.js";

describe("shared comparison: fast paths, iteration, order option", () => {
  it("probe: a hole in the middle of a long array is still a difference", () => {
    const a = Array.from({ length: 1000 }, (_, i) => i);
    const b = Array.from({ length: 1000 }, (_, i) => i);
    // eslint-disable-next-line @typescript-eslint/no-array-delete -- a hole is the point
    delete b[500];
    expect(deepEqual(a, b)).toBe(false);
    expect(deepEqual(b, a)).toBe(false);
    const c = Array.from({ length: 1000 }, (_, i) => i);
    // eslint-disable-next-line @typescript-eslint/no-array-delete -- a hole is the point
    delete c[500];
    expect(deepEqual(b, c)).toBe(true);
  });
  it("probe: undefined elements are not holes in either direction", () => {
    const a = new Array<unknown>(100).fill(undefined);
    const b = new Array<unknown>(100);
    expect(deepEqual(a, b)).toBe(false);
    expect(deepEqual(b, a)).toBe(false);
  });
  it("probe: a hole plus an extra key has the same key count as a dense array and must still differ", () => {
    // 3 elements, one hole, one extra key: Object.keys length equals the array length.
    const sneaky = Object.assign([1, , 3], { x: 1 }); // eslint-disable-line no-sparse-arrays
    expect(deepEqual(sneaky, [1, 2, 3])).toBe(false);
    expect(deepEqual([1, 2, 3], sneaky)).toBe(false);
    expect(deepEqual(sneaky, Object.assign([1, , 3], { x: 1 }))).toBe(true); // eslint-disable-line no-sparse-arrays
    expect(deepEqual(sneaky, Object.assign([1, , 3], { x: 2 }))).toBe(false); // eslint-disable-line no-sparse-arrays
  });
  it("probe: a non-enumerable element plus an enumerable extra key must not look dense", () => {
    const sneaky = [1, 2, 3];
    Object.defineProperty(sneaky, 1, { value: 2, enumerable: false });
    Object.assign(sneaky, { x: 1 });
    expect(deepEqual(sneaky, [1, 2, 3])).toBe(false);
    expect(deepEqual([1, 2, 3], sneaky)).toBe(false);
  });
  it("probe: a non-enumerable element is ignored exactly as before (equal to a hole)", () => {
    const hidden = [1, 2, 3];
    Object.defineProperty(hidden, 1, { value: 2, enumerable: false });
    expect(deepEqual(hidden, [1, , 3])).toBe(true); // eslint-disable-line no-sparse-arrays
    expect(deepEqual(hidden, [1, 2, 3])).toBe(false);
  });
  it("probe: an enumerable symbol key on an otherwise dense array counts", () => {
    const s = Symbol("meta");
    expect(deepEqual(Object.assign([1, 2], { [s]: "a" }), [1, 2])).toBe(false);
    expect(deepEqual(Object.assign([1, 2], { [s]: "a" }), Object.assign([1, 2], { [s]: "a" }))).toBe(true);
    expect(deepEqual(Object.assign([1, 2], { [s]: "a" }), Object.assign([1, 2], { [s]: "b" }))).toBe(false);
  });
  it("probe: arrays of different lengths, and same elements with a different prototype", () => {
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    class Rank extends Array<number> {}
    expect(deepEqual(Rank.from([1, 2]), [1, 2])).toBe(false);
    expect(deepEqual(Rank.from([1, 2]), Rank.from([1, 2]))).toBe(true);
  });
  it("probe: a getter element is read, and the value it returns is what is compared", () => {
    let reads = 0;
    const a = [1, 2];
    Object.defineProperty(a, 0, { get: () => (reads += 1), enumerable: true });
    const b = [1, 2];
    expect(deepEqual(a, b)).toBe(true); // first read returns 1
    expect(deepEqual(a, b)).toBe(false); // now returns 2
  });
  it("probe: array elements that are objects, NaN, -0, nested holes", () => {
    expect(deepEqual([{ a: 1 }, NaN], [{ a: 1 }, NaN])).toBe(true);
    expect(deepEqual([{ a: 1 }, NaN], [{ a: 2 }, NaN])).toBe(false);
    expect(deepEqual([0], [-0])).toBe(false);
    expect(deepEqual([[1, , 3]], [[1, undefined, 3]])).toBe(false); // eslint-disable-line no-sparse-arrays
  });
  it("probe: typed arrays: element type, length, NaN, -0, and extra keys", () => {
    expect(deepEqual(new Float64Array([NaN]), new Float64Array([NaN]))).toBe(true);
    expect(deepEqual(new Float64Array([0]), new Float64Array([-0]))).toBe(false);
    expect(deepEqual(new Uint8Array([1]), new Int8Array([1]))).toBe(false);
    expect(deepEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
    expect(deepEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
    expect(deepEqual(Object.assign(new Uint8Array(3), { label: "a" }), new Uint8Array(3))).toBe(false);
    expect(deepEqual(new Uint8Array(3), Object.assign(new Uint8Array(3), { label: "a" }))).toBe(false);
    expect(deepEqual(Object.assign(new Uint8Array(3), { label: "a" }), Object.assign(new Uint8Array(3), { label: "a" }))).toBe(true);
    const s = Symbol("s");
    expect(deepEqual(Object.assign(new Uint8Array(3), { [s]: 1 }), new Uint8Array(3))).toBe(false);
  });
  it("probe: a typed array's extra key is found even when the extra key looks like an index past the end", () => {
    const a = Object.assign(new Uint8Array(2), { "5": 1 }); // ignored by typed arrays: not a property
    expect(deepEqual(a, new Uint8Array(2))).toBe(true);
    expect(Object.keys(a)).toEqual(["0", "1"]);
  });
  it("probe: a typed array with a detached buffer has no elements and no extra keys to compare", () => {
    const make = () => new Uint8Array(new ArrayBuffer(4));
    const a = make();
    const b = make();
    structuredClone(a.buffer, { transfer: [a.buffer] });
    expect(deepEqual(a, b)).toBe(false);
    const c = make();
    structuredClone(c.buffer, { transfer: [c.buffer] });
    expect(deepEqual(a, c)).toBe(true);
  });
  it("probe: a non-enumerable extra key on a typed array is ignored as before", () => {
    const a = new Uint8Array(3);
    Object.defineProperty(a, "hidden", { value: 1, enumerable: false });
    expect(deepEqual(a, new Uint8Array(3))).toBe(true);
  });
  it("probe: the iteration order option does not change which values are equal otherwise", () => {
    const left = { a: [1, 2, { x: new Set([1, 2]) }], b: new Map([[1, "a"]]) };
    const right = { b: new Map([[1, "a"]]), a: [1, 2, { x: new Set([2, 1]) }] };
    expect(deepEqual(left, right)).toBe(true);
    expect(deepEqual(left, right, { orderSensitive: true })).toBe(false);
    const sameOrder = { a: [1, 2, { x: new Set([1, 2]) }], b: new Map([[1, "a"]]) };
    expect(deepEqual(left, sameOrder, { orderSensitive: true })).toBe(true);
  });
  it("probe: orderSensitive on a Set of objects compares members position by position", () => {
    const x = new Set([{ id: 1 }, { id: 2 }]);
    expect(deepEqual(x, new Set([{ id: 1 }, { id: 2 }]), { orderSensitive: true })).toBe(true);
    expect(deepEqual(x, new Set([{ id: 2 }, { id: 1 }]), { orderSensitive: true })).toBe(false);
    expect(deepEqual(x, new Set([{ id: 1 }, { id: 3 }]), { orderSensitive: true })).toBe(false);
  });
  it("probe: orderSensitive covers symbol-key order and array extra-key order", () => {
    const s1 = Symbol("1");
    const s2 = Symbol("2");
    expect(deepEqual({ [s1]: 1, [s2]: 2 }, { [s2]: 2, [s1]: 1 })).toBe(true);
    expect(deepEqual({ [s1]: 1, [s2]: 2 }, { [s2]: 2, [s1]: 1 }, { orderSensitive: true })).toBe(false);
    expect(deepEqual(Object.assign([1], { p: 1, q: 2 }), Object.assign([1], { q: 2, p: 1 }), { orderSensitive: true })).toBe(false);
  });
  it("probe: orderSensitive keeps numeric-like keys equal (the engine always orders them)", () => {
    expect(deepEqual({ 2: "b", 1: "a" }, { 1: "a", 2: "b" }, { orderSensitive: true })).toBe(true);
  });
  it("probe: orderSensitive sees through an object key order flip inside an Error cause", () => {
    const a = new Error("e", { cause: { x: 1, y: 2 } });
    const b = new Error("e", { cause: { y: 2, x: 1 } });
    expect(deepEqual(a, b)).toBe(true);
    expect(deepEqual(a, b, { orderSensitive: true })).toBe(false);
  });
  it("probe: cyclic Map/Set/array structures still terminate and compare, including when ordered", () => {
    const make = () => {
      const m = new Map<string, unknown>();
      m.set("self", m);
      const s = new Set<unknown>();
      s.add(s);
      return { m, s, arr: [m, s] };
    };
    expect(deepEqual(make(), make())).toBe(true);
    expect(deepEqual(make(), make(), { orderSensitive: true })).toBe(true);
  });
  it("probe: a failed Set-member trial does not poison a later match (shared sub-objects)", () => {
    const shared = { k: 1 };
    const left = new Set([{ a: shared, t: 1 }, { a: shared, t: 2 }]);
    const right = new Set([{ a: { k: 1 }, t: 2 }, { a: { k: 1 }, t: 1 }]);
    expect(deepEqual(left, right)).toBe(true);
    const wrong = new Set([{ a: { k: 1 }, t: 2 }, { a: { k: 2 }, t: 1 }]);
    expect(deepEqual(left, wrong)).toBe(false);
  });
  it("probe: the same sub-object reached through two paths is compared against both partners", () => {
    const sharedA = { v: 1 };
    const left = { p: sharedA, q: sharedA };
    const right = { p: { v: 1 }, q: { v: 2 } };
    expect(deepEqual(left, right)).toBe(false);
    expect(deepEqual(right, left)).toBe(false);
    expect(deepEqual(left, { p: { v: 1 }, q: { v: 1 } })).toBe(true);
  });
});

describe("shared comparison: more probes", () => {
  it("probe: a Proxy over an array that reports an extra enumerable key is not mistaken for a clean array", () => {
    const target = [1, 2];
    const lying = new Proxy(target, {
      ownKeys: () => ["0", "1", "extra", "length"],
      getOwnPropertyDescriptor: (_, key) =>
        key === "extra"
          ? { value: 9, enumerable: true, configurable: true, writable: true }
          : Reflect.getOwnPropertyDescriptor(target, key),
      get: (_, key): unknown => (key === "extra" ? 9 : (Reflect.get(target, key) as unknown)),
    });
    expect(deepEqual(lying, [1, 2])).toBe(false);
    expect(deepEqual([1, 2], lying)).toBe(false);
  });
  it("probe: a transparent Proxy over an array equals the array", () => {
    expect(deepEqual(new Proxy([1, 2, 3], {}), [1, 2, 3])).toBe(true);
    expect(deepEqual(new Proxy([1, 2, 3], {}), [1, 2, 4])).toBe(false);
  });
  it("probe: frozen arrays compare like any other", () => {
    expect(deepEqual(Object.freeze([1, { a: 2 }]), Object.freeze([1, { a: 2 }]))).toBe(true);
    expect(deepEqual(Object.freeze([1, { a: 2 }]), [1, { a: 3 }])).toBe(false);
  });
  it("probe: a getter element that throws propagates; it is not turned into 'different'", () => {
    const bad = [1, 2];
    Object.defineProperty(bad, 1, {
      get() {
        throw new Error("getter failed");
      },
      enumerable: true,
    });
    expect(() => deepEqual(bad, [1, 2])).toThrow(/getter failed/);
    expect(() => deepEqual([1, 2], bad)).toThrow(/getter failed/);
  });
  it("probe: arguments objects and arrays do not equal each other", () => {
    const makeArguments = function (): IArguments {
      // eslint-disable-next-line prefer-rest-params -- the only way to make an arguments object
      return arguments;
    };
    expect(deepEqual(makeArguments(), [])).toBe(false);
    expect(deepEqual(makeArguments(), makeArguments())).toBe(true);
  });
  it("probe: orderSensitive Map with array keys and nested Sets compares positionally", () => {
    const make = (flip: boolean) =>
      new Map<unknown, unknown>(
        flip
          ? [
              [[2], new Set([3, 4])],
              [[1], new Set([1, 2])],
            ]
          : [
              [[1], new Set([1, 2])],
              [[2], new Set([3, 4])],
            ],
      );
    expect(deepEqual(make(false), make(true))).toBe(true);
    expect(deepEqual(make(false), make(true), { orderSensitive: true })).toBe(false);
    expect(deepEqual(make(false), make(false), { orderSensitive: true })).toBe(true);
  });
  it("probe: cyclic objects inside Sets match one to one even after a failed candidate", () => {
    const node = (id: number) => {
      const o: { id: number; self?: unknown } = { id };
      o.self = o;
      return o;
    };
    expect(deepEqual(new Set([node(1), node(2)]), new Set([node(2), node(1)]))).toBe(true);
    expect(deepEqual(new Set([node(1), node(2)]), new Set([node(2), node(3)]))).toBe(false);
  });
  it("probe: a long run of equal Set members with one odd one out", () => {
    const left = new Set(Array.from({ length: 300 }, (_, i) => ({ i: i % 3 })));
    const right = new Set(Array.from({ length: 300 }, (_, i) => ({ i: i === 299 ? 7 : i % 3 })));
    expect(deepEqual(left, right)).toBe(false);
    expect(deepEqual(left, new Set(Array.from({ length: 300 }, (_, i) => ({ i: (299 - i) % 3 }))))).toBe(true);
  });
  it("probe: options must be a plain object", () => {
    expect(() => deepEqual(1, 1, null as never)).toThrow(TypeError);
    expect(() => deepEqual(1, 1, [] as never)).toThrow(TypeError);
    expect(() => deepEqual(1, 1, new Map() as never)).toThrow(TypeError);
    expect(deepEqual(1, 1, {})).toBe(true);
  });
});

describe("shared comparison: wide inputs, Proxy key order, getters read once", { timeout: 180_000 }, () => {
  /** A Proxy over `target` whose ownKeys lists the index keys in reverse order. */
  const reverseKeyed = <T extends unknown[]>(target: T): T =>
    new Proxy(target, { ownKeys: () => [...target.keys()].map(String).reverse().concat("length") });

  it("P1: an array Proxy that lists its keys out of order is compared by index, not by key order", () => {
    const proxy = reverseKeyed([1, 2]);
    expect(deepEqual(proxy, [2, 1])).toBe(false);
    expect(deepEqual([2, 1], proxy)).toBe(false);
    expect(deepEqual(proxy, [1, 2])).toBe(true);
    expect(deepEqual([1, 2], proxy)).toBe(true);
    expect(deepEqual(reverseKeyed([1, 2]), reverseKeyed([1, 2]))).toBe(true);
    expect(deepEqual(reverseKeyed([1, 2]), reverseKeyed([2, 1]))).toBe(false);
  });
  /** An accessor whose first read returns `first` and every later read returns "later". */
  const flaky = (target: object, key: string, first: string): { reads: () => number } => {
    let reads = 0;
    Object.defineProperty(target, key, {
      get: () => {
        reads += 1;
        return reads === 1 ? first : "later";
      },
      enumerable: true,
      configurable: true,
    });
    return { reads: () => reads };
  };

  it("P2: an extra getter key on an array is read once per comparison (first reads x and y differ)", () => {
    const a = [1, 2];
    const b = [1, 2];
    const readsA = flaky(a, "label", "x");
    const readsB = flaky(b, "label", "y");
    expect(deepEqual(a, b)).toBe(false);
    expect(readsA.reads()).toBe(1);
    expect(readsB.reads()).toBe(1);
  });
  it("P2: an extra getter key on a typed array is read once per comparison", () => {
    const a = new Uint8Array(2);
    const b = new Uint8Array(2);
    const readsA = flaky(a, "label", "x");
    const readsB = flaky(b, "label", "y");
    expect(deepEqual(a, b)).toBe(false);
    expect(readsA.reads()).toBe(1);
    expect(readsB.reads()).toBe(1);
  });
  it("P2: an element getter on an array with a hole is read once per comparison", () => {
    const make = (first: string) => {
      const array: unknown[] = [0, 1, 2];
      // eslint-disable-next-line @typescript-eslint/no-array-delete -- a hole is the point
      delete array[1];
      const probe = flaky(array, "0", first);
      return { array, probe };
    };
    const a = make("x");
    const b = make("y");
    expect(deepEqual(a.array, b.array)).toBe(false);
    expect(a.probe.reads()).toBe(1);
    expect(b.probe.reads()).toBe(1);
  });
  it("P2: the copy reads an extra getter key once", () => {
    const array = [1, 2];
    const probe = flaky(array, "label", "x");
    const copy = snapshot(array) as unknown as { label: string };
    expect(probe.reads()).toBe(1);
    expect(copy.label).toBe("x");
  });
  it("P4: Set(Set(array of 150,000 objects)) compares without exceeding the argument limit", () => {
    const make = (last: number) =>
      new Set([new Set([Array.from({ length: 150_000 }, (_, i) => ({ i: i === 149_999 ? last : i }))])]);
    expect(deepEqual(make(149_999), make(149_999))).toBe(true);
    expect(deepEqual(make(149_999), make(-1))).toBe(false);
  });
});

describe("shared comparison: inherited accessors", { timeout: 180_000 }, () => {
  it("P2-1: an Array.prototype index setter cannot swallow the elements of a compared array", () => {
    const left = Array.from({ length: 101 }, () => 0);
    const right = Array.from({ length: 101 }, () => 0);
    right[100] = 1;
    // Own data properties are created for every element, so an inherited
    // accessor at index 100 (setter discards, getter returns 0) is never reached.
    Object.defineProperty(Array.prototype, 100, { get: () => 0, set: () => undefined, configurable: true });
    let equal: boolean;
    let copyKeepsLast: unknown;
    try {
      equal = deepEqual(left, right);
      copyKeepsLast = (snapshot(right) as unknown[])[100];
    } finally {
      delete (Array.prototype as unknown as Record<number, unknown>)[100];
    }
    expect(equal).toBe(false);
    expect(copyKeepsLast).toBe(1);
  });
});

describe("shared snapshot: direct copy checks", { timeout: 180_000 }, () => {
  it("copy: a null-prototype Map or Set is copied, equal to the original, and independent of it", () => {
    const map = Object.setPrototypeOf(new Map([["a", 1]]), null) as Map<string, number>;
    const set = Object.setPrototypeOf(new Set([1, 2]), null) as Set<number>;
    const copy = snapshot({ map, set });
    expect(deepEqual(copy, { map, set })).toBe(true);
    Map.prototype.set.call(map, "b", 2);
    expect(deepEqual(copy, { map, set })).toBe(false);
  });

  it("copy: a read-only Map or Set subclass is copied without calling its overrides", () => {
    class ReadOnlyMap extends Map<string, number> {
      override set(): this {
        throw new Error("read-only map");
      }
    }
    class ReadOnlySet extends Set<number> {
      override add(): this {
        throw new Error("read-only set");
      }
    }
    const map = new ReadOnlyMap();
    Map.prototype.set.call(map, "a", 1);
    const set = new ReadOnlySet();
    Set.prototype.add.call(set, 1);
    const copy = snapshot({ map, set });
    expect(deepEqual(copy, { map, set })).toBe(true);
  });

  it("copy: the copy of a dense array does not share element objects with the original", () => {
    const rows = [{ v: 1 }, { v: 2 }];
    const copy = snapshot(rows);
    rows[1]!.v = 99;
    expect(copy[1]!.v).toBe(2);
    expect(deepEqual(copy, rows)).toBe(false);
  });

  it("copy: a 1,000-element array with a hole and an extra key detects an in-place edit of each part", () => {
    const make = () => {
      const a: unknown[] = Array.from({ length: 1000 }, (_, i) => i);
      // eslint-disable-next-line @typescript-eslint/no-array-delete -- a hole is the point
      delete a[10];
      return Object.assign(a, { tag: "t" });
    };
    const edits: [string, (a: unknown[]) => void][] = [
      ["element", (a) => void (a[999] = -1)],
      ["fill the hole", (a) => void (a[10] = 10)],
      ["extra key", (a) => void Object.assign(a, { tag: "u" })],
      ["push", (a) => void a.push(1)],
    ];
    for (const [label, edit] of edits) {
      const live = make();
      const copy = snapshot(live);
      expect(deepEqual(copy, live), label).toBe(true);
      edit(live);
      expect(deepEqual(copy, live), label).toBe(false);
    }
  });

  it("copy: a typed array with 150,000 named metadata keys compares and copies", () => {
    const make = () => {
      const typed = new Uint8Array(3);
      for (let i = 0; i < 150_000; i += 1) Object.defineProperty(typed, `k${i}`, { value: i, enumerable: true, writable: true, configurable: true });
      return typed;
    };
    const live = make();
    expect(deepEqual(make(), live)).toBe(true);
    const copy = snapshot(live);
    expect(deepEqual(copy, live)).toBe(true);
    Object.defineProperty(live, "k149999", { value: -1, enumerable: true, writable: true, configurable: true });
    expect(deepEqual(copy, live)).toBe(false);
  });

  it("deep nesting: identical chains of 100,000 levels are equal and copy without recursion", () => {
    const chain = (depth: number, leaf: number): unknown => {
      let node: unknown = { leaf };
      for (let i = 0; i < depth; i += 1) node = { next: node };
      return node;
    };
    const arrayChain = (depth: number, leaf: number): unknown => {
      let node: unknown = [leaf];
      for (let i = 0; i < depth; i += 1) node = [node];
      return node;
    };
    for (const make of [chain, arrayChain]) {
      expect(deepEqual(make(100_000, 1), make(100_000, 1))).toBe(true);
      expect(deepEqual(make(100_000, 1), make(100_000, 2))).toBe(false);
      expect(deepEqual(snapshot(make(100_000, 1)), make(100_000, 1))).toBe(true);
    }
  });
});
