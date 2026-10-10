/**
 * Structural deep equality, used as the default output comparator and the
 * default "did the mutation change anything" check. This file is shared,
 * byte for byte, by payout-invariance-kit and mutation-invariance-kit.
 *
 * The design rule is to fail closed: when two values cannot be shown equal,
 * they are reported as different. A false "different" is loud (the check
 * fails and you look); a false "equal" would let a real dependence pass.
 *
 * Built-ins are recognized by brand checks: intrinsic operations, captured
 * when this module loads and called with the value as the receiver, that
 * only succeed on a value with the matching internal slot. Their content is
 * read through the same intrinsics. Nothing here trusts `Symbol.toStringTag`,
 * an own method, or an own getter to say what a value is or what it holds.
 */

/**
 * Internal. How an object is compared and copied. `Opaque` means "not
 * comparable": its state cannot be read, so it is equal only to itself.
 */
export type Kind =
  | "Object"
  | "Arguments"
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

// ---------------------------------------------------------------------------
// Intrinsics. `uncurry(f)(receiver, ...args)` runs `f` with `receiver` as
// `this` through a `Reflect.apply` captured now, so nothing on the value can
// redirect it.
// ---------------------------------------------------------------------------

type Intrinsic = (receiver: unknown, ...args: unknown[]) => unknown;
type AnyFunction = (this: unknown, ...args: never[]) => unknown;

const reflectApply = Reflect.apply;

const uncurry =
  (fn: AnyFunction): Intrinsic =>
  (receiver, ...args) =>
    reflectApply(fn, receiver, args) as unknown;

function ownDescriptor(object: object | undefined, key: PropertyKey): { get?: unknown; value?: unknown } | undefined {
  return object === undefined ? undefined : Object.getOwnPropertyDescriptor(object, key);
}

function getterOf(proto: object | undefined, key: PropertyKey): Intrinsic | undefined {
  const get = ownDescriptor(proto, key)?.get;
  return typeof get === "function" ? uncurry(get as AnyFunction) : undefined;
}

function methodOf(proto: object | undefined, key: PropertyKey): Intrinsic | undefined {
  const fn = ownDescriptor(proto, key)?.value;
  return typeof fn === "function" ? uncurry(fn as AnyFunction) : undefined;
}

function protoOf(name: string): object | undefined {
  const ctor: unknown = Reflect.get(globalThis, name);
  return typeof ctor === "function" ? (ctor.prototype as object) : undefined;
}

const TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const ErrorPrototype = Error.prototype as object;
const RegExpPrototype = RegExp.prototype as object;
const SharedArrayBufferPrototype = protoOf("SharedArrayBuffer");
const WeakRefPrototype = protoOf("WeakRef");

const typedArrayTag = getterOf(TypedArrayPrototype, Symbol.toStringTag) as Intrinsic;
const typedArrayLengthOf = getterOf(TypedArrayPrototype, "length") as Intrinsic;
const typedArraySet = methodOf(TypedArrayPrototype, "set") as Intrinsic;
const arrayBufferByteLength = getterOf(ArrayBuffer.prototype, "byteLength") as Intrinsic;
const sharedArrayBufferByteLength = getterOf(SharedArrayBufferPrototype, "byteLength");
const dataViewBuffer = getterOf(DataView.prototype, "buffer") as Intrinsic;
const dataViewByteOffset = getterOf(DataView.prototype, "byteOffset") as Intrinsic;
const dataViewByteLength = getterOf(DataView.prototype, "byteLength") as Intrinsic;
const mapSize = getterOf(Map.prototype, "size") as Intrinsic;
const mapEntriesOf = methodOf(Map.prototype, "entries") as Intrinsic;
const mapIteratorNext = methodOf(Object.getPrototypeOf(new Map().entries()) as object, "next") as Intrinsic;
const mapHas = methodOf(Map.prototype, "has") as Intrinsic;
const mapGet = methodOf(Map.prototype, "get") as Intrinsic;
const setSize = getterOf(Set.prototype, "size") as Intrinsic;
const setValuesOf = methodOf(Set.prototype, "values") as Intrinsic;
const setIteratorNext = methodOf(Object.getPrototypeOf(new Set().values()) as object, "next") as Intrinsic;
const setHas = methodOf(Set.prototype, "has") as Intrinsic;
const weakMapHas = methodOf(WeakMap.prototype, "has") as Intrinsic;
const weakSetHas = methodOf(WeakSet.prototype, "has") as Intrinsic;
const weakRefDeref = methodOf(WeakRefPrototype, "deref");
const finalizationRegistryUnregister = methodOf(protoOf("FinalizationRegistry"), "unregister");
const dateGetTime = methodOf(Date.prototype, "getTime") as Intrinsic;
const regExpSource = getterOf(RegExpPrototype, "source") as Intrinsic;
const regExpFlagGetters = (
  [
    ["hasIndices", "d"],
    ["global", "g"],
    ["ignoreCase", "i"],
    ["multiline", "m"],
    ["dotAll", "s"],
    ["unicode", "u"],
    ["unicodeSets", "v"],
    ["sticky", "y"],
  ] as const
).flatMap(([key, flag]) => {
  const get = getterOf(RegExpPrototype, key);
  return get === undefined ? [] : [[get, flag] as const];
});
const boxedValueOf = ["Number", "String", "Boolean", "Symbol", "BigInt"].flatMap((name) => {
  const valueOf = methodOf(protoOf(name), "valueOf");
  return valueOf === undefined ? [] : [valueOf];
});
const objectToString = methodOf(Object.prototype, "toString") as Intrinsic;
const propertyIsEnumerable = methodOf(Object.prototype, "propertyIsEnumerable") as Intrinsic;
const hasOwnProperty = methodOf(Object.prototype, "hasOwnProperty") as Intrinsic;
const objectKeys = Object.keys;
const arrayFrom = Array.from as AnyFunction;
const objectSymbols = Object.getOwnPropertySymbols;
const hasEnumerableIndex = (array: object, index: number): boolean =>
  Object.prototype.propertyIsEnumerable.call(array, index);

