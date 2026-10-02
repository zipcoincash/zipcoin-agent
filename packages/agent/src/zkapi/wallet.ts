/**
 * zkAPI from an agent: the same browser SDK the website uses, run under Node (see shims.ts). One note per state directory.
 * Works with zkAPI (Open Anonymity + EF dAI). Experimental: 30-day credit expiry, pausable vault, unaudited.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, createWalletClient, formatUnits, http, parseUnits, type Account } from "viem";
import { mainnet } from "viem/chains";

import { installShims } from "./shims.js";

const require = createRequire(import.meta.url);
export const DEFAULT_STATE_DIR = path.join(os.homedir(), ".config", "zipcoin", "zkapi");
export const KEY_CAP_USD = 1;

type Snapshot = {
  wallet: { note: { note_id: number; current_balance: string | number; expiry_ts: number } | null; pending_request?: boolean } | null;
  config: { active_lease?: { expires_at: number; spending_limit_usd: number } | null; pending_deposit?: { phase?: string; amount?: number; transaction_hash?: string | null } | null } | null;
};
type Access = { apiKey: string; baseUrl: string; headers: Record<string, string>; release: () => void };
type Client = {
  setWalletProvider(p: unknown): void;
  init(): Promise<unknown>;
  snapshot(): Snapshot;
  refreshEthUsdPrice(): Promise<{ answer: string; decimals: number }>;
  quoteDepositUsd(usd: string): Promise<{ ethAmount: string }>;
  prepareDepositQuote(eth: string, o: { from: string }): Promise<{ operationId: string; commitment: string }>;
  deposit(eth: string, onStatus: (s: string) => void, o?: { preparedOperationId?: string }): Promise<{ transactionHash?: string } | null>;
  recoverBrowserDeposit(onStatus?: (s: string) => void): Promise<{ status?: string } | null>;
  acquireInferenceAccess(sessionId: string, o: { spendingLimitUsd: number; onProgress?: (p: { message: string }) => void }): Promise<Access>;
  settleActiveLease(onStatus?: (s: string) => void): Promise<unknown>;
  withdraw(mode: "mutual" | "escape", onStatus: (s: string) => void, o?: { destination?: string }): Promise<unknown>;
  syncEscapeWithdrawals(onStatus?: (s: string) => void): Promise<unknown>;
};

/** The pinned mainnet config, with proving keys and worker read from the installed SDK. Written into the state dir for the SDK to load. */
function writeConfig(stateDir: string) {
  const sdkRoot = path.dirname(require.resolve("@openanonymity/zkapi-browser-sdk/package.json"));
  const pinned = JSON.parse(readFileSync(new URL("./mainnet.json", import.meta.url), "utf8")) as Record<string, unknown>;
  const cfg = { ...pinned, proving_keys_base_url: pathToFileURL(path.join(sdkRoot, "sdk", "assets", "proofs") + path.sep).href };
  const file = path.join(stateDir, "browser-config.json");
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  return { configUrl: pathToFileURL(file).href, workerUrl: pathToFileURL(path.join(sdkRoot, "sdk", "services", "zkapiWasmWorker.js")).href, server: (pinned.trusted_deployment as { protocol_server_url: string }).protocol_server_url };
}

export type Zkapi = { client: Client; snapshot: () => Snapshot; flush: () => Promise<void>; stateDir: string };

