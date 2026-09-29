/**
 * Shared regression suite for the comparator (`deepEqual.ts`) and the
 * in-place-edit snapshot (`snapshot.ts`). The same file lives in
 * payout-invariance-kit and mutation-invariance-kit; only the two import
 * lines differ.
 *
 * Built-ins must be recognized by what they are (intrinsic brand checks),
 * not by what they say (`Symbol.toStringTag`, own methods or getters), and
 * a snapshot must keep everything the comparator looks at.
 */
import { describe, expect, it } from "vitest";

import { deepEqual } from "../src/deepEqual";
import { snapshot } from "../src/snapshot";

const hide = <T extends object>(value: T, key: PropertyKey, descriptor: PropertyDescriptor): T =>
  Object.defineProperty(value, key, { configurable: true, ...descriptor });

/** Detach a buffer (structuredClone transfer works on every supported Node, unlike ArrayBuffer#transfer). */
const detach = (buffer: ArrayBuffer): void => void structuredClone(buffer, { transfer: [buffer] });

const masked = <T extends object>(value: T, enumerable: boolean, tag: unknown = undefined): T =>
  hide(value, Symbol.toStringTag, { value: tag, enumerable, writable: true });

describe("built-ins are recognized by brand, not by their tag", () => {
  it("compares Maps by content when an own Symbol.toStringTag masks them (MIK-F002a, PIK-001 R01)", () => {
    for (const enumerable of [true, false]) {
      for (const tag of [undefined, "Object", "Map", 7]) {
        const a = masked(new Map([["rank", 0]]), enumerable, tag);
        const b = masked(new Map([["rank", 100]]), enumerable, tag);
        const c = masked(new Map([["rank", 0]]), enumerable, tag);
        expect(deepEqual(a, b)).toBe(false);
        expect(deepEqual(a, c)).toBe(true);
      }
    }
  });

  it("compares masked Sets by content", () => {
    const a = masked(new Set([1]), true);
    expect(deepEqual(a, masked(new Set([2]), true))).toBe(false);
    expect(deepEqual(a, masked(new Set([1]), true))).toBe(true);
  });

  it("keeps different WeakMaps unequal when their tag is masked (PIK-001 R03)", () => {
    const a = masked(new WeakMap(), true);
    const b = masked(new WeakMap(), true);
    expect(deepEqual(a, b)).toBe(false);
    expect(deepEqual(a, a)).toBe(true);
    expect(deepEqual(masked(new WeakSet(), false), masked(new WeakSet(), false))).toBe(false);
    expect(deepEqual(new WeakRef({}), new WeakRef({}))).toBe(false);
  });

  it("keeps masked Promises and prototype-swapped WeakMaps unequal", () => {
    expect(deepEqual(masked(Promise.resolve(1), true), masked(Promise.resolve(1), true))).toBe(false);
    const a = Object.setPrototypeOf(new WeakMap(), Object.prototype) as object;
    const b = Object.setPrototypeOf(new WeakMap(), Object.prototype) as object;
    expect(deepEqual(a, b)).toBe(false);
  });

  it("does not treat an object that only inherits from a built-in prototype as that built-in", () => {
    const fakeMap = Object.create(Map.prototype) as object;
    const fakeDate = Object.create(Date.prototype) as object;
    expect(deepEqual(fakeMap, Object.create(Map.prototype))).toBe(false);
    expect(deepEqual(fakeDate, Object.create(Date.prototype))).toBe(false);
    expect(deepEqual(new Map(), fakeMap)).toBe(false);
  });

  it("treats a Proxy around a built-in as not comparable, except to itself", () => {
    const proxy = new Proxy(new Map([["a", 1]]), {});
    expect(deepEqual(proxy, new Proxy(new Map([["a", 1]]), {}))).toBe(false);
    expect(deepEqual(proxy, new Map([["a", 1]]))).toBe(false);
    expect(deepEqual(proxy, proxy)).toBe(true);
    const dateProxy = new Proxy(new Date(0), {});
    expect(deepEqual(dateProxy, new Proxy(new Date(1), {}))).toBe(false);
  });

  it("returns false instead of throwing for a revoked Proxy", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(deepEqual(proxy, {})).toBe(false);
    expect(deepEqual({}, proxy)).toBe(false);
    expect(deepEqual(proxy, proxy)).toBe(true);
    expect(snapshot(proxy)).toBe(proxy);
  });

  it("never runs a Symbol.toStringTag getter to classify a value", () => {
    let calls = 0;
    class Tagged {
      get [Symbol.toStringTag](): string {
        calls += 1;
        throw new Error("tag getter ran");
      }
    }
    expect(deepEqual(new Tagged(), new Tagged())).toBe(false);
    expect(snapshot(new Tagged())).toBeInstanceOf(Tagged);
    expect(calls).toBe(0);
  });
});

