/**
 * Internal (not exported from the package). A deep copy of a value, made only
 * so `assertPayoutInvariance` can notice when `rankFn` or `mutate` modified
 * the caller's base input (or an earlier ranking result) in place: it
 * compares the copy to the live value with `deepEqual`.
 *
 * It copies plain and class objects (prototype preserved), arrays (holes
 * preserved), `Map`, `Set`, `Date`, `RegExp`, `ArrayBuffer`, and typed arrays,
 * including circular references. Everything else (functions, `Error`, boxed
 * primitives, `DataView`, `SharedArrayBuffer`, `Promise`, `URL`, objects with
 * a custom `Symbol.toStringTag`, ...) is kept by reference, so in-place
 * changes inside those are not detected. Private `#fields` are not copied.
 *
 * Property keys are written with `Object.defineProperty`, never by
 * assignment, so an own `__proto__` key (from `JSON.parse`) is copied as a
 * plain property and cannot change the copy's prototype.
 */
import { kindOf, typedArrayName } from "./deepEqual.js";

type TypedArrayConstructor = new (source: ArrayLike<number> | ArrayLike<bigint>) => object;

function typedArrayConstructor(name: string): TypedArrayConstructor | undefined {
  // Looked up on globalThis by the engine-reported name, so every typed array
  // the runtime has is covered.
  const candidate: unknown = Reflect.get(globalThis, name);
  return typeof candidate === "function" ? (candidate as TypedArrayConstructor) : undefined;
}

export function snapshot<T>(value: T): T {
  return clone(value, new WeakMap()) as T;
}

function copyOwnProperties(from: object, to: object, seen: WeakMap<object, unknown>): void {
  const keys: (string | symbol)[] = Object.keys(from);
  for (const symbol of Object.getOwnPropertySymbols(from)) {
    if (Object.prototype.propertyIsEnumerable.call(from, symbol)) keys.push(symbol);
  }
  for (const key of keys) {
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

  const proto = Object.getPrototypeOf(value) as object | null;
  let copy: object;
  let copyProperties = true;

  switch (kindOf(value)) {
    case "Object":
      copy = Object.create(proto) as object;
      break;
    case "Array":
      copy = new Array<unknown>((value as unknown[]).length);
      break;
    case "Date":
      copy = new Date((value as Date).getTime());
      break;
    case "RegExp": {
      const source = value as RegExp;
      const regexp = new RegExp(source.source, source.flags);
      regexp.lastIndex = source.lastIndex;
      copy = regexp;
      break;
    }
    case "Map": {
      const map = new Map<unknown, unknown>();
      seen.set(value, map);
      for (const [key, entry] of value as Map<unknown, unknown>) map.set(clone(key, seen), clone(entry, seen));
      copy = map;
      break;
    }
    case "Set": {
      const set = new Set<unknown>();
      seen.set(value, set);
      for (const member of value as Set<unknown>) set.add(clone(member, seen));
      copy = set;
      break;
    }
    case "ArrayBuffer":
      copy = (value as ArrayBuffer).slice(0);
      copyProperties = false;
      break;
    case "TypedArray": {
      const Typed = typedArrayConstructor(typedArrayName(value) ?? "");
      if (!Typed) return value;
      copy = new Typed(value as ArrayLike<number>);
      copyProperties = false;
      break;
    }
    default:
      return value; // opaque to this copy: keep by reference
  }

  seen.set(value, copy);
  if (Object.getPrototypeOf(copy) !== proto) Object.setPrototypeOf(copy, proto);
  if (copyProperties) copyOwnProperties(value, copy, seen);
  return copy;
}
