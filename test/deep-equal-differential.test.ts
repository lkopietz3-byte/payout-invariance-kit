/**
 * Differential fuzz: deepEqual against node:util's isDeepStrictEqual, plus a
 * construction oracle (the generator knows whether the two values differ).
 * node:util is used here, in a test, only; the library itself never imports
 * it. The same file lives in payout-invariance-kit and
 * mutation-invariance-kit; only the import line differs.
 *
 * Intentional divergences, all in the fail-closed direction (deepEqual says
 * "different" where isDeepStrictEqual says "equal"):
 * - values deepEqual cannot inspect: an object with a custom string
 *   Symbol.toStringTag, a Proxy around a built-in, WeakRef, an object that
 *   only inherits from a built-in prototype;
 * - built-ins disguised so that isDeepStrictEqual reads the disguise: an own
 *   masked Symbol.toStringTag, a replaced prototype, own size/iterator
 *   overrides on a Map, an own `source` getter on a RegExp. deepEqual reads
 *   the real content.
 * The only divergence in the other direction was an `arguments` object
 * against a plain object with the same entries; deepEqual now tells them
 * apart too.
 */
import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";

import { deepEqual } from "../src/deepEqual";

/** mulberry32: small, seeded, deterministic. */
function rngFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRIMITIVES: unknown[] = [0, -0, 1, NaN, Infinity, "a", "b", "", true, false, null, undefined, 1n, Symbol.for("s")];

class Point {
  constructor(public x: unknown) {}
}
class FrozenDate extends Date {
  override getTime(): number {
    return 0;
  }
}
class ZeroNumber extends Number {
  override valueOf(): number {
    return 0;
  }
}

const hide = <T extends object>(value: T, key: PropertyKey, descriptor: PropertyDescriptor): T =>
  Object.defineProperty(value, key, { configurable: true, ...descriptor });

interface Gen {
  rng: () => number;
  leaf: number;
  perturbAt: number;
  hostile: boolean;
  /** A value deepEqual cannot inspect was emitted (so two different ones never compare equal). */
  opaque: boolean;
  /** A disguised built-in was emitted (isDeepStrictEqual may read the disguise). */
  disguised: boolean;
  /** The perturbed leaf landed somewhere deepEqual compares. */
  perturbedVisible: boolean;
}

function pick<T>(g: Gen, items: readonly T[]): T {
  return items[Math.floor(g.rng() * items.length)] as T;
}

/** The next leaf: a draw that is the same on both sides unless this is the perturbed leaf. */
function nextLeaf(g: Gen): boolean {
  const perturbed = g.leaf === g.perturbAt;
  g.leaf += 1;
  if (perturbed) g.perturbedVisible = true;
  return perturbed;
}

function primitive(g: Gen): unknown {
  const index = Math.floor(g.rng() * PRIMITIVES.length);
  return PRIMITIVES[(index + (nextLeaf(g) ? 1 : 0)) % PRIMITIVES.length];
}

function int(g: Gen): number {
  const value = Math.floor(g.rng() * 4);
  return nextLeaf(g) ? value + 1 : value;
}

function withMetadata<T extends object>(g: Gen, value: T): T {
  if (g.rng() < 0.3) Object.defineProperty(value, "meta", { value: primitive(g), enumerable: true, configurable: true, writable: true });
  if (g.rng() < 0.15) Object.defineProperty(value, Symbol.for("m"), { value: int(g), enumerable: true, configurable: true, writable: true });
  return value;
}