describe("built-in content is read through intrinsics, not overridable methods", () => {
  it("reads a Date's time value even when getTime is overridden (MIK-F002b)", () => {
    class Frozen extends Date {
      override getTime(): number {
        return 0;
      }
      override valueOf(): number {
        return 0;
      }
    }
    expect(deepEqual(new Frozen(1), new Frozen(2))).toBe(false);
    expect(deepEqual(new Frozen(5), new Frozen(5))).toBe(true);
    const shadowed = hide(new Date(1), "getTime", { value: () => 2 });
    expect(deepEqual(shadowed, hide(new Date(2), "getTime", { value: () => 2 }))).toBe(false);
  });

  it("reads boxed primitives' own value even when valueOf is overridden (MIK-F002c)", () => {
    class Zero extends Number {
      override valueOf(): number {
        return 0;
      }
    }
    expect(deepEqual(new Zero(1), new Zero(2))).toBe(false);
    expect(deepEqual(new Zero(3), new Zero(3))).toBe(true);
    const lie = (value: object): object => hide(value, "valueOf", { value: () => "same" });
    expect(deepEqual(lie(Object("a") as object), lie(Object("b") as object))).toBe(false);
    expect(deepEqual(lie(Object(true) as object), lie(Object(false) as object))).toBe(false);
    expect(deepEqual(lie(Object(1n) as object), lie(Object(2n) as object))).toBe(false);
    const symbol = Symbol("s");
    expect(deepEqual(lie(Object(symbol) as object), lie(Object(Symbol("s")) as object))).toBe(false);
    expect(deepEqual(Object(symbol) as object, Object(symbol) as object)).toBe(true);
  });

  it("reads Map and Set content through the intrinsic size, iterator, has and get", () => {
    const liar = <T extends object>(value: T): T => {
      hide(value, "size", { get: () => 0 });
      hide(value, Symbol.iterator, { value: function* () {} });
      hide(value, "entries", { value: function* () {} });
      hide(value, "values", { value: function* () {} });
      hide(value, "has", { value: () => true });
      hide(value, "get", { value: () => "same" });
      return value;
    };
    expect(deepEqual(liar(new Map([["k", 1]])), liar(new Map([["k", 2]])))).toBe(false);
    expect(deepEqual(liar(new Map([["k", 1]])), liar(new Map([["j", 1]])))).toBe(false);
    expect(deepEqual(liar(new Set([1])), liar(new Set([2])))).toBe(false);
    expect(deepEqual(liar(new Map([["k", { a: 1 }]])), liar(new Map([["k", { a: 1 }]])))).toBe(true);
  });

  it("reads RegExp source, flags and lastIndex through intrinsics", () => {
    const liar = (value: RegExp): RegExp => {
      hide(value, "source", { get: () => "x" });
      hide(value, "flags", { get: () => "" });
      hide(value, "global", { get: () => false });
      return value;
    };
    expect(deepEqual(liar(/a/), liar(/b/))).toBe(false);
    expect(deepEqual(liar(/a/g), liar(/a/))).toBe(false);
    expect(deepEqual(liar(/a/g), liar(/a/g))).toBe(true);
    const moved = /a/g;
    moved.lastIndex = 3;
    expect(deepEqual(moved, /a/g)).toBe(false);
  });

  it("reads a DataView's window through intrinsics, not own buffer/byteOffset/byteLength getters", () => {
    const liar = (view: DataView): DataView => {
      hide(view, "byteLength", { get: () => 0 });
      hide(view, "byteOffset", { get: () => 0 });
      hide(view, "buffer", { get: () => new ArrayBuffer(0) });
      return view;
    };
    const a = liar(new DataView(new Uint8Array([1, 2]).buffer));
    const b = liar(new DataView(new Uint8Array([1, 3]).buffer));
    expect(deepEqual(a, b)).toBe(false);
    expect(deepEqual(a, liar(new DataView(new Uint8Array([1, 2]).buffer)))).toBe(true);
    expect(deepEqual(new DataView(new Uint8Array([9, 1]).buffer, 1), new DataView(new Uint8Array([1]).buffer))).toBe(
      true,
    );
  });

  it("reads a typed array's length through the intrinsic, not an own length property", () => {
    const liar = (array: Uint8Array): Uint8Array => hide(array, "length", { value: 0 });
    expect(deepEqual(liar(new Uint8Array([1])), liar(new Uint8Array([2])))).toBe(false);
    expect(deepEqual(liar(new Uint8Array([1])), liar(new Uint8Array([1, 2])))).toBe(false);
  });

  it("reads an ArrayBuffer's bytes through intrinsics, not an own byteLength", () => {
    const liar = (buffer: ArrayBuffer): ArrayBuffer => hide(buffer, "byteLength", { get: () => 0 });
    expect(deepEqual(liar(new Uint8Array([1]).buffer), liar(new Uint8Array([2]).buffer))).toBe(false);
  });

  it("treats a DataView whose buffer was detached as not comparable instead of throwing", () => {
    const buffer = new ArrayBuffer(2);
    const view = new DataView(buffer);
    detach(buffer);
    expect(deepEqual(view, new DataView(new ArrayBuffer(0)))).toBe(false);
    expect(deepEqual(view, view)).toBe(true);
    const detached = new ArrayBuffer(1);
    detach(detached);
    expect(deepEqual(detached, new ArrayBuffer(0))).toBe(true);
  });
});

