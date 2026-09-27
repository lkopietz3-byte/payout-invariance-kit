/**
 * Structural deep equality, used as the default output comparator for
 * `assertPayoutInvariance` and the default "did the mutation change anything"
 * check.
 *
 * The design rule is to fail closed: when two values cannot be shown equal,
 * they are reported as different. A false "different" is loud (the check
 * fails and you look); a false "equal" would let a real payout dependence
 * pass a ranking as invariant when it is not.
 */

type PairMemo = WeakMap<object, WeakSet<object>>;

/**
 * Internal. How an object is compared and copied. Built-ins are recognized by
 * brand checks (operations that only succeed on the real thing), never by
 * `Symbol.toStringTag` alone, which any object can set.
 */
export type Kind =
  | "Object"
  | "Array"
  | "Date"
  | "RegExp"
  | "Error"
  | "Map"
  | "Set"
  | "ArrayBuffer"
  | "SharedArrayBuffer"
  | "DataView"
  | "TypedArray"
  | "Boxed"
  | "Opaque";

// Built-in getters run against a receiver via Reflect.get(proto, key, value):
// they throw (or return undefined) unless `value` really is that built-in.
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const sharedArrayBufferPrototype: object | undefined =
  typeof SharedArrayBuffer === "function" ? (SharedArrayBuffer.prototype as object) : undefined;

function passes(check: () => unknown): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}

/** Internal. The constructor name of a real typed array ("Uint8Array", ...), else undefined. */
export function typedArrayName(value: object): string | undefined {
  const name: unknown = Reflect.get(typedArrayPrototype, Symbol.toStringTag, value);
  return typeof name === "string" ? name : undefined;
}

/** Internal. Classify an object (see `Kind`). */
export function kindOf(value: object): Kind {
  if (Array.isArray(value)) return "Array";
  if (ArrayBuffer.isView(value)) return typedArrayName(value) === undefined ? "DataView" : "TypedArray";
  const declaredTag: unknown = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
  if (typeof declaredTag !== "string") {
    // With no toStringTag, Object.prototype.toString reports the engine's own
    // built-in tag, which cannot be faked.
    switch (Object.prototype.toString.call(value).slice(8, -1)) {
      case "Date":
        return "Date";
      case "RegExp":
        return "RegExp";
      case "Error":
        return "Error";
      case "Number":
      case "String":
      case "Boolean":
        return "Boxed";
      default:
        return value instanceof Error ? "Error" : "Object";
    }
  }
  // A declared tag is only a hint: confirm it with a brand check.
  switch (declaredTag) {
    case "Map":
      return passes(() => Map.prototype.has.call(value, undefined)) ? "Map" : "Opaque";
    case "Set":
      return passes(() => Set.prototype.has.call(value, undefined)) ? "Set" : "Opaque";
    case "ArrayBuffer":
      return passes(() => Reflect.get(ArrayBuffer.prototype, "byteLength", value)) ? "ArrayBuffer" : "Opaque";
    case "SharedArrayBuffer":
      return sharedArrayBufferPrototype &&
        passes(() => Reflect.get(sharedArrayBufferPrototype, "byteLength", value))
        ? "SharedArrayBuffer"
        : "Opaque";
    case "Symbol":
      return passes(() => Symbol.prototype.valueOf.call(value)) ? "Boxed" : "Opaque";
    case "BigInt":
      return passes(() => BigInt.prototype.valueOf.call(value)) ? "Boxed" : "Opaque";
    default:
      // Promise, WeakMap, URL, a class that sets its own tag, ...: state we
      // cannot see, so it is equal only to itself.
      return value instanceof Error ? "Error" : "Opaque";
  }
}

function ownEnumerableKeys(value: object): (string | symbol)[] {
  const keys: (string | symbol)[] = Object.keys(value);
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    if (Object.prototype.propertyIsEnumerable.call(value, symbol)) keys.push(symbol);
  }
  return keys;
}

function read(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key) as unknown;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** True for values a Map/Set looks up by identity: primitives and functions. */
function isIdentityKey(value: unknown): boolean {
  return typeof value !== "object" || value === null;
}

