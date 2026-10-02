import { createPublicClient, createWalletClient, encodeFunctionData, formatUnits, getAddress, http, isAddress, parseAbi, parseUnits, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

import { broadcasterAbi, doorstepAbi, entrypointAbi, erc20Abi } from "./abi.js";
import { encodeDoorSpeech, encodePayment, encodeRelayData, speechParams } from "./codec.js";
import { ADDR, API, MAX_MESSAGE_BYTES, MAX_TARGET_BYTES, MIN_BURN, MIN_BURN_OF_GIFT_BPS, POOLS, RPC, STOCKEREUM, TOKENS, UNISWAP, ZKAPI, type Holding, type PoolId } from "./config.js";
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
type Quote_ = { feeRecipient: Address | null; online: boolean; relayFeeBPS: string; minWithdraw: string; minSpeak: string; minDoor: string; minTag: string; ethCost: Record<string, string>; zcCost?: Record<string, string>; ethUsd: number };
export type Speech = { tx: string; block: number; time: number; speaker: string | null; speakerName: string | null; to: string | null; toName: string | null; message: string; target: string; burned: string; gift: string; viaEth?: boolean };
export type Opts = { key?: Hex; zipPhrase?: string; rpc?: string; api?: string };

const bytes = (s: string) => new TextEncoder().encode(s).length;
const routerAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function buyWethPairWithEth(PoolKey key, uint256 minOut, bytes hookData) payable returns (uint256 amountOut)",
]);
const zcFirst = BigInt(ADDR.zc) < BigInt(STOCKEREUM.weth);
const POOL_KEY = { currency0: zcFirst ? ADDR.zc : STOCKEREUM.weth, currency1: zcFirst ? STOCKEREUM.weth : ADDR.zc, fee: 0, tickSpacing: 200, hooks: STOCKEREUM.hook } as const;
const SLIPPAGE_BPS = 300n;
/** The contracts' relay fee caps: Broadcaster, Doorstep and Teller 5%; the Entrypoint's ZC config 3%. */
const ZC_FEE_CAP: Record<"unzip" | "speak" | "door" | "tag" | "change", bigint> = { unzip: 300n, speak: 500n, door: 500n, tag: 500n, change: 500n };
const swapAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);
const quoterAbi = parseAbi(["function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"]);
const wethAbi = parseAbi(["function withdraw(uint256 wad)"]);
/** SwapRouter02 understands this recipient as "keep it in the router for the next call of the multicall". */
const ROUTER_SELF = "0x0000000000000000000000000000000000000002" as Address;
export type Quote = Quote_;
export { ZKAPI };
const wei = (v: bigint, d = 18) => formatUnits(v, d);

export class Zipcoin {
  readonly api: string;
  readonly pub: PublicClient;
  readonly account: ReturnType<typeof privateKeyToAccount> | null;
  readonly rpc: string;
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

  /** ZC the wallet holds. */
  async zcBalance() {
    if (!this.account) return 0n;
    return this.pub.readContract({ address: ADDR.zc, abi: erc20Abi, functionName: "balanceOf", args: [this.account.address] });
  }

  /** How many ZC this much ETH buys right now, by simulating the trade (sales tax and price impact included). */
  async quoteBuy(eth: bigint) {
    // Quoted from a pretend-rich account so a wallet that holds less than the probe can still get a price.
    const from = "0x0000000000000000000000000000000000000001" as Address;
    const { result } = await this.pub.simulateContract({ account: from, address: STOCKEREUM.router, abi: routerAbi, functionName: "buyWethPairWithEth", args: [POOL_KEY, 0n, "0x"], value: eth, stateOverride: [{ address: from, balance: 1000n * 10n ** 18n }] });
    return result;
  }

  /** How much ETH buys at least this many ZC (a little over, for slippage). */
  async ethForZc(zcWanted: bigint) {
    const probe = 10n ** 16n;
    const got = await this.quoteBuy(probe);
    if (got === 0n) throw new Error("no quote");
    // Linear estimate plus 4% headroom; the trade's minOut makes sure the ZC actually arrives.
    return (probe * zcWanted * 104n) / (got * 100n) + 1n;
  }