function container(g: Gen, depth: number): unknown {
  switch (Math.floor(g.rng() * 14)) {
    case 0: {
      const length = Math.floor(g.rng() * 4);
      const array: unknown[] = new Array<unknown>(length);
      for (let i = 0; i < length; i += 1) if (g.rng() < 0.85) array[i] = value(g, depth - 1);
      return withMetadata(g, array);
    }
    case 1: {
      const object: Record<string | symbol, unknown> = g.rng() < 0.2 ? (Object.create(null) as Record<string, unknown>) : {};
      for (const key of ["a", "b", "__proto__"]) {
        if (g.rng() < 0.5) Object.defineProperty(object, key, { value: value(g, depth - 1), enumerable: true, configurable: true, writable: true });
      }
      if (g.rng() < 0.2) object[Symbol.for("k")] = value(g, depth - 1);
      return object;
    }
    case 2: {
      const map = new Map<unknown, unknown>([[`k${int(g)}`, value(g, depth - 1)]]);
      if (g.rng() < 0.4) map.set({ key: int(g) }, value(g, depth - 1));
      return withMetadata(g, map);
    }
    case 3: {
      const set = new Set<unknown>([int(g)]);
      if (g.rng() < 0.4) set.add({ member: int(g) });
      return withMetadata(g, set);
    }
    case 4:
      return withMetadata(g, new Date(int(g) * 1000));
    case 5: {
      const regexp = new RegExp(pick(g, ["a", "b+"]) + String(int(g)), pick(g, ["", "g", "iy"]));
      regexp.lastIndex = int(g);
      return withMetadata(g, regexp);
    }
    case 6: {
      const boxed = [() => int(g), () => `s${int(g)}`, () => int(g) % 2 === 0, () => BigInt(int(g))];
      return withMetadata(g, Object(pick(g, boxed)()) as object);
    }
    case 7: {
      const Typed = pick(g, [Uint8Array, Float64Array, Int16Array] as const);
      return withMetadata(g, new Typed([int(g), int(g)]));
    }
    case 8:
      return withMetadata(g, new Uint8Array([int(g), int(g)]).buffer);
    case 9:
      return withMetadata(g, new DataView(new Uint8Array([9, int(g), int(g)]).buffer, 1));
    case 10: {
      const error = new (pick(g, [Error, TypeError] as const))(`m${int(g)}`, g.rng() < 0.5 ? { cause: value(g, depth - 1) } : undefined);
      return withMetadata(g, error);
    }
    case 11:
      return new Point(value(g, depth - 1));
    case 12:
      return Reflect.apply(
        function () {
          // eslint-disable-next-line prefer-rest-params -- an arguments object is the value under test
          return arguments;
        },
        undefined,
        [value(g, depth - 1)],
      ) as object;
    default:
      return g.hostile ? hostileValue(g) : primitive(g);
  }
}

function hostileValue(g: Gen): unknown {
  switch (Math.floor(g.rng() * 12)) {
    case 0:
      g.disguised = true;
      return hide(new Map([["rank", int(g)]]), Symbol.toStringTag, { value: undefined, enumerable: g.rng() < 0.5, writable: true });
    case 1: {
      g.disguised = true;
      const map = new Map([["rank", int(g)]]);
      hide(map, "size", { get: () => 0 });
      hide(map, Symbol.iterator, { value: function* () {} });
      return map;
    }
    case 2:
      g.disguised = true;
      return Object.setPrototypeOf(new Map([["rank", int(g)]]), Object.prototype) as object;
    case 3:
      return new FrozenDate(int(g));
    case 4:
      return new ZeroNumber(int(g));
    case 5:
      return hide(new Uint8Array([int(g)]), "length", { value: 0 });
    case 6:
      return hide(new DataView(new Uint8Array([int(g)]).buffer), "byteLength", { get: () => 0 });
    case 7:
      g.disguised = true;
      return hide(new RegExp(`r${int(g)}`), "source", { get: () => "same" });
    case 8:
      g.opaque = true;
      return new Proxy(new Map([["rank", int(g)]]), {});
    case 9:
      g.opaque = true;
      return pick(g, [new WeakMap(), new WeakSet(), new WeakRef({})]);
    case 10:
      g.opaque = true;
      return { [Symbol.toStringTag]: "Custom", value: int(g) };
    default:
      g.opaque = true;
      return Object.create(Date.prototype) as object;
  }
}

