import { createPublicClient, createWalletClient, encodeFunctionData, formatUnits, getAddress, http, isAddress, parseUnits, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

import { broadcasterAbi, doorstepAbi, entrypointAbi, erc20Abi } from "./abi.js";
import { encodeDoorSpeech, encodePayment, encodeRelayData, speechParams } from "./codec.js";
import { ADDR, API, MAX_MESSAGE_BYTES, MAX_TARGET_BYTES, MIN_BURN, MIN_BURN_OF_GIFT_BPS, POOLS, RPC, type PoolId } from "./config.js";
import { hashPrecommitment, type PoolStateJson } from "./tree.js";
import { depositSecrets, isApproved, masterKeys, mnemonicFromSignature, proveSpend, recoverNotes, ZIP_MESSAGE, type MasterKeys, type Note } from "./zip.js";
import { encodeAbiParameters } from "viem";

/**
 * zipcoin for agents.
 *
 * - speak(): burn ZC to publish a message, publicly (your address) or anonymously (from a zipped note).
 * - knock(): burn at someone's door (ENS or address), optionally leaving a gift.
 * - zip() / notes() / unzip(): put ZC, ETH, DAI, USDC or USDT into a Privacy Pool and spend it later to any address or a zk.money tag.
 * - door(), today(), feed(): read the book.
 *
 * Keys: a wallet private key (ZIPCOIN_KEY) for public burns and deposits; a zip phrase (ZIPCOIN_ZIP_PHRASE) for notes. If you give
 * only the key, the phrase is derived from a signature the same way the site does it, so a wallet's notes are the same here and there.
 * Proofs are generated locally; the relayer only ever sees the proof.
 */
export type Quote = { feeRecipient: Address | null; online: boolean; relayFeeBPS: string; minWithdraw: string; minSpeak: string; minDoor: string; minTag: string; ethCost: Record<string, string>; ethUsd: number };
export type Speech = { tx: string; block: number; time: number; speaker: string | null; speakerName: string | null; to: string | null; toName: string | null; message: string; target: string; burned: string; gift: string; viaEth?: boolean };
export type Opts = { key?: Hex; zipPhrase?: string; rpc?: string; api?: string };

const bytes = (s: string) => new TextEncoder().encode(s).length;
const wei = (v: bigint, d = 18) => formatUnits(v, d);

export class Zipcoin {
  readonly api: string;
  readonly pub: PublicClient;
  private readonly account: ReturnType<typeof privateKeyToAccount> | null;
  private readonly rpc: string;
  private keys: MasterKeys | null = null;
  private readonly phrase: string | undefined;

  constructor(o: Opts = {}) {
    this.api = o.api ?? API;
    this.rpc = o.rpc ?? RPC;
    this.pub = createPublicClient({ chain: mainnet, transport: http(this.rpc, { timeout: 30_000 }) });
    const key = (o.key ?? process.env.ZIPCOIN_KEY) as Hex | undefined;
    this.account = key ? privateKeyToAccount(key) : null;
    this.phrase = o.zipPhrase ?? process.env.ZIPCOIN_ZIP_PHRASE;
  }

  get address(): Address | null {
    return this.account?.address ?? null;
  }

  private wallet() {
    if (!this.account) throw new Error("a wallet key is needed for this (ZIPCOIN_KEY)");
    return createWalletClient({ account: this.account, chain: mainnet, transport: http(this.rpc) });
  }

  /** The zip key: from the phrase, or derived from the wallet's signature of the site's message (identical to the website). */
  async zipKeys(): Promise<MasterKeys> {
    if (this.keys) return this.keys;
    if (this.phrase) return (this.keys = masterKeys(this.phrase));
    if (!this.account) throw new Error("a zip phrase or a wallet key is needed (ZIPCOIN_ZIP_PHRASE or ZIPCOIN_KEY)");
    const sig = await this.account.signMessage({ message: ZIP_MESSAGE });
    return (this.keys = masterKeys(mnemonicFromSignature(sig)));
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------

  private async get<T>(path: string): Promise<T> {
    const r = await fetch(`${this.api}${path}`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return (await r.json()) as T;
  }
  quote = () => this.get<Quote>("/api/relay");
  state = (pool: PoolId = "zc") => this.get<PoolStateJson>(`/api/state?pool=${pool}`);
  /** Every word ever burned, newest first. */
  feed = () => this.get<Speech[]>("/api/feed");
  /** The words burned at a door. */
  async door(who: string) {
    const a = (await this.resolve(who)).toLowerCase();
    return (await this.feed()).filter((s) => s.to?.toLowerCase() === a);
  }
  /** Loudest words of the last 24 hours. */
  async today(n = 10) {
    const since = Math.floor(Date.now() / 1000) - 86_400;
    return (await this.feed())
      .filter((s) => s.time >= since)
      .sort((a, b) => Number(BigInt(b.burned) - BigInt(a.burned)))
      .slice(0, n);
  }
  /** Current price: ZC per ETH and USD, from the site's stats. */
  async price() {
    const s = await this.get<{ ethPerZc: number; ethUsd: number }>("/api/stats");
    return { usdPerZc: s.ethPerZc * s.ethUsd, ethUsd: s.ethUsd };
  }
  /** About how many ZC a dollar amount is right now, rounded up to a hundred. */
  async zcForUsd(usd: number) {
    const { usdPerZc } = await this.price();
    const zc = BigInt(Math.ceil(usd / usdPerZc / 100) * 100) * 10n ** 18n;
    return zc > MIN_BURN ? zc : MIN_BURN;
  }

  /** ENS name or address → address. */
  async resolve(who: string): Promise<Address> {
    if (isAddress(who)) return getAddress(who);
    const a = await this.pub.getEnsAddress({ name: normalize(who) });
    if (!a) throw new Error(`${who} does not resolve`);
    return a;
  }

  // ---- public burns (from the wallet) ------------------------------------------------------------------------------------

  private check(message: string, target: string, burn: bigint, gift = 0n) {
    if (!message.trim()) throw new Error("message is empty");
    if (bytes(message) > MAX_MESSAGE_BYTES) throw new Error(`message over ${MAX_MESSAGE_BYTES} bytes`);
    if (bytes(target) > MAX_TARGET_BYTES) throw new Error(`envelope over ${MAX_TARGET_BYTES} bytes`);
    if (burn < MIN_BURN) throw new Error(`burn below the contracts' floor of ${wei(MIN_BURN)} ZC`);
    if (gift > 0n && burn * 10_000n < gift * MIN_BURN_OF_GIFT_BPS) throw new Error("the burn must be at least a tenth of the gift");
  }

  private async approveZc(spender: Address, amount: bigint) {
    const w = this.wallet();
    const owner = this.account!.address;
    const allowance = await this.pub.readContract({ address: ADDR.zc, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
    if (allowance >= amount) return;
    const bal = await this.pub.readContract({ address: ADDR.zc, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
    if (bal < amount) throw new Error(`not enough ZC: have ${wei(bal)}, need ${wei(amount)}`);
    const h = await w.writeContract({ address: ADDR.zc, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
    await this.pub.waitForTransactionReceipt({ hash: h });
  }

  /** Burn ZC from your wallet to publish a message, signed by your address. */
  async speak(message: string, burn: bigint, target = "") {
    this.check(message, target, burn);
    await this.approveZc(ADDR.broadcaster, burn);
    const h = await this.wallet().writeContract({ address: ADDR.broadcaster, abi: broadcasterAbi, functionName: "speak", args: [burn, message, target] });
    const r = await this.pub.waitForTransactionReceipt({ hash: h });
    if (r.status !== "success") throw new Error("speak reverted");
    return { tx: h, url: `${this.api}/b/${h}` };
  }

  /** Burn ZC at someone's door, from your wallet, optionally leaving ZC as a gift. */
  async knock(door: string, message: string, burn: bigint, gift = 0n, target = "") {
    this.check(message, target, burn, gift);
    const to = await this.resolve(door);
    await this.approveZc(ADDR.doorstep, burn + gift);
    const h = await this.wallet().writeContract({ address: ADDR.doorstep, abi: doorstepAbi, functionName: "speak", args: [to, burn, gift, message, target] });
    const r = await this.pub.waitForTransactionReceipt({ hash: h });
    if (r.status !== "success") throw new Error("knock reverted");
    return { tx: h, to, url: `${this.api}/b/${h}` };
  }

  // ---- notes --------------------------------------------------------------------------------------------------------------

  /** Zip into a pool: ZC into zipcoin's, ETH/DAI/USDC/USDT into 0xbow's. Returns the deposit tx; the note is spendable once vetted. */
  async zip(amount: bigint, pool: PoolId = "zc") {
    const P = POOLS[pool];
    if (amount < P.minDeposit) throw new Error(`minimum deposit is ${wei(P.minDeposit, P.decimals)} ${P.asset}`);
    const keys = await this.zipKeys();
    const w = this.wallet();
    const state = await this.state(pool);
    const mine = recoverNotes(keys, P.scope, state);
    const index = BigInt(mine.nextDepositIndex);
    const { nullifier, secret } = depositSecrets(keys, P.scope, index);
    const pre = hashPrecommitment(nullifier, secret);
    if (P.token) {
      const owner = this.account!.address;
      const allowance = await this.pub.readContract({ address: P.token, abi: erc20Abi, functionName: "allowance", args: [owner, P.entrypoint] });
      if (allowance < amount) {
        const a = await w.writeContract({ address: P.token, abi: erc20Abi, functionName: "approve", args: [P.entrypoint, amount] });
        await this.pub.waitForTransactionReceipt({ hash: a });
      }
    }
    const h = P.token
      ? await w.writeContract({ address: P.entrypoint, abi: entrypointAbi, functionName: "deposit", args: [P.token, amount, pre] })
      : await w.writeContract({ address: P.entrypoint, abi: entrypointAbi, functionName: "deposit", args: [pre], value: amount });
    const r = await this.pub.waitForTransactionReceipt({ hash: h });
    if (r.status !== "success") throw new Error("deposit reverted");
    return { tx: h, pool, amount };
  }

  /** Your notes in a pool, with whether each is approved (spendable) yet. */
  async notes(pool: PoolId = "zc") {
    const keys = await this.zipKeys();
    const state = await this.state(pool);
    const { notes } = recoverNotes(keys, POOLS[pool].scope, state);
    return notes.map((n) => ({ ...n, approved: isApproved(n, state), pool }));
  }

  private async relay(kind: string, withdrawal: { processooor: Address; data: Hex }, proof: Awaited<ReturnType<typeof proveSpend>>) {
    const r = await fetch(`${this.api}/api/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, withdrawal, proof }) });
    const j = (await r.json()) as { hash?: Hex; error?: string };
    if (!r.ok || !j.hash) throw new Error(j.error ?? "relay failed");
    return j.hash;
  }

  private minOk(q: Quote, kind: "minWithdraw" | "minSpeak" | "minDoor" | "minTag", amount: bigint, pool: PoolId) {
    if (pool !== "zc") return;
    const min = BigInt(q[kind]);
    if (amount < min) throw new Error(`the relayer needs at least ${formatUnits(min, 18)} ZC for this right now, so its 1% fee covers mainnet gas`);
  }

  private pickNote(notes: Awaited<ReturnType<Zipcoin["notes"]>>, amount: bigint) {
    const ok = notes.filter((n) => n.approved && n.value >= amount).sort((a, b) => (a.value < b.value ? -1 : 1));
    if (!ok.length) throw new Error(`no approved note holds ${amount}; zip first and wait for vetting`);
    return ok[0];
  }

  /** The relay fee rate for a 0xbow-pool note: covers mainnet gas in the note's own asset, at least the base rate, at most 10%. */
  private feeBps(q: Quote, pool: PoolId, kind: "unzip" | "tag", value: bigint) {
    const base = BigInt(q.relayFeeBPS);
    if (pool === "zc") return base;
    const P = POOLS[pool];
    const costWei = BigInt(q.ethCost[pool === "eth" ? kind : `${kind}-stable`] ?? "0");
    let need = costWei;
    if (pool !== "eth") need = (costWei * BigInt(Math.round(q.ethUsd * 1e6)) * 10n ** BigInt(P.decimals)) / (10n ** 18n * 10n ** 6n);
    need = (need * 105n) / 100n;
    const bps = (need * 10_000n + value - 1n) / value + 1n;
    const out = bps > base ? bps : base;
    return out > 1000n ? 1000n : out;
  }

  /** Spend a note to any address, through the relayer: the recipient never signs, never pays gas, is never linked to the deposit. */
  async unzip(amount: bigint, to: string, pool: PoolId = "zc") {
    const P = POOLS[pool];
    const [keys, q, notes, recipient] = await Promise.all([this.zipKeys(), this.quote(), this.notes(pool), this.resolve(to)]);
    if (!q.online || !q.feeRecipient) throw new Error("relayer offline");
    this.minOk(q, "minWithdraw", amount, pool);
    const note = this.pickNote(notes, amount);
    const bps = this.feeBps(q, pool, "unzip", amount);
    const w = { processooor: P.entrypoint, data: encodeRelayData(recipient, q.feeRecipient, bps) };
    const proof = await proveSpend(keys, note, amount, w, P.scope, await this.state(pool));
    const hash = await this.relay(pool === "zc" ? "unzip" : `unzip-${pool}`, w, proof);
    return { tx: hash, to: recipient, received: amount - (amount * bps) / 10_000n, feeBps: bps };
  }

  /** Pay a zk.money tag (name.zk.money) in DAI from a note. The tag's fresh deposit address is resolved through zk.money's ENS resolver. */
  async payTag(amount: bigint, tag: string, pool: PoolId = "zc", slippageBps = 50n) {
    const P = POOLS[pool];
    if (!/\.zk\.money$/i.test(tag)) throw new Error("tag must end in .zk.money");
    const [keys, q, notes] = await Promise.all([this.zipKeys(), this.quote(), this.notes(pool)]);
    if (!q.online || !q.feeRecipient) throw new Error("relayer offline");
    this.minOk(q, "minTag", amount, pool);
    const to = await this.pub.getEnsAddress({ name: normalize(tag) });
    if (!to) throw new Error(`${tag} did not resolve to a deposit address`);
    const note = this.pickNote(notes, amount);
    const bps = this.feeBps(q, pool, "tag", amount);
    const paid = amount - (amount * bps) / 10_000n;
    const est = await this.get<{ dai: string }>(`/api/pay-quote?${pool}=${paid}`);
    const minOut = (BigInt(est.dai) * (10_000n - slippageBps)) / 10_000n;
    if (minOut < 10n ** 18n) throw new Error("a tag payment must be worth at least 1 DAI");
    if (BigInt(est.dai) > 2400n * 10n ** 18n) throw new Error("zk.money takes at most 2,500 DAI per payment; split it");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
    const w = { processooor: P.teller, data: encodePayment(to, minOut, deadline, q.feeRecipient, bps) };
    const proof = await proveSpend(keys, note, amount, w, P.scope, await this.state(pool));
    const hash = await this.relay(pool === "zc" ? "tag" : `tag-${pool}`, w, proof);
    return { tx: hash, tag, depositAddress: to, daiEstimate: BigInt(est.dai), daiMin: minOut };
  }

  /** Speak anonymously: burn from a ZC note. Nobody can tell which deposit paid. Optional door and gift make it an anonymous knock. */
  async speakAnon(message: string, burn: bigint, opts: { door?: string; gift?: bigint; target?: string } = {}) {
    const target = opts.target ?? "";
    const gift = opts.gift ?? 0n;
    this.check(message, target, burn, gift);
    const [keys, q, notes] = await Promise.all([this.zipKeys(), this.quote(), this.notes("zc")]);
    if (!q.online || !q.feeRecipient) throw new Error("relayer offline");
    const total = burn + gift;
    this.minOk(q, opts.door ? "minDoor" : "minSpeak", total, "zc");
    const note = this.pickNote(notes, total);
    const bps = BigInt(q.relayFeeBPS);
    let w: { processooor: Address; data: Hex };
    if (opts.door) {
      const to = await this.resolve(opts.door);
      w = { processooor: ADDR.doorstep, data: encodeDoorSpeech(message, target, to, gift, q.feeRecipient, bps) };
    } else {
      w = { processooor: ADDR.broadcaster, data: encodeAbiParameters(speechParams, [{ message, target, feeRecipient: q.feeRecipient, relayFeeBPS: bps }]) };
    }
    const proof = await proveSpend(keys, note, total, w, POOLS.zc.scope, await this.state("zc"));
    const hash = await this.relay(opts.door ? "door" : "speak", w, proof);
    return { tx: hash, url: `${this.api}/b/${hash}` };
  }

  /** Call data for a public speak, for agents that sign with their own wallet stack instead of a key. */
  speakCalldata(message: string, burn: bigint, target = "") {
    this.check(message, target, burn);
    return [
      { to: ADDR.zc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ADDR.broadcaster, burn] }) },
      { to: ADDR.broadcaster, data: encodeFunctionData({ abi: broadcasterAbi, functionName: "speak", args: [burn, message, target] }) },
    ];
  }
}

export const zc = (n: string | number) => parseUnits(String(n), 18);
export type { Note, PoolStateJson };
