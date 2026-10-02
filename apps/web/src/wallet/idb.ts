/** Minimal promise wrapper around a single IndexedDB key-value store. */

const DB_NAME = "bankforall";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idb = {
  get: <T>(key: string) => tx<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => tx("readwrite", (s) => s.put(value, key)).then(() => undefined),
  del: (key: string) => tx("readwrite", (s) => s.delete(key)).then(() => undefined),
};

/** For tests: forget the cached connection. */
export function resetIdbForTests() {
  dbPromise = null;
}
