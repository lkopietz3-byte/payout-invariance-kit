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

type PairMemo = WeakMap<object, WeakSet<object>>;

/**
 * Internal. How an object is compared and copied. `Opaque` means "not
 * comparable": its state cannot be read, so it is equal only to itself.
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

/**
 * Prototypes of built-ins whose state lives in internal slots. A value that
 * inherits from one of these but fails its brand check (a Proxy around a
 * Map, `Object.create(Date.prototype)`, a Promise, which has no side-effect
 * free brand check) is not comparable.
 */
const slotPrototypes = new Set<object>(
  [
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
  ].flatMap((name) => {
    const proto = protoOf(name);
    return proto === undefined ? [] : [proto];
  }),
);
slotPrototypes.add(TypedArrayPrototype);

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

/** Internal. Record the brand of a value this package just created. */
export function registerBrand(value: object, kind: Kind): void {
  if (kind === "Object" || kind === "Array" || kind === "TypedArray") brandCache.set(value, "None");
  else if (kind !== "Error" && kind !== "DataView") brandCache.set(value, kind);
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
 * For a value with no built-in brand: "Error" if `Error.prototype` is on its
 * chain; "Opaque" if the chain holds a slot built-in's prototype or any
 * string (or getter) `Symbol.toStringTag`; otherwise undefined. Reads
 * property descriptors only, so no tag getter ever runs.
 */
function classifyByChain(value: object): "Error" | "Opaque" | undefined {
  let isError = false;
  let notComparable = false;
  let depth = 0;
  for (let object: object | null = value; object !== null; object = Object.getPrototypeOf(object) as object | null) {
    depth += 1;
    if (depth > MAX_PROTOTYPE_CHAIN) return "Opaque";
    if (object === ErrorPrototype) isError = true;
    if (object !== value && slotPrototypes.has(object)) notComparable = true;
    const tag = Object.getOwnPropertyDescriptor(object, Symbol.toStringTag);
    if (tag !== undefined && (typeof tag.value === "string" || tag.get !== undefined || tag.set !== undefined)) {
      notComparable = true;
    }
  }
  if (isError) return "Error";
  return notComparable ? "Opaque" : undefined;
}

function classify(value: object): Kind {
  if (Array.isArray(value)) return "Array";
  if (ArrayBuffer.isView(value)) {
    if (typeof typedArrayTag(value) === "string") return "TypedArray";
    return passes(dataViewBuffer, value) ? "DataView" : "Opaque";
  }
  const brand = brandOf(value);
  if (brand !== "None") return brand;
  const byChain = classifyByChain(value);
  if (byChain !== undefined) return byChain;
  // An Error from another realm has none of this realm's prototypes; with no
  // tag anywhere on its chain, Object.prototype.toString reports its slot.
  return objectToString(value) === "[object Error]" ? "Error" : "Object";
}

/**
 * Internal. Classify an object (see `Kind`). A value that cannot even be
 * classified (a revoked Proxy, a Proxy trap that throws) is "Opaque".
 */
export function kindOf(value: object): Kind {
  try {
    return classify(value);
  } catch {
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
  const keys: (string | symbol)[] = Object.keys(value);
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    if (propertyIsEnumerable(value, symbol) === true) keys.push(symbol);
  }
  return keys;
}

/** Internal. True for a canonical array index key ("0", "1", ...). */
export function isIndexKey(key: string | symbol): boolean {
  return typeof key === "string" && /^(?:0|[1-9]\d*)$/.test(key);
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

/**
 * Structural deep equality, similar to `node:util`'s `isDeepStrictEqual` but
 * with no Node dependency, and stricter about values it cannot see into.
 *
 * What it compares:
 * - Primitives with `Object.is`: `NaN` equals `NaN`, `0` and `-0` are
 *   different, and there is no floating-point tolerance (`0.1 + 0.2` is not
 *   `0.3`). Pass your own `isEqual` for tolerance.
 * - Plain objects, class instances, arrays, `Map`, `Set`, `Date`, `RegExp`,
 *   `Error`, boxed primitives, `ArrayBuffer`, `SharedArrayBuffer`,
 *   `DataView`, and typed arrays, by content. Both sides must have the same
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
 * - Circular references are handled.
 *
 * Not comparable, so equal only to themselves (by reference): functions,
 * `WeakMap`, `WeakSet`, `WeakRef`, `FinalizationRegistry`, `Promise`, a
 * `DataView` whose buffer was detached, any object that has its own or an
 * inherited string `Symbol.toStringTag` without being one of the built-ins
 * above (`URL`, some decimal and date library classes), any object that
 * inherits from a built-in's prototype without being that built-in (a
 * `Proxy` around a `Map`, `Object.create(Date.prototype)`), and any object
 * whose classification throws (a revoked `Proxy`). Compare those with a
 * custom `isEqual`.
 *
 * Known gaps: a `Promise` whose prototype was replaced is compared as an
 * ordinary object (there is no side-effect-free way to recognize one), and
 * an `arguments` object is compared like a plain object.
 *
 * An own `__proto__` key (from `JSON.parse`) is compared like any other key.
 * Never mutates its arguments. It reads (and so runs the getters of) only
 * the own enumerable properties it compares, plus `name` and `message` on
 * errors; an error thrown by such a getter or by a `Proxy` trap propagates.
 * Each object's brand is checked once and cached.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return equal(a, b, new WeakMap());
}

function equal(a: unknown, b: unknown, memo: PairMemo): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const kind = kindOf(a);
  if (kind === "Opaque" || kind !== kindOf(b)) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

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
    return equalContents(a, b, kind, memo) && sameOwnProperties(a, b, kind === "TypedArray", memo);
  } finally {
    partners.delete(b);
  }
}

function equalContents(a: object, b: object, kind: Exclude<Kind, "Opaque">, memo: PairMemo): boolean {
  switch (kind) {
    case "Object":
      return true;
    case "Array":
      return (a as unknown[]).length === (b as unknown[]).length;
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
        sameOptionalOwn(a, b, "cause", memo) &&
        sameOptionalOwn(a, b, "errors", memo)
      );
    case "Map":
      return mapsEqual(a, b, memo);
    case "Set":
      return setsEqual(a, b, memo);
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

/** Own enumerable keys and values; typed arrays skip index keys (elements were compared already). */
function sameOwnProperties(a: object, b: object, skipIndexKeys: boolean, memo: PairMemo): boolean {
  const keep = (key: string | symbol): boolean => !skipIndexKeys || !isIndexKey(key);
  const keysA = ownEnumerableKeys(a).filter(keep);
  if (keysA.length !== ownEnumerableKeys(b).filter(keep).length) return false;
  for (const key of keysA) {
    if (propertyIsEnumerable(b, key) !== true) return false;
    if (!equal(read(a, key), read(b, key), memo)) return false;
  }
  return true;
}

function sameOptionalOwn(a: object, b: object, key: string, memo: PairMemo): boolean {
  const inA = hasOwnProperty(a, key) === true;
  if (inA !== (hasOwnProperty(b, key) === true)) return false;
  return !inA || equal(read(a, key), read(b, key), memo);
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

function mapsEqual(a: object, b: object, memo: PairMemo): boolean {
  if (mapSize(a) !== mapSize(b)) return false;
  const objectKeyedA: [unknown, unknown][] = [];
  for (const [key, value] of mapEntries(a)) {
    if (isIdentityKey(key)) {
      if (mapHas(b, key) !== true || !equal(value, mapGet(b, key), memo)) return false;
    } else {
      objectKeyedA.push([key, value]);
    }
  }
  const objectKeyedB = mapEntries(b).filter(([key]) => !isIdentityKey(key));
  if (objectKeyedA.length !== objectKeyedB.length) return false;
  // deepEqual is an equivalence relation, so greedy one-to-one matching is exact.
  for (const [keyA, valueA] of objectKeyedA) {
    const index = objectKeyedB.findIndex(([keyB, valueB]) => equal(keyA, keyB, memo) && equal(valueA, valueB, memo));
    if (index === -1) return false;
    objectKeyedB.splice(index, 1);
  }
  return true;
}

function setsEqual(a: object, b: object, memo: PairMemo): boolean {
  if (setSize(a) !== setSize(b)) return false;
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
    const index = objectsB.findIndex((other) => equal(member, other, memo));
    if (index === -1) return false;
    objectsB.splice(index, 1);
  }
  return true;
}