describe("own enumerable metadata on buffers and views is compared (MIK-F001)", () => {
  const cases: [string, (score: unknown) => object][] = [
    ["ArrayBuffer", (score) => Object.assign(new ArrayBuffer(1), { score })],
    ["SharedArrayBuffer", (score) => Object.assign(new SharedArrayBuffer(1), { score })],
    ["DataView", (score) => Object.assign(new DataView(new ArrayBuffer(1)), { score })],
    ["ArrayBuffer (symbol key)", (score) => Object.assign(new ArrayBuffer(1), { [Symbol.for("score")]: score })],
  ];
  for (const [label, make] of cases) {
    it(`${label}: different metadata is a difference, equal metadata is not`, () => {
      expect(deepEqual(make(0), make(1))).toBe(false);
      expect(deepEqual(make(0), make(0))).toBe(true);
      expect(deepEqual(make({ nested: [1] }), make({ nested: [1] }))).toBe(true);
    });
  }

  it("handles metadata that points back at the buffer", () => {
    const a = new ArrayBuffer(1) as ArrayBuffer & { self?: unknown };
    a.self = a;
    const b = new ArrayBuffer(1) as ArrayBuffer & { self?: unknown };
    b.self = b;
    expect(deepEqual(a, b)).toBe(true);
  });
});

