import { describe, expect, it } from "vitest";

import { deepEqual } from "../src/index";

describe("deepEqual: primitives", () => {
  it("treats identical primitives as equal", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(10n, 10n)).toBe(true);
  });

  it("treats different primitives, and different types, as unequal", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual(1, "1")).toBe(false);
    expect(deepEqual(0, false)).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual({}, null)).toBe(false);
    expect(deepEqual(1n, 1)).toBe(false);
  });

  it("treats NaN as equal to NaN (Object.is semantics)", () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual({ payout: NaN }, { payout: NaN })).toBe(true);
    expect(deepEqual(NaN, 0)).toBe(false);
    expect(deepEqual(NaN, undefined)).toBe(false);
  });

  it("distinguishes 0 from -0 (Object.is semantics) and Infinity from -Infinity", () => {
    expect(deepEqual(0, -0)).toBe(false);
    expect(deepEqual(Infinity, Infinity)).toBe(true);
    expect(deepEqual(Infinity, -Infinity)).toBe(false);
  });

  it("only treats the same function reference as equal", () => {
    const f = () => 1;
    expect(deepEqual(f, f)).toBe(true);
    expect(deepEqual(f, () => 1)).toBe(false);
    expect(deepEqual({ f }, { f })).toBe(true);
    expect(deepEqual({ f }, { f: () => 1 })).toBe(false);
  });
});

describe("deepEqual: arrays", () => {
  it("compares elements in order", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([], [])).toBe(true);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual([[1, { a: 2 }]], [[1, { a: 2 }]])).toBe(true);
    expect(deepEqual([[1, { a: 2 }]], [[1, { a: 3 }]])).toBe(false);
  });

  it("does not treat a sparse array as equal to a dense one (in either direction)", () => {
    // eslint-disable-next-line no-sparse-arrays -- deliberately building a sparse array
    const sparse = [, 1];
    expect(deepEqual(sparse, [2, 1])).toBe(false);
    expect(deepEqual([2, 1], sparse)).toBe(false);
    // eslint-disable-next-line no-sparse-arrays -- deliberately building a sparse array
    expect(deepEqual([, 1], [, 1])).toBe(true);
    // A hole is not the same thing as an explicit undefined.
    expect(deepEqual(sparse, [undefined, 1])).toBe(false);
  });

  it("notices extra non-index properties on arrays", () => {
    const a: number[] & { tag?: string } = [1, 2];
    const b: number[] & { tag?: string } = [1, 2];
    b.tag = "x";
    expect(deepEqual(a, b)).toBe(false);
    a.tag = "x";
    expect(deepEqual(a, b)).toBe(true);
  });

  it("compares typed arrays element by element and by kind", () => {
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(deepEqual(new Uint8Array([1, 2]), new Int8Array([1, 2]))).toBe(false);
    expect(deepEqual(new Uint8Array([1, 2]), { 0: 1, 1: 2 })).toBe(false);
    expect(deepEqual(new Float64Array([NaN]), new Float64Array([NaN]))).toBe(true);
  });
});

describe("deepEqual: plain objects", () => {
  it("compares own enumerable keys and values, ignoring key order by default", () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
    expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })).toBe(true);
    expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toBe(false);
  });

  it("handles a __proto__ key that is an own property (as JSON.parse creates)", () => {
    const a = JSON.parse('{"__proto__": {"payout": 1}, "x": 1}') as object;
    const b = JSON.parse('{"__proto__": {"payout": 2}, "x": 1}') as object;
    const c = JSON.parse('{"__proto__": {"payout": 1}, "x": 1}') as object;
    expect(deepEqual(a, b)).toBe(false);
    expect(deepEqual(a, c)).toBe(true);
    expect(deepEqual(a, { x: 1 })).toBe(false);
  });

  it("handles null-prototype objects and a key called constructor", () => {
    const a = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    const b = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    expect(deepEqual(a, b)).toBe(true);
    expect(deepEqual({ constructor: 1 }, { constructor: 1 })).toBe(true);
    expect(deepEqual({ constructor: 1 }, { constructor: 2 })).toBe(false);
    expect(deepEqual({ hasOwnProperty: 1 }, { hasOwnProperty: 1 })).toBe(true);
  });

  it("compares enumerable symbol-keyed properties", () => {
    const k = Symbol("k");
    expect(deepEqual({ [k]: 1 }, { [k]: 1 })).toBe(true);
    expect(deepEqual({ [k]: 1 }, { [k]: 2 })).toBe(false);
    expect(deepEqual({ [k]: 1 }, {})).toBe(false);
  });

  it("ignores non-enumerable properties (a documented limit)", () => {
    const a = {};
    Object.defineProperty(a, "hidden", { value: 1, enumerable: false });
    expect(deepEqual(a, {})).toBe(true);
  });

  it("requires the same prototype, so a class instance is not a plain object", () => {
    // A class instance and a plain object with identical fields behave
    // differently (methods, private state, invariants) even though their own
    // enumerable keys match, so a ranking result rebuilt as a plain object
    // instead of the expected class should not silently compare equal.
    class Box {
      v = 1;
    }
    expect(deepEqual(new Box(), { v: 1 })).toBe(false);
    expect(deepEqual(new Box(), new Box())).toBe(true);
    expect(deepEqual(Object.create(null), {})).toBe(false);
  });
});