/** Boot the SDK for this account. The account signs the vault deposit and any close; it needs a little ETH for gas. */
export async function openZkapi(account: Account, rpc: string, stateDir = DEFAULT_STATE_DIR, log: (s: string) => void = () => {}): Promise<Zkapi> {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const { server } = (() => {
    const pinned = JSON.parse(readFileSync(new URL("./mainnet.json", import.meta.url), "utf8")) as { trusted_deployment: { protocol_server_url: string } };
    return { server: pinned.trusted_deployment.protocol_server_url };
  })();
  const { flush } = await installShims({ stateDir, deploymentServer: server });
  const { configUrl, workerUrl } = writeConfig(stateDir);
  const sdk = (await import("@openanonymity/zkapi-browser-sdk")) as unknown as { configureBrowserSdk: (o: unknown) => void; zkapiClient: Client };
  sdk.configureBrowserSdk({ configUrl, workerUrl });
  const pub = createPublicClient({ chain: mainnet, transport: http(rpc, { timeout: 30_000 }) });
  const wallet = createWalletClient({ account, chain: mainnet, transport: http(rpc) });
  // EIP-1193 over the agent's key: sign locally, broadcast ourselves; everything else is a plain RPC read.
  const provider = {
    request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address];
        case "eth_chainId":
          return "0x1";
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;
        case "eth_sendTransaction": {
          const tx = (params as [{ to: `0x${string}`; data?: `0x${string}`; value?: `0x${string}`; gas?: `0x${string}` }])[0];
          log(`signing a transaction to ${tx.to.slice(0, 10)}…`);
          return wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined });
        }
        default:
          return pub.request({ method, params } as never);
      }
    },
    on() {},
    removeListener() {},
  };
  const client = sdk.zkapiClient;
  client.setWalletProvider(provider);
  await client.init();
  return { client, snapshot: () => client.snapshot(), flush, stateDir };
}

export const gweiToEth = (units: string | number) => Number(units) / 1e9;

export async function zkDeposit(z: Zkapi, eth: string, from: string, log: (s: string) => void) {
  const prepared = await z.client.prepareDepositQuote(eth, { from });
  log(`note commitment ${prepared.commitment.slice(0, 14)}…`);
  // The note secret must be on disk before any ETH moves: if the process died after the deposit, the money would be lost.
  await z.flush();
  const saved = backupFile(z.stateDir);
  if (!saved || !readFileSync(saved, "utf8").includes(prepared.commitment.slice(2, 20))) throw new Error("the note was not saved to disk; refusing to deposit (nothing was sent)");
  log(`note saved in ${z.stateDir}`);
  const r = await z.client.deposit(eth, log, { preparedOperationId: prepared.operationId });
  await z.flush();
  return r?.transactionHash ?? null;
}

export async function zkChat(z: Zkapi, messages: { role: string; content: string }[], model: string, onDelta: (s: string) => void, log: (s: string) => void) {
  const access = await z.client.acquireInferenceAccess(`agent-${Date.now()}`, { spendingLimitUsd: KEY_CAP_USD, onProgress: (p) => log(p.message) });
  try {
    const r = await fetch(`${access.baseUrl}/chat/completions`, {
      method: "POST",
      headers: access.headers,
      body: JSON.stringify({ model, messages, stream: true, max_tokens: 4096, stream_options: { include_usage: true } }),
    });
    if (!r.ok || !r.body) throw new Error(`${r.status}: ${(await r.text()).slice(0, 300)}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let out = "";
    type Usage = { prompt_tokens: number; completion_tokens: number; cost?: number };
    let usage: Usage | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: Usage; error?: { message?: string } };
          if (j.error) throw new Error(j.error.message ?? "provider error");
          const d = j.choices?.[0]?.delta?.content;
          if (d) { out += d; onDelta(d); }
          if (j.usage) usage = j.usage;
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
        }
      }
    }
    return { text: out, usage: usage as Usage | null };
  } finally {
    access.release();
    await z.flush();
  }
}

export async function zkClose(z: Zkapi, destination: string, mode: "mutual" | "escape", log: (s: string) => void) {
  await z.client.withdraw(mode, log, { destination });
  await z.flush();
}

export function stateSummary(s: Snapshot, price: { answer: string; decimals: number } | null) {
  const note = s.wallet?.note ?? null;
  const usd = price ? Number(price.answer) / 10 ** price.decimals : 0;
  return {
    note: note ? { id: note.note_id, eth: gweiToEth(note.current_balance), usd: usd ? gweiToEth(note.current_balance) * usd : null, expires: new Date(note.expiry_ts * 1000).toISOString() } : null,
    pendingDeposit: s.config?.pending_deposit ?? null,
    activeLease: s.config?.active_lease ?? null,
    pendingRequest: !!s.wallet?.pending_request,
  };
}

export const backupFile = (stateDir: string) => (existsSync(path.join(stateDir, "indexeddb.json")) ? path.join(stateDir, "indexeddb.json") : null);
export const fmtEth = (v: bigint) => formatUnits(v, 18);
export const toWei = (v: string) => parseUnits(v, 18);