  /** What the wallet holds, in every asset the CLI knows how to turn into ZC. */
  async holdings() {
    if (!this.account) return {} as Record<Holding, bigint>;
    const me = this.account.address;
    const [eth, zcBal, ...tokens] = await Promise.all([
      this.pub.getBalance({ address: me }),
      this.zcBalance(),
      ...(Object.keys(TOKENS) as (keyof typeof TOKENS)[]).map((k) => this.pub.readContract({ address: TOKENS[k].address, abi: erc20Abi, functionName: "balanceOf", args: [me] })),
    ]);
    const out = { zc: zcBal, eth } as Record<Holding, bigint>;
    (Object.keys(TOKENS) as (keyof typeof TOKENS)[]).forEach((k, i) => (out[k] = tokens[i]));
    return out;
  }

  /** Turn WETH or a stablecoin into ETH in the wallet (Uniswap v3, one transaction). Returns the ETH gained. */
  async toEth(asset: Exclude<Holding, "zc" | "eth">, amount: bigint) {
    const w = this.wallet();
    const me = this.account!.address;
    const T = TOKENS[asset];
    const before = await this.pub.getBalance({ address: me });
    if (asset === "weth") {
      const h = await w.writeContract({ address: T.address, abi: wethAbi, functionName: "withdraw", args: [amount] });
      await this.pub.waitForTransactionReceipt({ hash: h });
    } else {
      const allowance = await this.pub.readContract({ address: T.address, abi: erc20Abi, functionName: "allowance", args: [me, UNISWAP.swapRouter02] });
      if (allowance < amount) {
        const a = await w.writeContract({ address: T.address, abi: erc20Abi, functionName: "approve", args: [UNISWAP.swapRouter02, amount] });
        await this.pub.waitForTransactionReceipt({ hash: a });
      }
      const { result } = await this.pub.simulateContract({ address: UNISWAP.quoterV2, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn: T.address, tokenOut: STOCKEREUM.weth, amountIn: amount, fee: T.wethFee, sqrtPriceLimitX96: 0n }] });
      const min = (result[0] * (10_000n - 100n)) / 10_000n;
      const calls = [
        encodeFunctionData({ abi: swapAbi, functionName: "exactInputSingle", args: [{ tokenIn: T.address, tokenOut: STOCKEREUM.weth, fee: T.wethFee, recipient: ROUTER_SELF, amountIn: amount, amountOutMinimum: min, sqrtPriceLimitX96: 0n }] }),
        encodeFunctionData({ abi: swapAbi, functionName: "unwrapWETH9", args: [min, me] }),
      ];
      const h = await w.writeContract({ address: UNISWAP.swapRouter02, abi: swapAbi, functionName: "multicall", args: [calls] });
      const r = await this.pub.waitForTransactionReceipt({ hash: h });
      if (r.status !== "success") throw new Error(`${asset} → ETH swap reverted`);
    }
    return (await this.pub.getBalance({ address: me })) - before;
  }

  /** Rough ETH value of a holding, for choosing what to spend. */
  private async ethValue(asset: Exclude<Holding, "zc" | "eth">, amount: bigint) {
    if (asset === "weth") return amount;
    const { result } = await this.pub.simulateContract({ address: UNISWAP.quoterV2, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn: TOKENS[asset].address, tokenOut: STOCKEREUM.weth, amountIn: amount, fee: TOKENS[asset].wethFee, sqrtPriceLimitX96: 0n }] }).catch(() => ({ result: [0n] as const }));
    return result[0];
  }

  /**
   * Make sure the wallet holds `zcNeeded` ZC, using whatever it has: ZC, then ETH, then WETH, then USDC/USDT/DAI (sold for ETH,
   * which buys ZC on zipcoin's market). Keeps a little ETH for gas. Returns what it did.
   */
  async fund(zcNeeded: bigint) {
    const h = await this.holdings();
    const steps: string[] = [];
    if (h.zc >= zcNeeded) return steps;
    const short = zcNeeded - h.zc;
    const gasReserve = 3n * 10n ** 15n;
    let ethNeeded = await this.ethForZc(short);
    if (h.eth < ethNeeded + gasReserve) {
      // Sell other holdings for ETH until there is enough, largest first.
      const others = (["weth", "usdc", "usdt", "dai"] as const).filter((k) => h[k] > 0n);
      const valued = await Promise.all(others.map(async (k) => ({ k, v: await this.ethValue(k, h[k]) })));
      valued.sort((a, b) => (a.v < b.v ? 1 : -1));
      for (const { k, v } of valued) {
        if (h.eth >= ethNeeded + gasReserve) break;
        if (v === 0n) continue;
        const missing = ethNeeded + gasReserve - h.eth;
        // Sell what covers the gap (+8% for slippage and price impact), or everything if it does not.
        const portion = (h[k] * (missing * 108n)) / (v * 100n);
        const amount = portion >= h[k] ? h[k] : portion;
        const gained = await this.toEth(k, amount);
        h.eth += gained;
        steps.push(`sold ${wei(amount, TOKENS[k].decimals)} ${k.toUpperCase()} for ${wei(gained)} ETH`);
      }
      ethNeeded = await this.ethForZc(short);
      if (h.eth < ethNeeded + gasReserve) throw new Error(`not enough in the wallet to get ${wei(short)} ZC: needs about ${wei(ethNeeded)} ETH plus gas; it holds ${wei(h.eth)} ETH, ${wei(h.weth)} WETH, ${wei(h.usdc, 6)} USDC, ${wei(h.usdt, 6)} USDT, ${wei(h.dai)} DAI`);
    }
    await this.buy(ethNeeded, short);
    steps.push(`bought ${wei(short)} ZC for ${wei(ethNeeded)} ETH`);
    return steps;
  }

  /** Buy ZC with ETH on zipcoin's own market. Everything here passes through ZC; this is how an agent that holds only ETH gets some. */
  async buy(eth: bigint, minZc?: bigint) {
    const w = this.wallet();
    const quoted = await this.quoteBuy(eth);
    const min = minZc ?? (quoted * (10_000n - SLIPPAGE_BPS)) / 10_000n;
    const h = await w.writeContract({ address: STOCKEREUM.router, abi: routerAbi, functionName: "buyWethPairWithEth", args: [POOL_KEY, min, "0x"], value: eth });
    const r = await this.pub.waitForTransactionReceipt({ hash: h });
    if (r.status !== "success") throw new Error("buy reverted");
    return { tx: h, eth, zcAtLeast: min };
  }

  /** Makes sure the wallet holds `amount` ZC, buying the shortfall with ETH when it can; then approves the spender. */
  private async approveZc(spender: Address, amount: bigint) {
    const w = this.wallet();
    const owner = this.account!.address;
    await this.fund(amount);
    const allowance = await this.pub.readContract({ address: ADDR.zc, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
    if (allowance >= amount) return;
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
    if (pool === "zc") await this.approveZc(P.entrypoint, amount);
    else if (P.token) {
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

  /**
   * Relay fee rate for a ZC note: the base rate (1%), or more when the note is small, so the fee still covers mainnet gas;
   * never above the pools' 10% cap. Returns the rate, or throws when even 10% would not cover the gas.
   */
  private zcFee(q: Quote, kind: "unzip" | "speak" | "door" | "tag" | "change", amount: bigint) {
    const base = BigInt(q.relayFeeBPS);
    const cost = BigInt(q.zcCost?.[kind] ?? "0");
    if (cost === 0n) {
      const min = BigInt(q[kind === "unzip" ? "minWithdraw" : kind === "speak" ? "minSpeak" : kind === "door" ? "minDoor" : "minTag"]);
      if (amount < min) throw new Error(`the relayer needs at least ${formatUnits(min, 18)} ZC for this right now`);
      return base;
    }
    const need = (cost * 110n) / 100n;
    const cap = ZC_FEE_CAP[kind];
    const bps = (need * 10_000n + amount - 1n) / amount + 1n;
    const out = bps > base ? bps : base;
    if (out > cap) throw new Error(`too small to relay: ${formatUnits(amount, 18)} ZC cannot cover about ${formatUnits(cost, 18)} ZC of gas at the ${Number(cap) / 100}% fee cap; use at least ${formatUnits(this.minAnon(q, kind), 18)} ZC`);
    return out;
  }
  /** The smallest ZC amount the relayer takes for a kind right now (the contract's fee cap must still cover the gas). */
  minAnon(q: Quote, kind: "unzip" | "speak" | "door" | "tag" | "change") {
    const cost = BigInt(q.zcCost?.[kind] ?? "0");
    if (cost === 0n) return BigInt(q[kind === "unzip" ? "minWithdraw" : kind === "speak" ? "minSpeak" : kind === "door" ? "minDoor" : "minTag"]);
    const m = (cost * 110n * 10_000n * 102n) / (100n * ZC_FEE_CAP[kind] * 100n);
    return m > MIN_BURN ? m : MIN_BURN;
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
    const note = this.pickNote(notes, amount);
    const bps = pool === "zc" ? this.zcFee(q, "unzip", amount) : this.feeBps(q, pool, "unzip", amount);
    const w = { processooor: P.entrypoint, data: encodeRelayData(recipient, q.feeRecipient, bps) };
    const proof = await proveSpend(keys, note, amount, w, P.scope, await this.state(pool));
    const hash = await this.relay(pool === "zc" ? "unzip" : `unzip-${pool}`, w, proof);
    return { tx: hash, to: recipient, received: amount - (amount * bps) / 10_000n, feeBps: bps };
  }

  /** Deliver a ZC note as ETH to any address (ZipChanger): sold on zipcoin's market, unwrapped, sent. Fund a zkAPI client's address with it. */
  async change(amount: bigint, to: string, slippageBps = 300n) {
    if (ADDR.changer === "0x0000000000000000000000000000000000000000") throw new Error("ZipChanger is not deployed yet (set ZIPCOIN_CHANGER)");
    const [keys, q, notes, recipient] = await Promise.all([this.zipKeys(), this.quote(), this.notes("zc"), this.resolve(to)]);
    if (!q.online || !q.feeRecipient) throw new Error("relayer offline");
    const note = this.pickNote(notes, amount);
    const bps = this.zcFee(q, "change", amount);
    const sold = amount - (amount * bps) / 10_000n;
    const est = await this.get<{ eth: string }>(`/api/pay-quote?zcToEth=${sold}`);
    const minOut = (BigInt(est.eth) * (10_000n - slippageBps)) / 10_000n;
    if (minOut === 0n) throw new Error("no ETH quote for that amount");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
    const w = { processooor: ADDR.changer, data: encodePayment(recipient, minOut, deadline, q.feeRecipient, bps) };
    const proof = await proveSpend(keys, note, amount, w, POOLS.zc.scope, await this.state("zc"));
    const hash = await this.relay("change", w, proof);
    return { tx: hash, to: recipient, ethEstimate: BigInt(est.eth), ethMin: minOut, feeBps: bps };
  }

  /**
   * Fund a zkAPI client (private AI credits) from a note, without linking the client's address to you. The client (zkapi-clientd
   * or OA Chat) deposits into the vault itself with its own secret; this only delivers ETH to its funding address.
   * `to` defaults to the local zkapi-clientd's funding address, read from its loopback API when its config is available.
   * Experimental: zkAPI notes expire after 30 days, the vault owner can pause it, and the vault deposit itself costs ~6.7M gas.
   */
  async aiFund(amountEth: bigint, opts: { to?: string; pool?: "eth" | "zc"; onProgress?: (s: string) => void } = {}) {
    const say = opts.onProgress ?? (() => {});
    const to = opts.to ?? (await this.zkapiFundingAddress());
    if (!to) throw new Error("no zkAPI funding address: pass --to <address> (zkapi-clientd shows it under `zkapi-clientd config`)");
    const pool = opts.pool ?? "eth";
    if (pool === "eth") {
      say(`unzipping ${wei(amountEth)} ETH from 0xbow's pool to the client's funding address ${to}`);
      const r = await this.unzip(amountEth, to, "eth");
      return { ...r, kind: "unzip-eth" as const, funding: to };
    }
    // ZC note: how much ZC sells for that much ETH (plus the relay fee), then change it.
    const q = await this.quote();
    const probe = 10n ** 21n;
    const est = await this.get<{ eth: string }>(`/api/pay-quote?zcToEth=${probe}`);
    if (BigInt(est.eth) === 0n) throw new Error("no quote");
    let zc = (probe * amountEth * 104n) / (BigInt(est.eth) * 100n);
    // Never below what the relayer can carry at the fee cap; the client simply gets a little more ETH.
    const floor = this.minAnon(q, "change");
    if (zc < floor) zc = floor;
    const bps = this.zcFee(q, "change", zc);
    zc = (zc * 10_000n) / (10_000n - bps) + 1n;
    say(`changing about ${wei(zc)} ZC into ETH for the client's funding address ${to}`);
    const r = await this.change(zc, to);
    return { ...r, kind: "change" as const, funding: to };
  }

  /** The local zkapi-clientd's funding address, if the daemon is running here and its config is readable. Loopback only. */
  async zkapiFundingAddress(): Promise<string | null> {
    try {
      const [fs, path, os] = await Promise.all([import("node:fs"), import("node:path"), import("node:os")]);
      const dir = process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : process.platform === "win32" ? (process.env.APPDATA ?? "") : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"));
      const cfg = JSON.parse(fs.readFileSync(path.join(dir, "zkapi-clientd", "config.json"), "utf8")) as { listen?: string; api_key?: string; management_token?: string };
      const listen = cfg.listen ?? ZKAPI.clientListen;
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(listen)) return null;
      const r = await fetch(`http://${listen}/n/address`, { headers: { authorization: `Bearer ${cfg.api_key ?? ""}`, "X-OA-Management-Token": cfg.management_token ?? "" }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const j = (await r.json()) as { address?: string; chain_id?: number };
      return j.address && isAddress(j.address) && (j.chain_id ?? 1) === 1 ? j.address : null;
    } catch {
      return null;
    }
  }

  /** Pay a zk.money tag (name.zk.money) in DAI from a note. The tag's fresh deposit address is resolved through zk.money's ENS resolver. */
  async payTag(amount: bigint, tag: string, pool: PoolId = "zc", slippageBps = 50n) {
    const P = POOLS[pool];
    if (!/\.zk\.money$/i.test(tag)) throw new Error("tag must end in .zk.money");
    const [keys, q, notes] = await Promise.all([this.zipKeys(), this.quote(), this.notes(pool)]);
    if (!q.online || !q.feeRecipient) throw new Error("relayer offline");
    const to = await this.pub.getEnsAddress({ name: normalize(tag) });
    if (!to) throw new Error(`${tag} did not resolve to a deposit address`);
    const note = this.pickNote(notes, amount);
    const bps = pool === "zc" ? this.zcFee(q, "tag", amount) : this.feeBps(q, pool, "tag", amount);
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

  /** Waits until this key has an approved ZC note of at least `amount`, polling the pool index. */
  async waitForNote(amount: bigint, maxMs = 15 * 60_000, onTick?: (s: string) => void) {
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
      const notes = await this.notes("zc").catch(() => []);
      const ok = notes.find((n) => n.approved && n.value >= amount);
      if (ok) return ok;
      onTick?.(notes.some((n) => !n.approved && n.value >= amount) ? "note zipped, waiting for the postman to approve it" : "waiting for the deposit to be indexed");
      await new Promise((r) => setTimeout(r, 10_000));
    }
    throw new Error("the note was not approved in time; run the command again later, the note is yours");
  }

  /**
   * Speak anonymously: burn from a ZC note. Nobody can tell which deposit paid. Optional door and gift make it an anonymous knock.
   * With no approved note, `auto` (default) buys the ZC with whatever the wallet holds, zips it, waits for the postman (minutes), then burns.
   */
  async speakAnon(message: string, burn: bigint, opts: { door?: string; gift?: bigint; target?: string; auto?: boolean; onProgress?: (s: string) => void } = {}) {
    const target = opts.target ?? "";
    const gift = opts.gift ?? 0n;
    const say = opts.onProgress ?? (() => {});
    this.check(message, target, burn, gift);
    const [keys, q] = await Promise.all([this.zipKeys(), this.quote()]);
    if (!q.online || !q.feeRecipient) throw new Error("relayer offline");
    const kind = opts.door ? "door" : "speak";
    const total = burn + gift;
    const bps = this.zcFee(q, kind, total);
    let notes = await this.notes("zc");
    let note = notes.find((n) => n.approved && n.value >= total);
    if (!note) {
      if (opts.auto === false) throw new Error("no approved note holds that amount; zip first and wait for vetting, or allow auto");
      if (!this.account) throw new Error("no approved note, and no wallet key to buy and zip with");
      // The note must also carry the relay fee and the pool's vetting fee.
      const deposit = (total * 10_000n) / (10_000n - bps) + 1n;
      const gross = (deposit * 10_000n) / (10_000n - 50n) + 1n;
      const steps = await this.fund(gross);
      for (const st of steps) say(st);
      const z = await this.zip(gross, "zc");
      say(`zipped ${wei(gross)} ZC (${z.tx}); nobody can link what follows to this deposit except by timing`);
      note = await this.waitForNote(total, 15 * 60_000, say);
      notes = await this.notes("zc");
    }
    note = this.pickNote(notes, total);
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
