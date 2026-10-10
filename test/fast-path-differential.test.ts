/**
 * The array and typed array fast paths must answer exactly like the plain
 * key-by-key rules. This test builds thousands of seeded pairs with holes,
 * non-enumerable elements, extra named keys, extra symbols and getters, and
 * checks `deepEqual` (and the snapshot copy) against a deliberately simple
 * reference that has no fast path.
 */
import { describe, expect, it } from "vitest";

import { deepEqual } from "../src/index.js";
import { snapshot } from "../src/snapshot.js";

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const symbolA = Symbol("a");
const symbolB = Symbol("b");
const POOL: unknown[] = [0, -0, 1, 2, NaN, "1", "", undefined, null, true];

type Keyed = Record<PropertyKey, unknown>;

/** Own enumerable keys, strings then symbols, read the plain way. */
function enumerableKeys(value: object): PropertyKey[] {
  return Reflect.ownKeys(value).filter((key) => Object.prototype.propertyIsEnumerable.call(value, key));
}

/** No fast path, no tricks: same length/type, then the same enumerable keys with Object.is values. */
function reference(a: unknown[] | ArrayLike<unknown>, b: unknown[] | ArrayLike<unknown>, ordered: boolean, typed: boolean): boolean {
  if (a.length !== b.length) return false;
  const isExtra = (key: PropertyKey): boolean => !typed || typeof key === "symbol" || !/^(?:0|[1-9]\d*)$/.test(String(key));
  const keysA = enumerableKeys(a as object).filter(isExtra);
  const keysB = enumerableKeys(b as object).filter(isExtra);
  if (typed) {
    for (let index = 0; index < a.length; index += 1) if (!Object.is(a[index], b[index])) return false;
  }
  if (keysA.length !== keysB.length) return false;
  if (ordered) for (let index = 0; index < keysA.length; index += 1) if (keysA[index] !== keysB[index]) return false;
  for (const key of keysA) {
    if (!Object.prototype.propertyIsEnumerable.call(b, key)) return false;
    if (!Object.is((a as unknown as Keyed)[key], (b as unknown as Keyed)[key])) return false;
  }
  return true;
}

/** Accessors installed by the generator, each counting its reads (every one must run at most once per comparison). */
const counters: { reads: number }[] = [];

function countedGetter(target: object, key: PropertyKey, enumerable: boolean): void {
  const counter = { reads: 0 };
  counters.push(counter);
  Object.defineProperty(target, key, {
    get: () => {
      counter.reads += 1;
      return 1;
    },
    enumerable,
    configurable: true,
  });
}

/** The same array seen through a Proxy that lists its keys in reverse order (indices last-to-first, then the rest). */
function reverseKeyed(array: unknown[]): unknown[] {
  return new Proxy(array, {
    ownKeys: (target) => {
      const keys = Reflect.ownKeys(target);
      const indices = keys.filter((key) => typeof key === "string" && /^(?:0|[1-9]\d*)$/.test(key));
      const rest = keys.filter((key) => !indices.includes(key));
      return [...indices.reverse(), ...rest];
    },
  });
}

function perturbArray(random: () => number, array: unknown[]): void {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const edits = Math.floor(random() * 3);
  for (let i = 0; i < edits; i += 1) {
    const kind = Math.floor(random() * 9);
    const index = Math.floor(random() * Math.max(array.length, 1));
    switch (kind) {
      case 0:
        // eslint-disable-next-line @typescript-eslint/no-array-delete -- a hole is the point
        delete array[index];
        break;
      case 1:
        if (index < array.length && Object.prototype.hasOwnProperty.call(array, index)) {
          Object.defineProperty(array, index, { value: array[index], enumerable: false, writable: true, configurable: true });
        }
        break;
      case 2:
        Object.assign(array, { [pick(["x", "y", "0.5", "-1"])]: pick(POOL) });
        break;
      case 3:
        Object.assign(array, { [pick([symbolA, symbolB])]: pick(POOL) });
        break;
      case 4:
        Object.defineProperty(array, index, { value: pick(POOL), enumerable: true, writable: true, configurable: true });
        break;
      case 5:
        if (index < array.length) countedGetter(array, index, true);
        break;
      case 6:
        countedGetter(array, pick(["label", "meta"]), true);
        break;
      case 7:
        countedGetter(array, pick(["quiet", "hushed"]), false);
        break;
      default:
        Object.defineProperty(array, pick(["hidden", "other"]), { value: 1, enumerable: false });
    }
  }
}