/** Internal. Every typed array type a runtime may have, by constructor name. */
export const TYPED_ARRAY_NAMES = [
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
] as const;

/** Built-ins whose state lives in internal slots, by constructor name. */
const SLOT_BUILTINS = [
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "FinalizationRegistry",
  "Promise",
  "Date",
  "RegExp",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Number",
  "String",
  "Boolean",
  "Symbol",
  "BigInt",
];

/**
 * Prototypes of built-ins whose state lives in internal slots. A value that
 * is one of these prototypes, or inherits from one but fails its brand check
 * (a Proxy around a Map, `Object.create(Date.prototype)`, a Promise, which
 * has no side-effect free brand check) is not comparable.
 */
const slotPrototypes = new Set<object>(
  SLOT_BUILTINS.flatMap((name) => {
    const proto = protoOf(name);
    return proto === undefined ? [] : [proto];
  }),
);
slotPrototypes.add(TypedArrayPrototype);

/**
 * The same built-ins by name, used to recognize them from another realm
 * (a `node:vm` context, an iframe), whose prototypes are different objects.
 * "TypedArray" is the name of the shared typed-array constructor.
 */
const slotBuiltinNames = new Set<string>([...SLOT_BUILTINS, ...TYPED_ARRAY_NAMES, "TypedArray"]);

const functionToString = methodOf(Function.prototype, "toString") as Intrinsic;
const NATIVE_CODE = /\{\s*\[native code\]\s*\}\s*$/;

/**
 * "Error" or "Slot" if `fn` is a built-in constructor from any realm: a
 * native function named "Error" or named like one of the slot built-ins.
 * A user class that is merely named `Map` is not native, so it does not
 * count. Reads own data descriptors only.
 */
function builtinConstructorKind(fn: unknown): "Error" | "Slot" | undefined {
  if (typeof fn !== "function") return undefined;
  const name = ownDescriptor(fn, "name")?.value;
  if (typeof name !== "string" || (name !== "Error" && !slotBuiltinNames.has(name))) return undefined;
  const source = functionToString(fn);
  if (typeof source !== "string" || !NATIVE_CODE.test(source)) return undefined;
  return name === "Error" ? "Error" : "Slot";
}

/** "Error" or "Slot" if `object` is the `prototype` of a built-in constructor from any realm. */
function builtinPrototypeKind(object: object): "Error" | "Slot" | undefined {
  const ctor = ownDescriptor(object, "constructor")?.value;
  if (typeof ctor !== "function" || ownDescriptor(ctor, "prototype")?.value !== object) return undefined;
  return builtinConstructorKind(ctor);
}

// ---------------------------------------------------------------------------
// Classification.
// ---------------------------------------------------------------------------

function passes(brand: Intrinsic | undefined, value: object, arg?: unknown): boolean {
  if (brand === undefined) return false;
  try {
    brand(value, arg);
    return true;
  } catch {
    return false;
  }
}

