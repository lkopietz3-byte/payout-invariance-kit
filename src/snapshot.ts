/**
 * Internal (not exported from the package). A deep copy of a value, made only
 * so the invariance check can notice when the function under test or
 * `mutate` modified the caller's base input (or an earlier output) in place:
 * it compares the copy to the live value with `deepEqual`. This file is
 * shared, byte for byte, by payout-invariance-kit and mutation-invariance-kit.
 *
 * It copies plain and class objects (prototype preserved), arrays (holes
 * preserved), `Map`, `Set`, `Date`, `RegExp`, `ArrayBuffer`, and typed
 * arrays, including circular references, and on each of them the own
 * enumerable string and symbol properties `deepEqual` compares (so an
 * untouched typed array with a `label` property equals its copy). Built-in
 * content is read with the same intrinsics `deepEqual` uses, never through
 * the value's own methods or getters.
 *
 * Everything else is kept by reference, so in-place changes inside it are
 * not detected: functions, `Error`, boxed primitives, `DataView`,
 * `SharedArrayBuffer` (another thread may legitimately change it), and every
 * value `deepEqual` treats as not comparable (`Promise`, `WeakMap`, `URL`,
 * objects with a custom `Symbol.toStringTag`, ...). Private `#fields` are not
 * copied.
 *
 * Property keys are written with `Object.defineProperty`, never by
 * assignment, so an own `__proto__` key (from `JSON.parse`) is copied as a
 * plain property and cannot change the copy's prototype.
 */
import {
  bufferBytes,
  copyTypedArrayInto,
  dateValue,
  isIndexKey,
  kindOf,
  mapEntries,
  ownEnumerableKeys,
  regExpParts,
  registerBrand,
  setValues,
  typedArrayLength,
  typedArrayName,
} from "./deepEqual.js";

type TypedArrayConstructor = new (length: number) => object;

/** Every typed array constructor this runtime has, by the name its brand reports. */
const typedArrayConstructors = new Map<string, TypedArrayConstructor>();
for (const name of [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]) {
  const candidate: unknown = Reflect.get(globalThis, name);
  if (typeof candidate === "function") typedArrayConstructors.set(name, candidate as TypedArrayConstructor);
}

export function snapshot<T>(value: T): T {
  return clone(value, new WeakMap()) as T;
}

function copyOwnProperties(from: object, to: object, skipIndexKeys: boolean, seen: WeakMap<object, unknown>): void {
  for (const key of ownEnumerableKeys(from)) {
    if (skipIndexKeys && isIndexKey(key)) continue;
    Object.defineProperty(to, key, {
      value: clone(Reflect.get(from, key) as unknown, seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}

function clone(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return seen.get(value);

  const kind = kindOf(value);
  let copy: object;

  switch (kind) {
    case "Object":
      copy = Object.create(Object.getPrototypeOf(value) as object | null) as object;
      break;
    case "Array":
      copy = new Array<unknown>((value as unknown[]).length);
      break;
    case "Date":
      copy = new Date(dateValue(value));
      break;
    case "RegExp": {
      const { source, flags, lastIndex } = regExpParts(value);
      const regexp = new RegExp(source, flags);
      Object.defineProperty(regexp, "lastIndex", { value: lastIndex });
      copy = regexp;
      break;
    }
    case "Map": {
      const map = new Map<unknown, unknown>();
      seen.set(value, map);
      for (const [key, entry] of mapEntries(value)) map.set(clone(key, seen), clone(entry, seen));
      copy = map;
      break;
    }
    case "Set": {
      const set = new Set<unknown>();
      seen.set(value, set);
      for (const member of setValues(value)) set.add(clone(member, seen));
      copy = set;
      break;
    }
    case "ArrayBuffer": {
      const bytes = bufferBytes(value, kind);
      const buffer = new ArrayBuffer(bytes.length);
      new Uint8Array(buffer).set(bytes);
      copy = buffer;
      break;
    }
    case "TypedArray": {
      const Typed = typedArrayConstructors.get(typedArrayName(value));
      if (!Typed) return value; // an element type this runtime cannot construct: keep by reference
      const length = typedArrayLength(value);
      copy = new Typed(length);
      if (length > 0) copyTypedArrayInto(copy, value);
      break;
    }
    default:
      return value; // kept by reference (see above)
  }

  registerBrand(copy, kind);
  seen.set(value, copy);
  const proto = Object.getPrototypeOf(value) as object | null;
  if (Object.getPrototypeOf(copy) !== proto) Object.setPrototypeOf(copy, proto);
  copyOwnProperties(value, copy, kind === "TypedArray", seen);
  return copy;
}