describe("deepEqual: Date, RegExp, Error, boxed primitives", () => {
  it("compares dates by time value, including invalid dates", () => {
    expect(deepEqual(new Date(5), new Date(5))).toBe(true);
    expect(deepEqual(new Date(5), new Date(6))).toBe(false);
    expect(deepEqual(new Date(5), 5)).toBe(false);
    expect(deepEqual(new Date(NaN), new Date(NaN))).toBe(true);
    expect(deepEqual(new Date(NaN), new Date(5))).toBe(false);
  });

  it("compares regular expressions by source and flags", () => {
    expect(deepEqual(/a/g, /a/g)).toBe(true);
    expect(deepEqual(/a/g, /a/i)).toBe(false);
    expect(deepEqual(/a/, /b/)).toBe(false);
  });

  it("compares errors by name, message and cause", () => {
    expect(deepEqual(new Error("a"), new Error("a"))).toBe(true);
    expect(deepEqual(new Error("a"), new Error("b"))).toBe(false);
    expect(deepEqual(new Error("a"), new TypeError("a"))).toBe(false);
    expect(deepEqual(new Error("a", { cause: 1 }), new Error("a", { cause: 2 }))).toBe(false);
    expect(deepEqual(new Error("a", { cause: 1 }), new Error("a", { cause: 1 }))).toBe(true);
  });

  it("compares boxed primitives by their value", () => {
    expect(deepEqual(new Number(1), new Number(1))).toBe(true);
    expect(deepEqual(new Number(1), new Number(2))).toBe(false);
    expect(deepEqual(new String("a"), new String("b"))).toBe(false);
    expect(deepEqual(new Boolean(true), new Boolean(false))).toBe(false);
    expect(deepEqual(new Number(1), 1)).toBe(false);
  });
});

describe("deepEqual: objects it cannot compare structurally", () => {
  it("never calls two different Promises equal", () => {
    const p = Promise.resolve(1);
    expect(deepEqual(p, p)).toBe(true);
    expect(deepEqual(Promise.resolve(1), Promise.resolve(2))).toBe(false);
    expect(deepEqual(Promise.resolve(1), Promise.resolve(1))).toBe(false);
  });

  it("only treats WeakMap, WeakSet and generators as equal to themselves", () => {
    const wm = new WeakMap();
    expect(deepEqual(wm, wm)).toBe(true);
    expect(deepEqual(new WeakMap(), new WeakMap())).toBe(false);
    expect(deepEqual(new WeakSet(), new WeakSet())).toBe(false);
    function* g() {
      yield 1;
    }
    expect(deepEqual(g(), g())).toBe(false);
  });

  it("compares ArrayBuffer, DataView and typed array element type by content, not reference", () => {
    // Unlike WeakMap/WeakSet, a buffer's bytes ARE visible, so two different
    // buffer objects holding the same bytes are structurally equal — the
    // same rule that lets two different result arrays with equal contents
    // compare equal.
    expect(deepEqual(new ArrayBuffer(2), new ArrayBuffer(2))).toBe(true);
    expect(deepEqual(new Uint8Array([1]).buffer, new Uint8Array([2]).buffer)).toBe(false);
    expect(deepEqual(new ArrayBuffer(4), new ArrayBuffer(8))).toBe(false);
    expect(
      deepEqual(new DataView(new Uint8Array([1]).buffer), new DataView(new Uint8Array([1]).buffer)),
    ).toBe(true);
    expect(
      deepEqual(new DataView(new Uint8Array([1]).buffer), new DataView(new Uint8Array([2]).buffer)),
    ).toBe(false);
  });

  it("treats an object with a custom Symbol.toStringTag as equal only to itself", () => {
    class Money {
      constructor(public cents: number) {}
      get [Symbol.toStringTag](): string {
        return "Money";
      }
    }
    const m = new Money(500);
    expect(deepEqual(m, m)).toBe(true);
    expect(deepEqual(new Money(500), new Money(500))).toBe(false);
  });

  it("does not trust a spoofed Symbol.toStringTag claiming to be a Map (brand check)", () => {
    const fakeMap = { [Symbol.toStringTag]: "Map", size: 0 };
    expect(() => deepEqual(fakeMap, { [Symbol.toStringTag]: "Map", size: 0 })).not.toThrow();
    expect(deepEqual(fakeMap, { [Symbol.toStringTag]: "Map", size: 0 })).toBe(false);
    expect(deepEqual(fakeMap, fakeMap)).toBe(true);
    expect(deepEqual(fakeMap, new Map())).toBe(false);
  });

  it("compares objects with different built-in kinds as unequal", () => {
    expect(deepEqual(new Map(), {})).toBe(false);
    expect(deepEqual(new Set(), [])).toBe(false);
    expect(deepEqual(new Map(), new Set())).toBe(false);
    expect(deepEqual(new Date(0), {})).toBe(false);
    expect(deepEqual(/a/, {})).toBe(false);
  });
});