type Brand = "Map" | "Set" | "ArrayBuffer" | "SharedArrayBuffer" | "Date" | "RegExp" | "Boxed" | "Opaque" | "None";

/**
 * A value's internal slots never change, so its brand is cached. Copies made
 * by `snapshot` are registered here as they are created.
 */
const brandCache = new WeakMap<object, Brand>();

/** Kinds whose brand comes from an internal slot (the rest have brand "None"). */
const slotBrands = new Set<Kind>(["Map", "Set", "ArrayBuffer", "SharedArrayBuffer", "Date", "RegExp", "Boxed"]);

/** Internal. Record the brand of a value this package just created. */
export function registerBrand(value: object, kind: Kind): void {
  brandCache.set(value, slotBrands.has(kind) ? (kind as Brand) : "None");
}

/**
 * Failed brand checks throw, and building a stack trace is most of their
 * cost. None of these intrinsics can run caller code, so stack traces are
 * switched off only for the duration of the probe (where the engine allows).
 */
function probeBrand(value: object): Brand {
  const errorConstructor = Error as { stackTraceLimit?: unknown };
  const saved = errorConstructor.stackTraceLimit;
  let lowered = false;
  if (typeof saved === "number") {
    try {
      errorConstructor.stackTraceLimit = 0;
      lowered = true;
    } catch {
      // A frozen Error: keep full stack traces.
    }
  }
  try {
    if (passes(mapSize, value)) return "Map";
    if (passes(setSize, value)) return "Set";
    if (passes(arrayBufferByteLength, value)) return "ArrayBuffer";
    if (passes(sharedArrayBufferByteLength, value)) return "SharedArrayBuffer";
    if (passes(dateGetTime, value)) return "Date";
    // RegExp.prototype itself answers `source` without being a RegExp.
    if (value !== RegExpPrototype && passes(regExpSource, value)) return "RegExp";
    if (boxedValueOf.some((valueOf) => passes(valueOf, value))) return "Boxed";
    // Unregistering a token that was never registered changes nothing.
    if (
      passes(weakMapHas, value, {}) ||
      passes(weakSetHas, value, {}) ||
      passes(weakRefDeref, value) ||
      passes(finalizationRegistryUnregister, value, {})
    ) {
      return "Opaque";
    }
    return "None";
  } finally {
    if (lowered) errorConstructor.stackTraceLimit = saved;
  }
}

function brandOf(value: object): Brand {
  let brand = brandCache.get(value);
  if (brand === undefined) {
    brand = probeBrand(value);
    brandCache.set(value, brand);
  }
  return brand;
}

/** Longest prototype chain walked before a value is declared not comparable. */
const MAX_PROTOTYPE_CHAIN = 10_000;

/**
 * For a value with no built-in brand: "Error" if an `Error.prototype` (from
 * any realm) is on its chain; "Opaque" if the chain holds a slot built-in's
 * prototype (from any realm) or any string (or getter) `Symbol.toStringTag`;
 * otherwise undefined. Reads property descriptors only, so no tag getter
 * ever runs.
 */
function classifyByChain(value: object): "Error" | "Opaque" | undefined {
  let isError = false;
  let notComparable = false;
  let depth = 0;
  for (let object: object | null = value; object !== null; object = Object.getPrototypeOf(object) as object | null) {
    depth += 1;
    if (depth > MAX_PROTOTYPE_CHAIN) return "Opaque";
    if (object === ErrorPrototype) isError = true;
    if (slotPrototypes.has(object)) notComparable = true;
    const tag = Object.getOwnPropertyDescriptor(object, Symbol.toStringTag);
    if (tag !== undefined && (typeof tag.value === "string" || tag.get !== undefined || tag.set !== undefined)) {
      notComparable = true;
    }
    const builtin = builtinPrototypeKind(object);
    if (builtin === "Error") isError = true;
    if (builtin === "Slot") notComparable = true;
  }
  if (isError) return "Error";
  return notComparable ? "Opaque" : undefined;
}

/**
 * True if a value's inherited `constructor` is a built-in (from any realm)
 * that its prototype chain did not show: a Proxy whose `getPrototypeOf`
 * trap hides the Date inside it. An own `constructor` property is data and
 * is compared like any other key.
 */
function constructorClaimsBuiltin(value: object): boolean {
  if (Object.getOwnPropertyDescriptor(value, "constructor") !== undefined) return false;
  return builtinConstructorKind(read(value, "constructor")) !== undefined;
}