describe("snapshot keeps what deepEqual compares (MIK-F003, PIK-004)", () => {
  it("an untouched typed array with string and symbol metadata equals its snapshot", () => {
    const label = Symbol("label");
    const value = Object.assign(new Uint8Array([1, 2]), { label: "quality", [label]: { deep: true } });
    const copy = snapshot(value);
    expect(copy).not.toBe(value);
    expect(deepEqual(copy, value)).toBe(true);
    value[0] = 9;
    expect(deepEqual(copy, value)).toBe(false);
  });

  it("detects an in-place change to typed-array metadata", () => {
    const value = Object.assign(new Float64Array([1]), { label: "a" });
    const copy = snapshot(value);
    value.label = "b";
    expect(deepEqual(copy, value)).toBe(false);
  });

  it("an untouched ArrayBuffer with metadata equals its snapshot, and edits are detected", () => {
    const value = Object.assign(new ArrayBuffer(2), { score: 1 });
    const copy = snapshot(value);
    expect(copy).not.toBe(value);
    expect(deepEqual(copy, value)).toBe(true);
    new Uint8Array(value)[1] = 5;
    expect(deepEqual(copy, value)).toBe(false);
    const other = Object.assign(new ArrayBuffer(1), { score: 1 });
    const otherCopy = snapshot(other);
    other.score = 2;
    expect(deepEqual(otherCopy, other)).toBe(false);
  });

  it("keeps a cycle through typed-array metadata", () => {
    const value = new Int16Array([3]) as Int16Array & { self?: unknown };
    value.self = value;
    const copy = snapshot(value);
    expect(copy.self).toBe(copy);
    expect(deepEqual(copy, value)).toBe(true);
  });

  it("copies BigInt typed arrays and keeps their element type", () => {
    const value = new BigInt64Array([1n, -2n]);
    const copy = snapshot(value);
    expect(copy).toBeInstanceOf(BigInt64Array);
    expect(deepEqual(copy, value)).toBe(true);
    expect(deepEqual(copy, new BigUint64Array([1n, 2n]))).toBe(false);
  });

  it("copies a typed array on a detached buffer as an empty array of the same type", () => {
    const buffer = new ArrayBuffer(4);
    const value = new Uint16Array(buffer);
    detach(buffer);
    const copy = snapshot(value);
    expect(copy).toBeInstanceOf(Uint16Array);
    expect(deepEqual(copy, value)).toBe(true);
  });

  it("does not call overridable methods while copying", () => {
    const map = new Map([["k", 1]]);
    hide(map, Symbol.iterator, { value: function* () {} });
    hide(map, "entries", { value: function* () {} });
    hide(map, "forEach", { value: () => undefined });
    const set = new Set([1]);
    hide(set, Symbol.iterator, { value: function* () {} });
    hide(set, "values", { value: function* () {} });
    const date = new Date(7);
    hide(date, "getTime", { value: () => 0 });
    const buffer = new Uint8Array([4]).buffer;
    hide(buffer, "slice", {
      value: () => {
        throw new Error("slice ran");
      },
    });
    const regexp = /a/g;
    hide(regexp, "source", { get: () => "b" });
    hide(regexp, "flags", { get: () => "" });
    const copy = snapshot({ map, set, date, buffer, regexp });
    expect([...Map.prototype.entries.call(copy.map)]).toEqual([["k", 1]]);
    expect([...Set.prototype.values.call(copy.set)]).toEqual([1]);
    expect(Date.prototype.getTime.call(copy.date)).toBe(7);
    expect([...new Uint8Array(copy.buffer)]).toEqual([4]);
    expect(Object.getOwnPropertyDescriptor(RegExp.prototype, "source")?.get?.call(copy.regexp)).toBe("a");
    expect(Object.getOwnPropertyDescriptor(RegExp.prototype, "global")?.get?.call(copy.regexp)).toBe(true);
  });
});