/**
 * Structural deep equality, similar to `node:util`'s `isDeepStrictEqual` but
 * with no Node dependency, and stricter about values it cannot see into.
 *
 * What it compares:
 * - Primitives with `Object.is`: `NaN` equals `NaN`, `0` and `-0` are
 *   different, and there is no floating-point tolerance (`0.1 + 0.2` is not
 *   `0.3`). Pass your own `isEqual` to `assertPayoutInvariance` for tolerance.
 * - Plain objects, class instances, arrays, `Map`, `Set`, `Date`, `RegExp`,
 *   `Error`, boxed primitives, `ArrayBuffer`, `DataView`, and typed arrays,
 *   by content. Both sides must have the same prototype, so a class instance
 *   never equals a plain object with the same fields. Own enumerable string
 *   and symbol keys are compared; non-enumerable properties and private
 *   `#fields` are not (except an `Error`'s `name`, `message`, `cause`, and
 *   `errors`).
 * - Array holes are distinct from `undefined` (`[ , 1]` is not `[undefined, 1]`).
 * - Invalid dates (`new Date(NaN)`) equal each other.
 * - `Set` members and `Map` keys that are objects are matched by structure,
 *   one-to-one, so `new Set([{a:1},{a:1}])` does not equal
 *   `new Set([{a:1},{a:2}])`. That matching is quadratic in the number of
 *   object members.
 * - Circular references are handled.
 *
 * Equal only to themselves (by reference): functions, and objects whose state
 * it cannot read: `Promise`, `WeakMap`, `WeakSet`, `URL`, and any object that
 * sets its own `Symbol.toStringTag` without being one of the built-ins above.
 * Compare those with a custom `isEqual`. Built-ins are recognized by brand
 * checks, so an object that only claims to be a `Map` through
 * `Symbol.toStringTag` is not treated as one.
 *
 * An own `__proto__` key (from `JSON.parse`) is compared like any other key.
 * Never mutates its arguments; reads (and so runs the getters of) only the
 * own enumerable properties it compares.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return equal(a, b, new WeakMap());
}

function equal(a: unknown, b: unknown, memo: PairMemo): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const kind = kindOf(a);
  if (kind !== kindOf(b) || kind === "Opaque") return false;

  // Cycle guard: a pair already being compared higher up the stack is assumed
  // equal; any real difference is found on the way back out.
  let partners = memo.get(a);
  if (partners?.has(b)) return true;
  if (!partners) {
    partners = new WeakSet();
    memo.set(a, partners);
  }
  partners.add(b);
  try {
    return equalContents(a, b, kind, memo);
  } finally {
    partners.delete(b);
  }
}

function equalContents(a: object, b: object, kind: Exclude<Kind, "Opaque">, memo: PairMemo): boolean {
  switch (kind) {
    case "Object":
      return sameOwnProperties(a, b, memo);
    case "Array":
      return (a as unknown[]).length === (b as unknown[]).length && sameOwnProperties(a, b, memo);
    case "Date":
      return Object.is((a as Date).getTime(), (b as Date).getTime()) && sameOwnProperties(a, b, memo);
    case "RegExp": {
      const ra = a as RegExp;
      const rb = b as RegExp;
      return (
        ra.source === rb.source &&
        ra.flags === rb.flags &&
        ra.lastIndex === rb.lastIndex &&
        sameOwnProperties(a, b, memo)
      );
    }
    case "Boxed":
      return (
        Object.is((a as { valueOf(): unknown }).valueOf(), (b as { valueOf(): unknown }).valueOf()) &&
        sameOwnProperties(a, b, memo)
      );
    case "Error": {
      const ea = a as Error;
      const eb = b as Error;
      return (
        Object.is(ea.name, eb.name) &&
        Object.is(ea.message, eb.message) &&
        sameOptionalOwn(a, b, "cause", memo) &&
        sameOptionalOwn(a, b, "errors", memo) &&
        sameOwnProperties(a, b, memo)
      );
    }
    case "Map":
      return mapsEqual(a as Map<unknown, unknown>, b as Map<unknown, unknown>, memo) && sameOwnProperties(a, b, memo);
    case "Set":
      return setsEqual(a as Set<unknown>, b as Set<unknown>, memo) && sameOwnProperties(a, b, memo);
    case "ArrayBuffer":
    case "SharedArrayBuffer":
      return bytesEqual(new Uint8Array(a as ArrayBufferLike), new Uint8Array(b as ArrayBufferLike));
    case "DataView": {
      const va = a as DataView;
      const vb = b as DataView;
      return bytesEqual(
        new Uint8Array(va.buffer, va.byteOffset, va.byteLength),
        new Uint8Array(vb.buffer, vb.byteOffset, vb.byteLength),
      );
    }
    case "TypedArray":
      return (
        typedArrayName(a) === typedArrayName(b) &&
        elementsEqual(a as ArrayLike<unknown>, b as ArrayLike<unknown>) &&
        sameOwnNonIndexProperties(a, b, memo)
      );
  }
}

function sameOwnProperties(a: object, b: object, memo: PairMemo): boolean {
  const keysA = ownEnumerableKeys(a);
  if (keysA.length !== ownEnumerableKeys(b).length) return false;
  for (const key of keysA) {
    if (!Object.prototype.propertyIsEnumerable.call(b, key)) return false;
    if (!equal(read(a, key), read(b, key), memo)) return false;
  }
  return true;
}

function isIndexKey(key: string | symbol): boolean {
  return typeof key === "string" && /^(?:0|[1-9]\d*)$/.test(key);
}

/** Typed arrays: elements were compared already; compare any extra own keys. */
function sameOwnNonIndexProperties(a: object, b: object, memo: PairMemo): boolean {
  const keysA = ownEnumerableKeys(a).filter((key) => !isIndexKey(key));
  if (keysA.length !== ownEnumerableKeys(b).filter((key) => !isIndexKey(key)).length) return false;
  return keysA.every(
    (key) => Object.prototype.propertyIsEnumerable.call(b, key) && equal(read(a, key), read(b, key), memo),
  );
}