function classify(value: object): Kind {
  if (Array.isArray(value)) return "Array";
  // The only views are typed arrays and DataViews.
  if (ArrayBuffer.isView(value)) return typeof typedArrayTag(value) === "string" ? "TypedArray" : "DataView";
  const brand = brandOf(value);
  if (brand !== "None") return brand;
  const byChain = classifyByChain(value);
  if (byChain !== undefined) return byChain;
  if (constructorClaimsBuiltin(value)) return "Opaque";
  // With no tag anywhere on the chain, Object.prototype.toString reports the
  // engine's own tag: an `arguments` object, or an Error whose prototype was
  // replaced. Any other built-in tag here comes from a value that failed that
  // built-in's brand check (a Proxy that answers `Symbol.toStringTag`), so it
  // is not comparable rather than an ordinary object.
  switch (objectToString(value)) {
    case "[object Object]":
      return "Object";
    case "[object Arguments]":
      return "Arguments";
    case "[object Error]":
      return "Error";
    default:
      return "Opaque";
  }
}

/**
 * Internal. Classify an object (see `Kind`). A value that cannot even be
 * classified (a revoked Proxy, a Proxy trap that throws) is "Opaque".
 */
export function kindOf(value: object): Kind {
  try {
    return classify(value);
  } catch (error) {
    // A stack overflow is not a property of the value: let it surface rather
    // than turn a deeply nested (or deeply called) comparison into "different".
    if (error instanceof RangeError) throw error;
    return "Opaque";
  }
}

// ---------------------------------------------------------------------------
// Content readers, shared with snapshot.ts. Each expects a value of the
// matching kind.
// ---------------------------------------------------------------------------

/** Internal. The element type of a real typed array ("Uint8Array", ...). */
export function typedArrayName(value: object): string {
  return typedArrayTag(value) as string;
}

/** Internal. A typed array's length (0 once its buffer is detached). */
export function typedArrayLength(value: object): number {
  return typedArrayLengthOf(value) as number;
}

/** Internal. Copy a typed array's elements into a new one of the same type and length. */
export function copyTypedArrayInto(target: object, source: object): void {
  typedArraySet(target, source);
}

/** Internal. A Date's time value. */
export function dateValue(value: object): number {
  return dateGetTime(value) as number;
}

/** Internal. A RegExp's source, flags (canonical order) and lastIndex. */
export function regExpParts(value: object): { source: string; flags: string; lastIndex: unknown } {
  let flags = "";
  for (const [get, flag] of regExpFlagGetters) if (get(value) === true) flags += flag;
  return {
    source: regExpSource(value) as string,
    flags,
    lastIndex: Object.getOwnPropertyDescriptor(value, "lastIndex")?.value,
  };
}

/** Internal. A boxed primitive's own value. */
function boxedValue(value: object): unknown {
  for (const valueOf of boxedValueOf) {
    try {
      return valueOf(value);
    } catch {
      // not this wrapper type
    }
  }
  return undefined;
}

function drain(iterator: unknown, next: Intrinsic): unknown[] {
  const items: unknown[] = [];
  for (;;) {
    const step = next(iterator) as IteratorResult<unknown>;
    if (step.done === true) return items;
    items.push(step.value);
  }
}

/** Internal. A Map's entries, in insertion order. */
export function mapEntries(value: object): [unknown, unknown][] {
  return drain(mapEntriesOf(value), mapIteratorNext) as [unknown, unknown][];
}

/** Internal. A Set's members, in insertion order. */
export function setValues(value: object): unknown[] {
  return drain(setValuesOf(value), setIteratorNext);
}

/** Internal. The bytes of an ArrayBuffer or SharedArrayBuffer (empty once detached). */
export function bufferBytes(value: object, kind: "ArrayBuffer" | "SharedArrayBuffer"): Uint8Array {
  const byteLength = (kind === "ArrayBuffer" ? arrayBufferByteLength : (sharedArrayBufferByteLength as Intrinsic))(
    value,
  ) as number;
  return byteLength === 0 ? new Uint8Array(0) : new Uint8Array(value as ArrayBufferLike, 0, byteLength);
}

/** The bytes a DataView can see, or undefined when they cannot be read (detached or out of bounds). */
function dataViewBytes(value: object): Uint8Array | undefined {
  try {
    const byteLength = dataViewByteLength(value) as number;
    const byteOffset = dataViewByteOffset(value) as number;
    return new Uint8Array(dataViewBuffer(value) as ArrayBufferLike, byteOffset, byteLength);
  } catch {
    return undefined;
  }
}