function value(g: Gen, depth: number): unknown {
  return depth > 0 && g.rng() < 0.6 ? container(g, depth) : primitive(g);
}

function generate(seed: number, perturbAt: number, hostile: boolean): { value: unknown; gen: Gen } {
  const gen: Gen = { rng: rngFrom(seed), leaf: 0, perturbAt, hostile, opaque: false, disguised: false, perturbedVisible: false };
  return { value: value(gen, 3), gen };
}

function runPairs(hostile: boolean, count: number): { agreements: number; divergences: string[] } {
  let agreements = 0;
  const divergences: string[] = [];
  for (let seed = 1; seed <= count; seed += 1) {
    const a = generate(seed, -1, hostile);
    const perturbAt = seed % 3 === 0 ? -1 : Math.floor(rngFrom(seed * 7919)() * Math.max(a.gen.leaf, 1));
    const b = generate(seed, perturbAt, hostile);
    const ours = deepEqual(a.value, b.value);
    const node = isDeepStrictEqual(a.value, b.value);

    // Construction oracle: different opaque objects, or a visible change, are never equal.
    const shouldDiffer = a.gen.opaque || b.gen.perturbedVisible;
    if (ours === shouldDiffer) divergences.push(`seed ${seed}: deepEqual ${ours}, construction says differ=${shouldDiffer}`);
    expect(deepEqual(b.value, a.value), `symmetry, seed ${seed}`).toBe(ours);

    if (ours === node) agreements += 1;
    else if (ours || !(a.gen.opaque || a.gen.disguised)) {
      divergences.push(`seed ${seed}: deepEqual ${ours}, isDeepStrictEqual ${node}`);
    }
  }
  return { agreements, divergences };
}

describe("deepEqual vs node:util isDeepStrictEqual (differential fuzz)", () => {
  it("agrees on ordinary values, including built-ins with metadata, holes, cycles-free nesting and arguments objects", () => {
    const { agreements, divergences } = runPairs(false, 3000);
    expect(divergences).toEqual([]);
    expect(agreements).toBe(3000);
  });

  it("with hostile values, only ever diverges in the fail-closed direction, and matches the construction oracle", () => {
    const { agreements, divergences } = runPairs(true, 3000);
    expect(divergences).toEqual([]);
    expect(agreements).toBeGreaterThan(1500);
  });

  it("documents the fail-closed divergences one by one", () => {
    const maskedA = hide(new Map([["rank", 0]]), Symbol.toStringTag, { value: undefined, enumerable: true });
    const maskedB = hide(new Map([["rank", 100]]), Symbol.toStringTag, { value: undefined, enumerable: true });
    const swappedA = Object.setPrototypeOf(new Map([["rank", 0]]), Object.prototype) as object;
    const swappedB = Object.setPrototypeOf(new Map([["rank", 100]]), Object.prototype) as object;
    const cases: [string, unknown, unknown][] = [
      ["masked-tag Maps with different entries", maskedA, maskedB],
      ["prototype-swapped Maps with different entries", swappedA, swappedB],
      ["custom Symbol.toStringTag objects", { [Symbol.toStringTag]: "X", a: 1 }, { [Symbol.toStringTag]: "X", a: 1 }],
      ["Proxies around equal Maps", new Proxy(new Map(), {}), new Proxy(new Map(), {})],
      ["WeakRefs", new WeakRef({}), new WeakRef({})],
      ["RegExps whose own source getter hides the real source", hide(/a/, "source", { get: () => "x" }), hide(/b/, "source", { get: () => "x" })],
      ["objects that only inherit from Date.prototype", Object.create(Date.prototype), Object.create(Date.prototype)],
    ];
    for (const [label, a, b] of cases) {
      expect(isDeepStrictEqual(a, b), label).toBe(true);
      expect(deepEqual(a, b), label).toBe(false);
    }
  });
});
