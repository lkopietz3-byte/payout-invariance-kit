/**
 * Internal (not exported from the package). A deep copy of a value, made only
 * so the invariance check can notice when the function under test or
 * `mutate` modified the caller's base input (or an earlier output) in place:
 * it compares the copy to the live value with `deepEqual`. This file is
 * shared, byte for byte, by payout-invariance-kit and mutation-invariance-kit.
 *
 * It copies plain and class objects (prototype preserved), `arguments`
 * objects, arrays (holes preserved), `Map`, `Set`, `Date`, `RegExp`,
 * `ArrayBuffer`, and typed arrays, including circular references, and on
 * each of them the own enumerable string and symbol properties `deepEqual`
 * compares (so an untouched typed array with a `label` property equals its
 * copy). Built-in content is read with the same intrinsics `deepEqual`
 * uses, never through the value's own methods or getters.
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
 * plain property and cannot change the copy's prototype. The one exception is
 * the element fast path for arrays with no hole and no extra key: the copy
 * starts as a fresh array of the element values, and an element that is an
 * object is replaced by its copy with a plain assignment to that existing
 * element.
 *
 * Copying uses an explicit work list, not recursion, so nesting depth is
 * limited by memory and not by the call stack.
 */
import {
  bufferBytes,
  copyTypedArrayInto,
  dateValue,
  denseElements,
  kindOf,
  mapEntries,
  ownEnumerableKeys,
  regExpParts,
  registerBrand,
  setValues,
  TYPED_ARRAY_NAMES,
  typedArrayExtraKeys,
  typedArrayLength,
  typedArrayName,
} from "./deepEqual.js";
import type { Kind } from "./deepEqual.js";

type TypedArrayConstructor = new (length: number) => object;

/** Every typed array constructor this runtime has, by the name its brand reports. */
const typedArrayConstructors = new Map<string, TypedArrayConstructor>();
for (const name of TYPED_ARRAY_NAMES) {
  const candidate: unknown = Reflect.get(globalThis, name);
  if (typeof candidate === "function") typedArrayConstructors.set(name, candidate as TypedArrayConstructor);
}

/** A fresh, empty `arguments` object (this module is strict, so it is unmapped). */
function emptyArguments(): object {
  // eslint-disable-next-line prefer-rest-params -- the only way to create an arguments object
  return (function () { return arguments; })();
}

/** A copy that has been created but whose contents are still to be filled in. */
interface Pending {
  from: object;
  to: object;
  kind: Kind;
  /** An array copy that already holds the original element values (see `denseElements`). */
  dense: boolean;
}

type Seen = WeakMap<object, unknown>;

// Captured now: a copy is filled with the real Map/Set operations, so a null
// or replaced prototype, or a subclass override, cannot break or run during
// the copy.
const mapSet = Reflect.get(Map.prototype, "set") as (this: object, ...args: unknown[]) => unknown;
const setAdd = Reflect.get(Set.prototype, "add") as (this: object, ...args: unknown[]) => unknown;

export function snapshot<T>(value: T): T {
  const seen: Seen = new WeakMap();
  const pending: Pending[] = [];
  const root = shell(value, seen, pending);
  for (let task = pending.pop(); task !== undefined; task = pending.pop()) fill(task, seen, pending);
  return root as T;
}

/**
 * The copy of `value`: itself for a primitive or a value kept by reference,
 * otherwise a new object with its built-in content already in place and the
 * rest queued in `pending`. Because the copy exists (and is registered in
 * `seen`) before its children are visited, cycles and shared references
 * resolve to the same copy.
 */
function shell(value: unknown, seen: Seen, pending: Pending[]): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return seen.get(value);

  const kind = kindOf(value);
  let copy: object;
  let dense = false;

  switch (kind) {
    case "Object":
      copy = Object.create(Object.getPrototypeOf(value) as object | null) as object;
      break;
    case "Arguments":
      copy = emptyArguments();
      break;
    case "Array": {
      const elements = denseElements(value);
      dense = elements !== undefined;
      copy = elements ?? new Array<unknown>((value as unknown[]).length);
      break;
    }
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
    case "Map":
      copy = new Map<unknown, unknown>();
      break;
    case "Set":
      copy = new Set<unknown>();
      break;
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
  pending.push({ from: value, to: copy, kind, dense });
  return copy;
}

/** Fill in a copy's entries, members, elements and own enumerable properties. */
function fill({ from, to, kind, dense }: Pending, seen: Seen, pending: Pending[]): void {
  if (kind === "Map") {
    for (const [key, entry] of mapEntries(from)) {
      Reflect.apply(mapSet, to, [shell(key, seen, pending), shell(entry, seen, pending)]);
    }
  } else if (kind === "Set") {
    for (const member of setValues(from)) Reflect.apply(setAdd, to, [shell(member, seen, pending)]);
  }

  if (dense) {
    // `to` holds the element values; own data elements of a fresh array, so
    // plain assignment cannot reach a setter.
    const elements = to as unknown[];
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      if (typeof element === "object" && element !== null) elements[index] = shell(element, seen, pending);
    }
    return;
  }

  for (const key of kind === "TypedArray" ? typedArrayExtraKeys(from) : ownEnumerableKeys(from)) {
    Object.defineProperty(to, key, {
      value: shell(Reflect.get(from, key) as unknown, seen, pending),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}