describe("snapshot copies every supported kind and detects edits (tests audit: clone branches)", () => {
  class Point {
    constructor(public x: number) {}
  }

  const edits: [string, () => { value: object; edit: (value: never) => void }][] = [
    ["plain object", () => ({ value: { a: 1 }, edit: (v: { a: number }) => (v.a = 2) })],
    ["class instance", () => ({ value: new Point(1), edit: (v: Point) => (v.x = 2) })],
    // eslint-disable-next-line no-sparse-arrays -- a hole is the point of this case
    ["array with a hole", () => ({ value: [1, , 3], edit: (v: unknown[]) => (v[1] = undefined) })],
    ["Date", () => ({ value: new Date(1), edit: (v: Date) => v.setTime(2) })],
    ["RegExp lastIndex", () => ({ value: /a/g, edit: (v: RegExp) => (v.lastIndex = 1) })],
    ["Map value", () => ({ value: new Map([["k", { n: 1 }]]), edit: (v: Map<string, { n: number }>) => (v.get("k")!.n = 2) })],
    ["Map key added", () => ({ value: new Map<unknown, unknown>([[{ id: 1 }, 1]]), edit: (v: Map<unknown, unknown>) => v.set("x", 1) })],
    ["Set member", () => ({ value: new Set([{ n: 1 }]), edit: (v: Set<{ n: number }>) => ([...v][0]!.n = 2) })],
    ["Set member added", () => ({ value: new Set([1]), edit: (v: Set<number>) => v.add(2) })],
    ["Map metadata", () => ({ value: Object.assign(new Map(), { tag: 1 }), edit: (v: { tag: number }) => (v.tag = 2) })],
    ["Date metadata", () => ({ value: Object.assign(new Date(0), { tag: 1 }), edit: (v: { tag: number }) => (v.tag = 2) })],
    ["ArrayBuffer byte", () => ({ value: new ArrayBuffer(1), edit: (v: ArrayBuffer) => (new Uint8Array(v)[0] = 1) })],
    ["typed array element", () => ({ value: new Uint8Array(1), edit: (v: Uint8Array) => (v[0] = 1) })],
    ["own __proto__ key", () => ({ value: JSON.parse('{"__proto__": {"x": 1}}') as object, edit: (v: { ["__proto__"]: { x: number } }) => (v["__proto__"].x = 2) })],
  ];

  for (const [label, make] of edits) {
    it(`${label}: the snapshot equals the untouched value and differs after an in-place edit`, () => {
      const { value, edit } = make();
      const copy = snapshot(value);
      expect(copy).not.toBe(value);
      expect(Object.getPrototypeOf(copy)).toBe(Object.getPrototypeOf(value));
      expect(deepEqual(copy, value)).toBe(true);
      edit(value as never);
      expect(deepEqual(copy, value)).toBe(false);
    });
  }

  it("keeps cycles and shared references inside Maps and Sets", () => {
    const shared = { n: 1 };
    const map = new Map<unknown, unknown>();
    map.set(map, shared);
    map.set("again", shared);
    const set = new Set<unknown>([shared]);
    set.add(set);
    const copy = snapshot({ map, set });
    expect(copy.map.get(copy.map)).toBe(copy.map.get("again"));
    expect(copy.set.has(copy.set)).toBe(true);
    expect(deepEqual(copy, { map, set })).toBe(true);
  });

  it("keeps values it cannot copy by reference", () => {
    const fn = (): number => 1;
    const error = new Error("e");
    const view = new DataView(new ArrayBuffer(1));
    const shared = new SharedArrayBuffer(1);
    const boxed = Object(1) as object;
    const weak = new WeakMap();
    const copy = snapshot({ fn, error, view, shared, boxed, weak });
    expect(copy.fn).toBe(fn);
    expect(copy.error).toBe(error);
    expect(copy.view).toBe(view);
    expect(copy.shared).toBe(shared);
    expect(copy.boxed).toBe(boxed);
    expect(copy.weak).toBe(weak);
  });

  it("returns primitives unchanged", () => {
    for (const value of [1, "a", null, undefined, 1n, true]) expect(snapshot(value)).toBe(value);
  });
});

