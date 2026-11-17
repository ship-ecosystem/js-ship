export function frozenMap<T>(map: Map<string, T>): ReadonlyMap<string, T> {
  const copy = new Map(map);
  const view: ReadonlyMap<string, T> = Object.freeze({
    size: copy.size, get: (key: string) => copy.get(key), has: (key: string) => copy.has(key),
    keys: () => copy.keys(), values: () => copy.values(), entries: () => copy.entries(),
    [Symbol.iterator]: () => copy[Symbol.iterator](),
    forEach: (callback: (value: T, key: string, map: ReadonlyMap<string, T>) => void, thisArg?: unknown) => copy.forEach((value, key) => callback.call(thisArg, value, key, view)),
  });
  return view;
}
