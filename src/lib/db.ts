// Minimal IndexedDB key-value store. Everything the app persists lives here.
const DB_NAME = 'tape-bar-replay'
const STORE = 'kv'

let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbp
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const dbGet = <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key))
export const dbSet = (key: string, value: unknown) => run('readwrite', (s) => s.put(value, key))
export const dbDel = (key: string) => run('readwrite', (s) => s.delete(key))