/** Internal. Own enumerable string keys, then own enumerable symbols. */
export function ownEnumerableKeys(value: object): (string | symbol)[] {
  const keys: (string | symbol)[] = objectKeys(value);
  for (const symbol of objectSymbols(value)) {
    if (propertyIsEnumerable(value, symbol) === true) keys.push(symbol);
  }
  return keys;
}

/** True if `value` has an own enumerable symbol key. */
function hasEnumerableSymbol(value: object): boolean {
  for (const symbol of objectSymbols(value)) {
    if (propertyIsEnumerable(value, symbol) === true) return true;
  }
  return false;
}

/**
 * Internal. The fast path for arrays. If `array` is "clean" (its own
 * enumerable keys are exactly the indices 0 to length - 1 and nothing else,
 * not even an enumerable symbol), returns a new array holding its element
 * values, each read once by index (so a getter runs once and a Proxy that
 * lists its keys in another order cannot reorder the elements). Otherwise
 * (a hole, a non-enumerable element, an extra key) returns undefined, having
 * run no getter, and the caller takes the exact key-by-key path.
 *
 * `Object.keys` counts the enumerable string keys without reading any value.
 * A count equal to the length is not enough on its own (a hole and an extra
 * key cancel out), so every index is also confirmed: by the key list itself
 * when it is in the usual order, otherwise one `propertyIsEnumerable` check
 * per index. A "clean" answer is exact.
 */
export function denseElements(array: object): unknown[] | undefined {
  const length = (array as unknown[]).length;
  const keys = objectKeys(array);
  if (keys.length !== length) return undefined;
  let inOrder = true;
  for (let index = 0; index < length; index += 1) {
    if (keys[index] !== String(index)) {
      inOrder = false;
      break;
    }
  }
  if (!inOrder) {
    for (let index = 0; index < length; index += 1) {
      if (!hasEnumerableIndex(array, index)) return undefined;
    }
  }
  if (hasEnumerableSymbol(array)) return undefined;
  // Array.from creates own data properties, so an accessor an outside script
  // put on Array.prototype (a setter that discards writes) cannot swallow an
  // element the way plain assignment into a fresh array would.
  return reflectApply(arrayFrom, Array, [{ length }, (_: unknown, index: number) => (array as unknown[])[index]]) as unknown[];
}

/**
 * Internal. A typed array's own enumerable keys other than its element
 * indices (named keys in creation order, then symbols). A real typed array
 * has exactly `length` enumerable index keys, listed first and in order, and
 * can never hold another index-like key, so the extra string keys are
 * whatever follows them. No value is read here.
 */
export function typedArrayExtraKeys(value: object): (string | symbol)[] {
  const keys = objectKeys(value);
  const extras: (string | symbol)[] = [];
  for (let index = typedArrayLength(value); index < keys.length; index += 1) extras.push(keys[index] as string);
  for (const symbol of objectSymbols(value)) {
    if (propertyIsEnumerable(value, symbol) === true) extras.push(symbol);
  }
  return extras;
}

function read(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key) as unknown;
}

/** True for values a Map/Set looks up by identity: primitives and functions. */
function isIdentityKey(value: unknown): boolean {
  return typeof value !== "object" || value === null;
}

// ---------------------------------------------------------------------------
// Comparison.
// ---------------------------------------------------------------------------

/** Options for `deepEqual`. Pass a plain object. */
export interface DeepEqualOptions {
  /**
   * When true, the order of a `Map`'s entries, a `Set`'s members and an
   * object's own enumerable keys is significant, so `new Set(["a", "b"])`
   * does not equal `new Set(["b", "a"])` and `{ a: 1, b: 2 }` does not equal
   * `{ b: 2, a: 1 }`. Defaults to false (order is ignored for those three).
   * Array order always matters. Must be a boolean when given.
   */
  orderSensitive?: boolean;
}

