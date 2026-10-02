/**
 * zkAPI ships a browser wallet. These are the few browser surfaces it needs to run under Node for an agent:
 * IndexedDB (fake-indexeddb, saved to disk after every write transaction and restored before the SDK opens it),
 * localStorage (a JSON file), Worker (a worker_thread with a small bootstrap), window/document/navigator/location,
 * and a fetch that serves file:// URLs and sends the deployment proxy path straight to zkAPI's server.
 */
import "fake-indexeddb/auto";
import { IDBDatabase } from "fake-indexeddb";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";

const reviver = (_: string, v: unknown) =>
  v && typeof v === "object" && "__bigint" in (v as object) ? BigInt((v as { __bigint: string }).__bigint)
  : v && typeof v === "object" && "__u8" in (v as object) ? new Uint8Array(Buffer.from((v as { __u8: string }).__u8, "base64"))
  : v;
const replacer = (_: string, v: unknown) => (typeof v === "bigint" ? { __bigint: v.toString() } : v instanceof Uint8Array ? { __u8: Buffer.from(v).toString("base64") } : v);

type Dump = { name: string; version: number; stores: Record<string, { meta: { keyPath: string | string[] | null; autoIncrement: boolean; indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[] }; keys: unknown[]; values: unknown[] }> };

/** Everything in the database, as JSON. Called after each write so a crash loses at most the transaction in flight. */
function dumpDatabase(db: IDBDatabase, file: string): Promise<void> {
  return new Promise((resolve) => {
    const names = [...db.objectStoreNames];
    if (!names.length) return resolve();
    const tx = db.transaction(names, "readonly");
    const out: Dump = { name: db.name, version: db.version, stores: {} };
    let left = names.length;
    for (const n of names) {
      const store = tx.objectStore(n);
      const meta = { keyPath: store.keyPath as string | string[] | null, autoIncrement: store.autoIncrement, indexes: [...store.indexNames].map((i) => { const ix = store.index(i); return { name: i, keyPath: ix.keyPath as string | string[], unique: ix.unique, multiEntry: ix.multiEntry }; }) };
      const keys = store.getAllKeys();
      const vals = store.getAll();
      // Both requests are in flight at once; whichever lands second completes the store.
      let got = 0;
      const one = () => {
        if (++got < 2) return;
        out.stores[n] = { meta, keys: keys.result, values: vals.result };
        if (--left === 0) {
          const tmp = `${file}.tmp`;
          writeFileSync(tmp, JSON.stringify(out, replacer));
          writeFileSync(file, readFileSync(tmp));
          resolve();
        }
      };
      keys.onsuccess = one;
      vals.onsuccess = one;
      keys.onerror = vals.onerror = () => resolve();
    }
  });
}

/** Recreate the saved database (same name, version, stores, rows) before the SDK opens it, so no upgrade runs and the data is there. */
function restoreDatabase(file: string): Promise<void> {
  if (!existsSync(file)) return Promise.resolve();
  const saved = JSON.parse(readFileSync(file, "utf8"), reviver) as Dump;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(saved.name, saved.version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [n, s] of Object.entries(saved.stores)) {
        const store = db.createObjectStore(n, { keyPath: s.meta.keyPath ?? undefined, autoIncrement: s.meta.autoIncrement });
        for (const ix of s.meta.indexes) store.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
        s.values.forEach((v, i) => (s.meta.keyPath ? store.put(v) : store.put(v, s.keys[i] as IDBValidKey)));
      }
    };
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  });
}

export type ShimOptions = { stateDir: string; deploymentServer: string; proxyPath?: string };