describe("deepEqual: Map", () => {
  it("compares entries regardless of insertion order by default", () => {
    expect(deepEqual(new Map([["a", 1], ["b", 2]]), new Map([["b", 2], ["a", 1]]))).toBe(true);
    expect(deepEqual(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false);
    expect(deepEqual(new Map([["a", 1]]), new Map([["b", 1]]))).toBe(false);
    expect(deepEqual(new Map([["a", 1]]), new Map([["a", 1], ["b", 2]]))).toBe(false);
    expect(deepEqual(new Map(), new Map())).toBe(true);
  });

  it("matches object keys structurally, not just by reference", () => {
    const a = new Map([[{ id: 1 }, "x"]]);
    const b = new Map([[{ id: 1 }, "x"]]);
    const c = new Map([[{ id: 2 }, "x"]]);
    expect(deepEqual(a, b)).toBe(true);
    expect(deepEqual(a, c)).toBe(false);
  });

  it("does not let two identical-looking keys on one side match one key on the other", () => {
    const a = new Map<object, number>([[{ id: 1 }, 1], [{ id: 1 }, 1]]);
    const b = new Map<object, number>([[{ id: 1 }, 1], [{ id: 2 }, 1]]);
    expect(deepEqual(a, b)).toBe(false);
    expect(deepEqual(b, a)).toBe(false);
  });
});

describe("deepEqual: Set", () => {
  it("compares members regardless of insertion order by default", () => {
    expect(deepEqual(new Set([1, 2, 3]), new Set([3, 2, 1]))).toBe(true);
    expect(deepEqual(new Set([1, 2]), new Set([1, 2, 3]))).toBe(false);
    expect(deepEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false);
    expect(deepEqual(new Set(), new Set())).toBe(true);
  });

  it("matches object members structurally", () => {
    expect(deepEqual(new Set([{ a: 1 }]), new Set([{ a: 1 }]))).toBe(true);
    expect(deepEqual(new Set([{ a: 1 }]), new Set([{ a: 2 }]))).toBe(false);
  });

  it("does not let two identical-looking members on one side match one member on the other", () => {
    // Same size; the old check found each left member "somewhere" on the right
    // without using up the match, so it called these equal.
    const a = new Set([{ a: 1 }, { a: 1 }]);
    const b = new Set([{ a: 1 }, { a: 2 }]);
    expect(deepEqual(a, b)).toBe(false);
    expect(deepEqual(b, a)).toBe(false);
  });

  it("handles many object members without confusing matches", () => {
    const a = new Set(Array.from({ length: 50 }, (_, i) => ({ i })));
    const shuffled = new Set(Array.from({ length: 50 }, (_, i) => ({ i: (i * 7) % 50 })));
    const off = new Set(Array.from({ length: 50 }, (_, i) => ({ i: i === 49 ? 999 : i })));
    expect(deepEqual(a, shuffled)).toBe(true);
    expect(deepEqual(a, off)).toBe(false);
  });
});

describe("deepEqual: cycles", () => {
  it("terminates on self-referencing structures instead of overflowing the stack", () => {
    const a: Record<string, unknown> = { id: 1 };
    a.self = a;
    const b: Record<string, unknown> = { id: 1 };
    b.self = b;
    expect(deepEqual(a, b)).toBe(true);

    const c: Record<string, unknown> = { id: 2 };
    c.self = c;
    expect(deepEqual(a, c)).toBe(false);
  });

  it("terminates on mutually-referencing arrays", () => {
    const a: unknown[] = [1];
    const b: unknown[] = [a];
    a.push(b);
    const c: unknown[] = [1];
    const d: unknown[] = [c];
    c.push(d);
    expect(deepEqual(a, c)).toBe(true);
  });

  it("does not remember a failed comparison as a success", () => {
    // The same pair of objects is compared twice on different paths; an
    // earlier failed attempt must not make a later attempt pass.
    const x1 = { v: 1 };
    const x2 = { v: 2 };
    const a = { first: [x1], second: [x1] };
    const b = { first: [x2], second: [x1] };
    expect(deepEqual(a, b)).toBe(false);
  });
});

describe("deepEqual: symmetry", () => {
  const pairs: [string, unknown, unknown][] = [
    ["equal objects", { a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }],
    ["different objects", { a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }],
    ["sets", new Set([1, { a: 1 }]), new Set([{ a: 1 }, 1])],
    ["maps", new Map([[1, { a: 1 }]]), new Map([[1, { a: 2 }]])],
    ["nan", [NaN], [NaN]],
    ["dates", new Date(1), new Date(2)],
  ];
  for (const [label, a, b] of pairs) {
    it(`deepEqual(a, b) === deepEqual(b, a) for ${label}`, () => {
      expect(deepEqual(a, b)).toBe(deepEqual(b, a));
    });
  }
});