/**
 * Structural deep equality, similar to `node:util`'s `isDeepStrictEqual` but
 * with no Node dependency, and stricter about values it cannot see into.
 *
 * What it compares:
 * - Primitives with `Object.is`: `NaN` equals `NaN`, `0` and `-0` are
 *   different, and there is no floating-point tolerance (`0.1 + 0.2` is not
 *   `0.3`).
 * - Plain objects, class instances, `arguments` objects, arrays, `Map`,
 *   `Set`, `Date`, `RegExp`, `Error`, boxed primitives, `ArrayBuffer`,
 *   `SharedArrayBuffer`, `DataView`, and typed arrays, by content. Both sides must have the same
 *   prototype, so a class instance never equals a plain object with the
 *   same fields. On every one of these, own enumerable string and symbol
 *   keys are compared too (for example a `score` property attached to an
 *   `ArrayBuffer`); non-enumerable properties and private `#fields` are not
 *   (except an `Error`'s `name`, `message`, `cause`, and `errors`).
 * - Built-ins are recognized by brand checks and their content is read with
 *   the built-in operations themselves, so neither an own
 *   `Symbol.toStringTag` nor an overridden `getTime`, `valueOf`, `size`,
 *   iterator, `byteLength` or `length` changes the answer.
 * - Array holes are distinct from `undefined` (`[ , 1]` is not `[undefined, 1]`).
 * - Invalid dates (`new Date(NaN)`) equal each other.
 * - `Set` members and `Map` keys that are objects are matched by structure,
 *   one-to-one, so `new Set([{a:1},{a:1}])` does not equal
 *   `new Set([{a:1},{a:2}])`. That matching is quadratic in the number of
 *   object members.
 * - Order: by default the order of `Map` entries, `Set` members and object
 *   keys is NOT compared (a lookup table whose insertion order varies is
 *   still the same table). Pass `{ orderSensitive: true }` when the order is
 *   the answer, for example a ranking returned as a `Map`, `Set` or object.
 *   Array and typed array elements are always compared in order.
 * - Circular references are handled.
 *
 * Not comparable, so equal only to themselves (by reference): functions,
 * `WeakMap`, `WeakSet`, `WeakRef`, `FinalizationRegistry`, `Promise`, a
 * `DataView` whose buffer was detached, any object that has its own or an
 * inherited string `Symbol.toStringTag` without being one of the built-ins
 * above (`URL`, some decimal and date library classes), a built-in's
 * prototype object itself (`Date.prototype`), and any object that looks like
 * one of the built-ins above but fails its brand check. "Looks like" means a
 * built-in's prototype on its chain, from this realm or another (a `node:vm`
 * context, an iframe); an inherited `constructor` that is a built-in; or an
 * `Object.prototype.toString` tag other than `Object`, `Arguments` or
 * `Error`. So a `Proxy` around a `Date`, `Map`, `Number` or typed array
 * (from any realm), `Object.create(Date.prototype)`, and an old-style
 * subclass whose instances never got the internal slot are all not
 * comparable. A user class that is merely named `Map` or `Date` is an
 * ordinary class. Also not comparable: any object whose classification
 * throws (a revoked `Proxy`). Compare those with a custom `isEqual`.
 *
 * An `Error`'s state is ordinary properties, so anything with an
 * `Error.prototype` (from any realm) on its chain, including a `Proxy`
 * around an `Error`, is compared as an `Error` by those properties.
 *
 * Known gaps: a `Promise` whose prototype was replaced is compared as an
 * ordinary object (there is no side-effect-free way to recognize one), and
 * so is a `Proxy` whose traps hide both its prototype and its `constructor`.
 * Private `#fields` are never read, so two class instances whose state lives
 * only in private fields compare equal when their public properties match.
 *
 * An own `__proto__` key (from `JSON.parse`) is compared like any other key.
 * Never mutates its arguments. It reads (and so runs the getters of) only
 * the own enumerable properties it compares, `name` and `message` on
 * errors, and the inherited `constructor` of an object it would otherwise
 * compare as a plain object or class instance; an error thrown by such a
 * getter or by a `Proxy` trap propagates (except while classifying, where
 * it makes the value not comparable). Each object's brand is checked once
 * and cached.
 *
 * Nesting depth: objects, arrays, `Map` values, `Error` causes and ordered
 * `Map`/`Set` members are walked with an explicit work list, so depth is
 * limited by memory, not by the call stack. Matching object-keyed `Set` and
 * `Map` entries without `orderSensitive` still recurses, so thousands of
 * such collections nested inside one another throw a `RangeError` (a stack
 * overflow). That error is never turned into "different".
 *
 * Arrays and typed arrays take a fast path when they have no extra keys; the
 * answer is the same as the key-by-key comparison.
 */
export function deepEqual(a: unknown, b: unknown, options?: DeepEqualOptions): boolean {
  return run([a, b], { ordered: readOrderSensitive(options), visited: new WeakMap(), journal: null });
}

/** Read `options` once: undefined or a plain object whose `orderSensitive` is a boolean or undefined. */
export function readOrderSensitive(options: unknown): boolean {
  if (options === undefined) return false;
  if (typeof options !== "object" || options === null || kindOf(options) !== "Object") {
    throw new TypeError("deepEqual: options must be a plain object (or omitted).");
  }
  const proto = Object.getPrototypeOf(options) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError("deepEqual: options must be a plain object (or omitted).");
  }
  const value: unknown = Reflect.get(options, "orderSensitive");
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError("deepEqual: options.orderSensitive must be a boolean (or omitted).");
  }
  return value === true;
}

