// Runs zkAPI's proof worker module inside a Node worker_thread, giving it the Web Worker surface it expects
// (self, postMessage, onmessage, a fetch that can read file:// URLs for the wasm and the proving keys).
import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const listeners = new Set();
globalThis.self = globalThis;
globalThis.postMessage = (m, transfer) => parentPort.postMessage(m, transfer);
globalThis.addEventListener = (type, fn) => { if (type === "message") listeners.add(fn); };
globalThis.removeEventListener = (type, fn) => { if (type === "message") listeners.delete(fn); };
Object.defineProperty(globalThis, "onmessage", { set(fn) { listeners.clear(); if (fn) listeners.add(fn); }, get() { return [...listeners][0] ?? null; } });
parentPort.on("message", (data) => { for (const fn of listeners) fn({ data }); });
globalThis.location = { href: pathToFileURL(workerData.file).href };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(String(input instanceof Request ? input.url : input), globalThis.location.href);
  if (url.protocol !== "file:") return realFetch(url, init);
  const bytes = readFileSync(fileURLToPath(url));
  return new Response(bytes, { status: 200, headers: { "content-type": url.pathname.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" } });
};
await import(pathToFileURL(workerData.file).href);