function sameOptionalOwn(a: object, b: object, key: string, memo: PairMemo): boolean {
  const inA = hasOwn(a, key);
  if (inA !== hasOwn(b, key)) return false;
  return !inA || equal(read(a, key), read(b, key), memo);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function elementsEqual(a: ArrayLike<unknown>, b: ArrayLike<unknown>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

function mapsEqual(a: Map<unknown, unknown>, b: Map<unknown, unknown>, memo: PairMemo): boolean {
  if (a.size !== b.size) return false;
  const objectKeyedA: [unknown, unknown][] = [];
  for (const [key, value] of a) {
    if (isIdentityKey(key)) {
      if (!b.has(key) || !equal(value, b.get(key), memo)) return false;
    } else {
      objectKeyedA.push([key, value]);
    }
  }
  const objectKeyedB = [...b].filter(([key]) => !isIdentityKey(key));
  if (objectKeyedA.length !== objectKeyedB.length) return false;
  // deepEqual is an equivalence relation, so greedy one-to-one matching is exact.
  for (const [keyA, valueA] of objectKeyedA) {
    const index = objectKeyedB.findIndex(([keyB, valueB]) => equal(keyA, keyB, memo) && equal(valueA, valueB, memo));
    if (index === -1) return false;
    objectKeyedB.splice(index, 1);
  }
  return true;
}

function setsEqual(a: Set<unknown>, b: Set<unknown>, memo: PairMemo): boolean {
  if (a.size !== b.size) return false;
  const objectsA: unknown[] = [];
  for (const member of a) {
    if (isIdentityKey(member)) {
      if (!b.has(member)) return false;
    } else {
      objectsA.push(member);
    }
  }
  const objectsB = [...b].filter((member) => !isIdentityKey(member));
  if (objectsA.length !== objectsB.length) return false;
  for (const member of objectsA) {
    const index = objectsB.findIndex((other) => equal(member, other, memo));
    if (index === -1) return false;
    objectsB.splice(index, 1);
  }
  return true;
}