describe("array fast path agrees with the key-by-key rules", { timeout: 120_000 }, () => {
  it("5,000 seeded pairs, default and ordered, both directions", () => {
    const random = mulberry32(20261010);
    let equalPairs = 0;
    let unequalPairs = 0;
    for (let round = 0; round < 5000; round += 1) {
      counters.length = 0;
      const length = Math.floor(random() * 7);
      const a = Array.from({ length }, () => POOL[Math.floor(random() * POOL.length)]);
      const b = random() < 0.5 ? [...a] : Array.from({ length }, () => POOL[Math.floor(random() * POOL.length)]);
      if (random() < 0.7) perturbArray(random, a);
      if (random() < 0.7) perturbArray(random, b);
      const viewA = random() < 0.2 ? reverseKeyed(a) : a;
      const viewB = random() < 0.2 ? reverseKeyed(b) : b;
      const reordered = viewA !== a || viewB !== b;
      for (const ordered of [false, true]) {
        // Index order is the element order; only a lying Proxy can list indices differently, so skip those in ordered mode.
        if (ordered && reordered) continue;
        const expected = reference(a, b, ordered, false);
        const options = { orderSensitive: ordered };
        for (const [left, right, label] of [[viewA, viewB, "forward"], [viewB, viewA, "reversed"]] as const) {
          for (const counter of counters) counter.reads = 0;
          expect(deepEqual(left, right, options), `round ${round} ${label} ordered=${ordered}`).toBe(expected);
          for (const counter of counters) {
            expect(counter.reads, `round ${round} ${label} getter reads`).toBeLessThanOrEqual(1);
          }
        }
        if (expected) equalPairs += 1;
        else unequalPairs += 1;
      }
      // A copy always equals its original, whatever the original looked like,
      // and making it reads every getter at most once.
      for (const counter of counters) counter.reads = 0;
      const copy = snapshot(a);
      for (const counter of counters) expect(counter.reads, `snapshot round ${round} getter reads`).toBeLessThanOrEqual(1);
      expect(deepEqual(copy, a, { orderSensitive: true }), `snapshot round ${round}`).toBe(true);
    }
    // The generator exercises both outcomes (guards against a test that proves nothing).
    expect(equalPairs).toBeGreaterThan(500);
    expect(unequalPairs).toBeGreaterThan(500);
  });

  it("5,000 seeded typed array pairs with extra keys and symbols", () => {
    const random = mulberry32(777);
    const lengths = [0, 1, 2, 5];
    let equalPairs = 0;
    let unequalPairs = 0;
    for (let round = 0; round < 5000; round += 1) {
      const length = lengths[Math.floor(random() * lengths.length)] as number;
      const a = Float64Array.from({ length }, () => [0, -0, 1, NaN, 2][Math.floor(random() * 5)] as number);
      const b = random() < 0.6 ? new Float64Array(a) : Float64Array.from({ length }, () => [0, -0, 1, NaN, 2][Math.floor(random() * 5)] as number);
      for (const target of [a, b]) {
        if (random() < 0.4) Object.assign(target, { [random() < 0.5 ? "label" : "tag"]: random() < 0.5 ? 1 : "x" });
        if (random() < 0.2) Object.assign(target, { [symbolA]: 1 });
        if (random() < 0.2) Object.defineProperty(target, "hidden", { value: 1, enumerable: false });
      }
      for (const ordered of [false, true]) {
        const expected = reference(a, b, ordered, true);
        expect(deepEqual(a, b, { orderSensitive: ordered }), `round ${round} ordered=${ordered}`).toBe(expected);
        if (expected) equalPairs += 1;
        else unequalPairs += 1;
      }
      expect(deepEqual(snapshot(a), a, { orderSensitive: true }), `snapshot round ${round}`).toBe(true);
    }
    expect(equalPairs).toBeGreaterThan(500);
    expect(unequalPairs).toBeGreaterThan(500);
  });

  it("nested arrays of objects keep the same answers as the key-by-key rules", () => {
    const random = mulberry32(99);
    for (let round = 0; round < 2000; round += 1) {
      const make = (): unknown[] => Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({ v: Math.floor(random() * 2), inner: [Math.floor(random() * 2)] }));
      const a = make();
      const b = random() < 0.5 ? snapshot(a) : make();
      const expected = JSON.stringify(a) === JSON.stringify(b);
      expect(deepEqual(a, b), `round ${round}`).toBe(expected);
    }
  });

  it("the snapshot of a nested structure with shared and circular references keeps its shape", () => {
    const shared = { n: 1 };
    const root: { a: unknown[]; b: unknown; self?: unknown } = { a: [shared, shared, [shared]], b: shared };
    root.self = root;
    root.a.push(root);
    const copy = snapshot(root);
    expect(copy).not.toBe(root);
    expect(copy.self).toBe(copy);
    expect(copy.a[0]).toBe(copy.b);
    expect(copy.a[1]).toBe(copy.b);
    expect((copy.a[2] as unknown[])[0]).toBe(copy.b);
    expect(copy.a[3]).toBe(copy);
    expect(copy.b).not.toBe(shared);
    expect(deepEqual(copy, root)).toBe(true);
    shared.n = 2;
    expect(deepEqual(copy, root)).toBe(false);
  });

  it("the snapshot of an array subclass keeps its prototype and an own __proto__ key stays data", () => {
    class Ranking extends Array<number> {}
    const ranking = Ranking.from([1, 2, 3]);
    const copy = snapshot(ranking);
    expect(Object.getPrototypeOf(copy)).toBe(Ranking.prototype);
    expect(deepEqual(copy, ranking)).toBe(true);
    const parsed = JSON.parse('{"__proto__": {"admin": true}, "list": [1, {"__proto__": 1}]}') as { list: unknown[] };
    const parsedCopy = snapshot(parsed);
    expect(Object.getPrototypeOf(parsedCopy)).toBe(Object.prototype);
    expect(Object.keys(parsedCopy)).toEqual(["__proto__", "list"]);
    expect(deepEqual(parsedCopy, parsed)).toBe(true);
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
  });

  it("very wide inputs (200,000 elements or keys) agree with the key-by-key rules", () => {
    const WIDE = 200_000;
    const wide = (): unknown[] => Array.from({ length: WIDE }, (_, i) => i);
    const withExtra = (target: object, count: number): object => {
      for (let i = 0; i < count; i += 1) Object.defineProperty(target, `k${i}`, { value: i, enumerable: true, writable: true, configurable: true });
      return target;
    };
    const withHole = (): unknown[] => {
      const array = wide();
      // eslint-disable-next-line @typescript-eslint/no-array-delete -- a hole is the point
      delete array[WIDE - 1];
      return array;
    };
    const cases: [string, object, object][] = [
      ["equal dense", wide(), wide()],
      ["last element differs", wide(), Object.assign(wide(), { [WIDE - 1]: -1 })],
      ["one extra key", Object.assign(wide(), { tag: 1 }), wide()],
      ["same extra key", Object.assign(wide(), { tag: 1 }), Object.assign(wide(), { tag: 1 })],
      ["hole at the end", wide(), withHole()],
      ["many named keys on arrays", withExtra(wide(), 1000), withExtra(wide(), 1000)],
      ["typed equal", new Float64Array(WIDE), new Float64Array(WIDE)],
      ["typed with 150,000 extra keys", withExtra(new Uint8Array(4), 150_000), withExtra(new Uint8Array(4), 150_000)],
      ["typed extra key value differs", withExtra(new Uint8Array(4), 5000), Object.assign(withExtra(new Uint8Array(4), 5000), { k4999: -1 })],
    ];
    for (const [label, left, right] of cases) {
      const typed = ArrayBuffer.isView(left);
      const expected = reference(left as unknown[], right as unknown[], false, typed);
      expect(deepEqual(left, right), label).toBe(expected);
      expect(deepEqual(right, left), `${label} (reversed)`).toBe(expected);
      expect(deepEqual(snapshot(left), left, { orderSensitive: true }), `${label} (copy)`).toBe(true);
    }
  });
});