interface Context {
  ordered: boolean;
  /**
   * Pairs already reached. A pair reached again is assumed equal: any real
   * difference is found when the first visit finishes (the comparison is a
   * conjunction, so one failing pair fails everything above it).
   */
  visited: WeakMap<object, WeakSet<object>>;
  /** While trying one candidate match, the pairs it added, so a failed try can undo them. */
  journal: [object, object][] | null;
}

/** Compare `[a0, b0, a1, b1, ...]` pair by pair until one pair differs or the work list is empty. */
function run(work: unknown[], ctx: Context): boolean {
  while (work.length > 0) {
    const b = work.pop();
    const a = work.pop();
    if (!step(a, b, work, ctx)) return false;
  }
  return true;
}

/**
 * Try to show a candidate match (a Set member, or a Map key and value) equal.
 * Pairs a failed try reached are forgotten, so a wrong candidate cannot make
 * a later, correct one look equal.
 */
function trial(pairs: unknown[], ctx: Context): boolean {
  const outer = ctx.journal;
  const mine: [object, object][] = [];
  ctx.journal = mine;
  let equal: boolean;
  try {
    equal = run(pairs, ctx);
  } finally {
    ctx.journal = outer;
  }
  if (equal) {
    if (outer !== null) for (const entry of mine) outer.push(entry);
  } else {
    for (const [x, y] of mine) ctx.visited.get(x)?.delete(y);
  }
  return equal;
}

/** Queue a pair for comparison. False means the pair is already known to differ. */
function queue(work: unknown[], x: unknown, y: unknown): boolean {
  if (Object.is(x, y)) return true;
  if (typeof x !== "object" || typeof y !== "object" || x === null || y === null) return false;
  work.push(x, y);
  return true;
}

/** True the first time a pair is reached. */
function firstVisit(a: object, b: object, ctx: Context): boolean {
  let partners = ctx.visited.get(a);
  if (partners === undefined) {
    partners = new WeakSet();
    ctx.visited.set(a, partners);
  } else if (partners.has(b)) {
    return false;
  }
  partners.add(b);
  ctx.journal?.push([a, b]);
  return true;
}

function step(a: unknown, b: unknown, work: unknown[], ctx: Context): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const kind = kindOf(a);
  if (kind === "Opaque" || kind !== kindOf(b)) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  // Cycle guard (see Context.visited).
  if (!firstVisit(a, b, ctx)) return true;
  if (kind === "Array") return arraysEqual(a, b, work, ctx);
  return equalContents(a, b, kind, work, ctx) && sameOwnProperties(a, b, kind === "TypedArray", work, ctx);
}

function equalContents(
  a: object,
  b: object,
  kind: Exclude<Kind, "Opaque" | "Array">,
  work: unknown[],
  ctx: Context,
): boolean {
  switch (kind) {
    case "Object":
    case "Arguments":
      return true;
    case "Date":
      return Object.is(dateValue(a), dateValue(b));
    case "RegExp": {
      const ra = regExpParts(a);
      const rb = regExpParts(b);
      return ra.source === rb.source && ra.flags === rb.flags && Object.is(ra.lastIndex, rb.lastIndex);
    }
    case "Boxed":
      return Object.is(boxedValue(a), boxedValue(b));
    case "Error":
      return (
        Object.is(read(a, "name"), read(b, "name")) &&
        Object.is(read(a, "message"), read(b, "message")) &&
        sameOptionalOwn(a, b, "cause", work) &&
        sameOptionalOwn(a, b, "errors", work)
      );
    case "Map":
      return mapsEqual(a, b, work, ctx);
    case "Set":
      return setsEqual(a, b, work, ctx);
    case "ArrayBuffer":
    case "SharedArrayBuffer":
      return bytesEqual(bufferBytes(a, kind), bufferBytes(b, kind));
    case "DataView": {
      const bytesA = dataViewBytes(a);
      const bytesB = dataViewBytes(b);
      return bytesA !== undefined && bytesB !== undefined && bytesEqual(bytesA, bytesB);
    }
    case "TypedArray":
      return typedArrayName(a) === typedArrayName(b) && elementsEqual(a, b);
  }
}