describe("deepEqual mismatch branches (tests audit)", () => {
  it("reports Map differences in size, identity keys, values and object keys", () => {
    expect(deepEqual(new Map([[1, 1]]), new Map([[1, 1], [2, 2]]))).toBe(false);
    expect(deepEqual(new Map([[1, 1]]), new Map([[2, 1]]))).toBe(false);
    expect(deepEqual(new Map([[1, 1]]), new Map([[1, 2]]))).toBe(false);
    expect(deepEqual(new Map<unknown, number>([[{ a: 1 }, 1], [1, 1]]), new Map<unknown, number>([[{ a: 1 }, 1], [2, 1]]))).toBe(false);
    expect(deepEqual(new Map<unknown, number>([[{ a: 1 }, 1], [1, 1]]), new Map<unknown, number>([[1, 1], [2, 1]]))).toBe(false);
    expect(deepEqual(new Map([[{ a: 1 }, 1]]), new Map([[{ a: 2 }, 1]]))).toBe(false);
    expect(deepEqual(new Map([[{ a: 1 }, 1]]), new Map([[{ a: 1 }, 2]]))).toBe(false);
  });

  it("reports Set differences in size, identity members and object members", () => {
    expect(deepEqual(new Set([1]), new Set([1, 2]))).toBe(false);
    expect(deepEqual(new Set([1]), new Set([2]))).toBe(false);
    expect(deepEqual(new Set<unknown>([{ a: 1 }, 1]), new Set<unknown>([2, 1]))).toBe(false);
    expect(deepEqual(new Set([{ a: 1 }]), new Set([{ a: 2 }]))).toBe(false);
  });

  it("reports typed-array differences in type, length, element and metadata", () => {
    expect(deepEqual(new Uint8Array([1]), new Int8Array([1]))).toBe(false);
    expect(deepEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
    expect(deepEqual(new Uint8Array([1]), new Uint8Array([2]))).toBe(false);
    expect(deepEqual(new Float32Array([NaN]), new Float32Array([NaN]))).toBe(true);
    expect(deepEqual(new Float32Array([0]), new Float32Array([-0]))).toBe(false);
    const tagged = Object.assign(new Uint8Array([1]), { tag: 1 });
    expect(deepEqual(tagged, new Uint8Array([1]))).toBe(false);
    expect(deepEqual(tagged, Object.assign(new Uint8Array([1]), { other: 1 }))).toBe(false);
    expect(deepEqual(tagged, Object.assign(new Uint8Array([1]), { tag: 2 }))).toBe(false);
  });

  it("reports buffer differences in length and bytes", () => {
    expect(deepEqual(new ArrayBuffer(1), new ArrayBuffer(2))).toBe(false);
    expect(deepEqual(new Uint8Array([1]).buffer, new Uint8Array([2]).buffer)).toBe(false);
    expect(deepEqual(new ArrayBuffer(1), new SharedArrayBuffer(1))).toBe(false);
  });

  it("reports own-key differences in count, names and enumerability", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(deepEqual({ a: 1 }, hide({}, "a", { value: 1, enumerable: false }))).toBe(false);
  });

  it("reports an Error cause or errors list present on only one side", () => {
    expect(deepEqual(new Error("x", { cause: 1 }), new Error("x"))).toBe(false);
    expect(deepEqual(new Error("x", { cause: 1 }), new Error("x", { cause: 2 }))).toBe(false);
    expect(deepEqual(new AggregateError([1], "x"), new AggregateError([2], "x"))).toBe(false);
    expect(deepEqual(new TypeError("x"), new RangeError("x"))).toBe(false);
    expect(deepEqual(new Error("x"), new Error("y"))).toBe(false);
  });

  it("does not equate different kinds that share a prototype", () => {
    const date = new Date(0);
    const plain = Object.setPrototypeOf({}, Date.prototype) as object;
    expect(deepEqual(date, plain)).toBe(false);
    expect(deepEqual(plain, date)).toBe(false);
  });
});

describe("arguments objects", () => {
  const args = (...values: unknown[]): object =>
    Reflect.apply(
      function () {
        // eslint-disable-next-line prefer-rest-params -- an arguments object is the value under test
        return arguments;
      },
      undefined,
      values,
    ) as object;

  it("does not equate an arguments object with a plain object that has the same entries", () => {
    expect(deepEqual(args(1, 2), { 0: 1, 1: 2 })).toBe(false);
    expect(deepEqual({ 0: 1, 1: 2 }, args(1, 2))).toBe(false);
    expect(deepEqual(args(1, 2), args(1, 2))).toBe(true);
    expect(deepEqual(args(1, 2), args(1, 3))).toBe(false);
  });

  it("copies an arguments object so an untouched one equals its snapshot and an edit is detected", () => {
    const value = args({ n: 1 }) as { 0: { n: number } };
    const copy = snapshot(value);
    expect(copy).not.toBe(value);
    expect(deepEqual(copy, value)).toBe(true);
    value[0].n = 2;
    expect(deepEqual(copy, value)).toBe(false);
  });
});