export async function installShims({ stateDir, deploymentServer, proxyPath = "/zkapi-deployment/" }: ShimOptions) {
  mkdirSync(stateDir, { recursive: true });
  const origin = deploymentServer.replace(/\/$/, "");
  const g = globalThis as unknown as Record<string, unknown>;

  // fetch: file URLs from disk; the deployment proxy path (relative or on the fake origin) → zkAPI's server; cache/credentials dropped.
  const realFetch = globalThis.fetch.bind(globalThis);
  g.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input instanceof URL ? input.href : input);
    const target = raw.startsWith(proxyPath) ? `${origin}/${raw.slice(proxyPath.length)}` : raw.startsWith(origin + proxyPath) ? `${origin}/${raw.slice((origin + proxyPath).length)}` : raw;
    if (target.startsWith("file:")) {
      const bytes = readFileSync(fileURLToPath(target));
      return new Response(bytes, { status: 200, headers: { "content-type": target.endsWith(".json") ? "application/json" : target.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" } });
    }
    const { cache, credentials, ...rest } = init ?? {};
    void cache; void credentials;
    return realFetch(target, rest);
  };

  // localStorage → one JSON file
  const lsFile = path.join(stateDir, "localStorage.json");
  const ls = new Map<string, string>(Object.entries(existsSync(lsFile) ? (JSON.parse(readFileSync(lsFile, "utf8")) as Record<string, string>) : {}));
  const saveLs = () => writeFileSync(lsFile, JSON.stringify(Object.fromEntries(ls)));
  g.localStorage = {
    getItem: (k: string) => (ls.has(k) ? ls.get(k)! : null),
    setItem: (k: string, v: string) => { ls.set(k, String(v)); saveLs(); },
    removeItem: (k: string) => { ls.delete(k); saveLs(); },
    key: (i: number) => [...ls.keys()][i] ?? null,
    get length() { return ls.size; },
    clear: () => { ls.clear(); saveLs(); },
  };

  // the "page": window is the global, location is the deployment server (so relative manifest URLs resolve), document is visible.
  g.window = globalThis;
  g.location = { href: `${origin}/`, origin, search: "", pathname: "/" };
  g.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "zipcoin-agent", storage: undefined, locks: undefined }, configurable: true });
  if (typeof g.CustomEvent === "undefined") g.CustomEvent = class CustomEvent extends Event { detail: unknown; constructor(t: string, o?: { detail?: unknown }) { super(t); this.detail = o?.detail; } };
  if (typeof g.dispatchEvent === "undefined") {
    const et = new EventTarget();
    g.dispatchEvent = (e: Event) => et.dispatchEvent(e);
    g.addEventListener = (...a: Parameters<EventTarget["addEventListener"]>) => et.addEventListener(...a);
    g.removeEventListener = (...a: Parameters<EventTarget["removeEventListener"]>) => et.removeEventListener(...a);
  }

  // Worker → worker_threads + bootstrap
  const boot = new URL("./worker-boot.mjs", import.meta.url);
  g.Worker = class Worker extends EventTarget {
    w: NodeWorker;
    constructor(url: string | URL) {
      super();
      const file = url instanceof URL ? fileURLToPath(url) : String(url).startsWith("file:") ? fileURLToPath(url) : String(url);
      this.w = new NodeWorker(boot, { workerData: { file } });
      this.w.on("message", (data) => this.dispatchEvent(Object.assign(new Event("message"), { data })));
      this.w.on("error", (err) => this.dispatchEvent(Object.assign(new Event("error"), { message: err?.message ?? String(err) })));
      this.w.unref();
    }
    postMessage(m: unknown, transfer?: Transferable[]) { this.w.postMessage(m, transfer as never); }
    terminate() { return this.w.terminate(); }
  };

  // IndexedDB: restore, then save after every write transaction.
  const idbFile = path.join(stateDir, "indexeddb.json");
  await restoreDatabase(idbFile);
  const origTx = IDBDatabase.prototype.transaction;
  let pending: Promise<void> = Promise.resolve();
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, names: string | string[], mode?: IDBTransactionMode, opts?: IDBTransactionOptions) {
    const tx = origTx.call(this, names, mode, opts);
    if (mode === "readwrite") {
      const db = this;
      tx.addEventListener("complete", () => { pending = pending.then(() => dumpDatabase(db, idbFile)).catch(() => {}); });
    }
    return tx;
  } as typeof IDBDatabase.prototype.transaction;
  // A flush that can never hang the command: the dump is best-effort after the first few seconds, but a slow disk is not a lost note.
  const flush = () => Promise.race([pending, new Promise<void>((_, rej) => setTimeout(() => rej(new Error("state flush timed out")), 15_000))]);
  return { flush };
}