/** Arrays: same length, then the elements (fast path) or every own key (exact path). */
function arraysEqual(a: object, b: object, work: unknown[], ctx: Context): boolean {
  const length = (a as unknown[]).length;
  if (length !== (b as unknown[]).length) return false;
  const elementsA = denseElements(a);
  const elementsB = denseElements(b);
  if (elementsA !== undefined && elementsB !== undefined) {
    for (let index = 0; index < length; index += 1) {
      if (!queue(work, elementsA[index], elementsB[index])) return false;
    }
    return true;
  }
  // A clean array can only equal another clean array: its keys are exactly 0..length-1.
  if (elementsA !== undefined || elementsB !== undefined) return false;
  return sameOwnProperties(a, b, false, work, ctx);
}

/** Own enumerable keys and values; typed arrays skip index keys (elements were compared already). */
function sameOwnProperties(a: object, b: object, typed: boolean, work: unknown[], ctx: Context): boolean {
  const keysA = typed ? typedArrayExtraKeys(a) : ownEnumerableKeys(a);
  const keysB = typed ? typedArrayExtraKeys(b) : ownEnumerableKeys(b);
  if (keysA.length !== keysB.length) return false;
  if (ctx.ordered) {
    for (let index = 0; index < keysA.length; index += 1) {
      if (keysA[index] !== keysB[index]) return false;
    }
  }
  for (const key of keysA) {
    if (propertyIsEnumerable(b, key) !== true) return false;
    if (!queue(work, read(a, key), read(b, key))) return false;
  }
  return true;
}

function sameOptionalOwn(a: object, b: object, key: string, work: unknown[]): boolean {
  const inA = hasOwnProperty(a, key) === true;
  if (inA !== (hasOwnProperty(b, key) === true)) return false;
  return !inA || queue(work, read(a, key), read(b, key));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function elementsEqual(a: object, b: object): boolean {
  const length = typedArrayLength(a);
  if (length !== typedArrayLength(b)) return false;
  const itemsA = a as ArrayLike<unknown>;
  const itemsB = b as ArrayLike<unknown>;
  for (let i = 0; i < length; i += 1) {
    if (!Object.is(itemsA[i], itemsB[i])) return false;
  }
  return true;
}

function mapsEqual(a: object, b: object, work: unknown[], ctx: Context): boolean {
  if (mapSize(a) !== mapSize(b)) return false;
  if (ctx.ordered) {
    const entriesB = mapEntries(b);
    const entriesA = mapEntries(a);
    if (entriesA.length !== entriesB.length) return false;
    for (let index = 0; index < entriesA.length; index += 1) {
      const [keyA, valueA] = entriesA[index] as [unknown, unknown];
      const [keyB, valueB] = entriesB[index] as [unknown, unknown];
      if (!queue(work, keyA, keyB) || !queue(work, valueA, valueB)) return false;
    }
    return true;
  }
  const objectKeyedA: [unknown, unknown][] = [];
  for (const [key, value] of mapEntries(a)) {
    if (isIdentityKey(key)) {
      if (mapHas(b, key) !== true || !queue(work, value, mapGet(b, key))) return false;
    } else {
      objectKeyedA.push([key, value]);
    }
  }
  const objectKeyedB = mapEntries(b).filter(([key]) => !isIdentityKey(key));
  if (objectKeyedA.length !== objectKeyedB.length) return false;
  // deepEqual is an equivalence relation, so greedy one-to-one matching is exact.
  for (const [keyA, valueA] of objectKeyedA) {
    const index = objectKeyedB.findIndex(([keyB, valueB]) => trial([keyA, keyB, valueA, valueB], ctx));
    if (index === -1) return false;
    objectKeyedB.splice(index, 1);
  }
  return true;
}

function setsEqual(a: object, b: object, work: unknown[], ctx: Context): boolean {
  if (setSize(a) !== setSize(b)) return false;
  if (ctx.ordered) {
    const membersB = setValues(b);
    const membersA = setValues(a);
    if (membersA.length !== membersB.length) return false;
    for (let index = 0; index < membersA.length; index += 1) {
      if (!queue(work, membersA[index], membersB[index])) return false;
    }
    return true;
  }
  const objectsA: unknown[] = [];
  for (const member of setValues(a)) {
    if (isIdentityKey(member)) {
      if (setHas(b, member) !== true) return false;
    } else {
      objectsA.push(member);
    }
  }
  const objectsB = setValues(b).filter((member) => !isIdentityKey(member));
  if (objectsA.length !== objectsB.length) return false;
  for (const member of objectsA) {
    const index = objectsB.findIndex((other) => trial([member, other], ctx));
    if (index === -1) return false;
    objectsB.splice(index, 1);
  }
  return true;
}
