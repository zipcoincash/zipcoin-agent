#!/usr/bin/env node
import { formatUnits, parseUnits } from "viem";

import { Zipcoin } from "./client.js";
import { POOLS, type PoolId } from "./config.js";
import { generateZipPhrase } from "./phrase.js";

/**
 * zipcoin — the book, from a terminal or an agent.
 *
 *   zipcoin speak "message" --burn 2000 [--usd 10] [--envelope "to: …"] [--anon]
 *   zipcoin knock nick.eth "message" --burn 2000 [--gift 500] [--anon]
 *   zipcoin buy 0.01                       buy ZC with ETH (speak/knock/zip also buy any shortfall by themselves)
 *   zipcoin zip 0.05 --pool eth            zip ZC (default), eth, dai, usdc or usdt
 *   zipcoin notes [--pool eth]
 *   zipcoin unzip 1500 --to 0x… [--pool eth]
 *   zipcoin pay 100 --tag alice.zk.money [--pool usdc]
 *   zipcoin door nick.eth | today | feed [--json]
 *   zipcoin price | quote | key
 *
 * env: ZIPCOIN_KEY (wallet private key), ZIPCOIN_ZIP_PHRASE (12 words), ZIPCOIN_RPC, ZIPCOIN_API
 */
const argv = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v !== undefined && !v.startsWith("--")) {
      flags[k] = v;
      i++;
    } else flags[k] = true;
  } else pos.push(a);
}
const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
const json = !!flags.json;
const out = (v: unknown) => console.log(json ? JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2) : v);
const die = (m: string): never => {
  console.error(m);
  process.exit(1);
};
const pool = (str("pool") ?? "zc") as PoolId;
if (!(pool in POOLS)) die(`unknown pool ${pool}`);
const P = POOLS[pool];
const amt = (v: string | undefined, decimals = 18) => (v === undefined ? die("amount required") : parseUnits(v, decimals));
const fmt = (v: bigint, d = 18) => formatUnits(v, d);

const z = new Zipcoin();
const [cmd, ...rest] = pos;

const burnAmount = async () => {
  if (str("usd")) return z.zcForUsd(Number(str("usd")));
  if (str("burn")) return parseUnits(str("burn")!, 18);
  // default: the site's floor, about $10
  return z.zcForUsd(10);
};

const printSpeech = (s: { burned: string; message: string; speaker: string | null; speakerName: string | null; to: string | null; toName: string | null; time: number; tx: string }) =>
  `${Math.round(Number(BigInt(s.burned) / 10n ** 14n) / 1e4).toLocaleString("en-US").padStart(12)} zc  ${new Date(s.time * 1000).toISOString().slice(0, 16)}  ${s.speaker ? (s.speakerName ?? s.speaker.slice(0, 10)) : "anonymous"}${s.to ? ` → ${s.toName ?? s.to.slice(0, 10)}` : ""}\n${" ".repeat(16)}“${s.message}”\n${" ".repeat(16)}https://www.zipcoin.cash/b/${s.tx}`;

try {
  switch (cmd) {
    case "speak": {
      const message = rest.join(" ");
      const burn = await burnAmount();
      const r = flags.anon ? await z.speakAnon(message, burn, { target: str("envelope"), onProgress: (m) => console.error(`… ${m}`) }) : await z.speak(message, burn, str("envelope") ?? "");
      out(json ? r : `spoken${flags.anon ? " anonymously" : ""}: ${fmt(burn)} zc burned\n${r.url}`);
      break;
    }
    case "knock": {
      const [door, ...words] = rest;
      if (!door) die("door required (ENS name or address)");
      const message = words.join(" ");
      const burn = await burnAmount();
      const gift = str("gift") ? parseUnits(str("gift")!, 18) : 0n;
      const r = flags.anon ? await z.speakAnon(message, burn, { door, gift, target: str("envelope"), onProgress: (m) => console.error(`… ${m}`) }) : await z.knock(door, message, burn, gift, str("envelope") ?? "");
      out(json ? r : `knocked${flags.anon ? " anonymously" : ""} at ${door}: ${fmt(burn)} zc burned${gift ? `, ${fmt(gift)} zc gift` : ""}\n${r.url}`);
      break;
    }
    case "buy": {
      const eth = amt(rest[0], 18);
      const r = await z.buy(eth);
      out(json ? r : `bought at least ${fmt(r.zcAtLeast)} ZC for ${fmt(eth)} ETH\n${r.tx}`);
      break;
    }
    case "balance": {
      const h = await z.holdings();
      out(json ? { address: z.address, ...h } : `${z.address}\n${fmt(h.zc)} ZC · ${fmt(h.eth)} ETH · ${fmt(h.weth)} WETH · ${fmt(h.usdc, 6)} USDC · ${fmt(h.usdt, 6)} USDT · ${fmt(h.dai)} DAI\n(speak, knock and zip spend whatever is here, in that order)`);
      break;
    }
    case "zip": {
      const r = await z.zip(amt(rest[0], P.decimals), pool);
      out(json ? r : `zipped ${fmt(r.amount, P.decimals)} ${P.asset}: ${r.tx}\nthe note is spendable once vetted (${pool === "zc" ? "minutes" : "hours, by 0xbow"}); check with: zipcoin notes --pool ${pool}`);
      break;
    }
    case "notes": {
      const notes = await z.notes(pool);
      out(json ? notes : notes.length ? notes.map((n) => `${fmt(n.value, P.decimals).padStart(14)} ${P.asset}  ${n.approved ? "spendable" : "vetting"}  deposit ${n.depositTx.slice(0, 12)}…`).join("\n") : `no ${P.asset} notes for this key`);
      break;
    }
    case "unzip": {
      const to = str("to") ?? die("--to address or ENS required");
      const r = await z.unzip(amt(rest[0], P.decimals), to, pool);
      out(json ? r : `unzipped to ${r.to}: ${fmt(r.received, P.decimals)} ${P.asset} after a ${Number(r.feeBps) / 100}% relay fee\n${r.tx}`);
      break;
    }
    case "pay": {
      const tag = str("tag") ?? die("--tag name.zk.money required");
      const r = await z.payTag(amt(rest[0], P.decimals), tag, pool);
      out(json ? r : `paid ${tag}: about ${fmt(r.daiEstimate)} DAI (at least ${fmt(r.daiMin)})\n${r.tx}`);
      break;
    }
    case "ai": {
      const sub = rest[0];
      const log = (m: string) => console.error(`… ${m}`);
      if (sub === "fund") {
        // zipcoin ai fund <eth> [--to 0x…] [--pool eth|zc]: ETH from a zipped note to a zkAPI funding address (yours or a client's)
        const amount = amt(rest[1], 18);
        console.error("… experimental: works with zkAPI (private AI credits). Notes there expire after 30 days, the vault owner can pause it, and the vault deposit costs ~6.7M gas. Keep amounts small.");
        const r = await z.aiFund(amount, { to: str("to") ?? z.address ?? undefined, pool: (str("pool") as "eth" | "zc" | undefined) ?? "eth", onProgress: log });
        out(json ? r : `funded ${r.funding} with about ${fmt("ethEstimate" in r ? r.ethEstimate : r.received)} ETH\n${r.tx}\nnext: zipcoin ai deposit <eth> (from this wallet) and zipcoin ai chat "…"`);
        break;
      }
      // The zkAPI wallet itself, run under Node: one private note per state directory (ZIPCOIN_AI_STATE, default ~/.config/zipcoin/zkapi)
      const { openZkapi, zkDeposit, zkChat, zkClose, stateSummary, backupFile, DEFAULT_STATE_DIR } = await import("./zkapi/wallet.js");
      const account = z.account ?? die("a wallet key is needed (ZIPCOIN_KEY): it signs the vault deposit and pays its gas");
      const stateDir = process.env.ZIPCOIN_AI_STATE ?? DEFAULT_STATE_DIR;
      const ai = await openZkapi(account, z.rpc, stateDir, log);
      const price = await ai.client.refreshEthUsdPrice().catch(() => null);
      switch (sub) {
        case "deposit": {
          // zipcoin ai deposit <eth>: this wallet deposits into zkAPI's vault (~6.7M gas) and holds the note here
          const eth = rest[1] ?? die("usage: zipcoin ai deposit <eth>");
          const s0 = stateSummary(ai.snapshot(), price);
          if (s0.note) die(`this state directory already holds note #${s0.note.id} (${s0.note.eth.toFixed(6)} ETH). One note at a time: spend it or close it first.`);
          if (s0.pendingDeposit) {
            log(`an earlier deposit is unfinished (${s0.pendingDeposit.phase}); recovering`);
            const r = await ai.client.recoverBrowserDeposit(log);
            if (r?.status !== "confirmed" && r?.status !== "slot_consumed" && r?.status !== "prepared") die(`deposit recovery: ${r?.status ?? "unknown"}; try again in a few minutes`);
          }
          const tx = await zkDeposit(ai, eth, account.address, log);
          const s1 = stateSummary(ai.snapshot(), price);
          out(json ? { tx, ...s1 } : `deposited ${eth} ETH into zkAPI's vault${tx ? `\n${tx}` : ""}\nnote #${s1.note?.id ?? "?"}: ${s1.note ? `${s1.note.eth.toFixed(6)} ETH${s1.note.usd ? ` (≈ $${s1.note.usd.toFixed(2)})` : ""}, expires ${s1.note.expires.slice(0, 10)}` : "pending"}\nstate: ${stateDir} (back it up: it is the money)`);
          break;
        }
        case "chat": {
          // zipcoin ai chat "<prompt>" [--model openai/gpt-4o-mini] [--system "…"]: proves the note, gets a 5-minute key, streams the answer
          const prompt = rest.slice(1).join(" ") || die('usage: zipcoin ai chat "<prompt>" [--model id] [--system "…"]');
          const model = str("model") ?? "openai/gpt-4o-mini";
          if (!stateSummary(ai.snapshot(), price).note) die("no zkAPI note here yet: zipcoin ai deposit <eth> first");
          const messages = [...(str("system") ? [{ role: "system", content: str("system")! }] : []), { role: "user", content: prompt }];
          let text = "";
          const r = await zkChat(ai, messages, model, (d) => { if (!json) process.stdout.write(d); text += d; }, log);
          if (!json) process.stdout.write("\n");
          const s1 = stateSummary(ai.snapshot(), price);
          if (json) out({ model, text: r.text, usage: r.usage, note: s1.note });
          else console.error(`… ${r.usage ? `${r.usage.prompt_tokens + r.usage.completion_tokens} tokens${r.usage.cost ? `, $${r.usage.cost.toFixed(5)}` : ""}` : "done"}; the key settles when it expires (≤5 min); balance updates on the next command`);
          break;
        }
        case "balance": {
          const s1 = stateSummary(ai.snapshot(), price);
          out(json ? s1 : s1.note ? `note #${s1.note.id}: ${s1.note.eth.toFixed(6)} ETH${s1.note.usd ? ` (≈ $${s1.note.usd.toFixed(2)})` : ""}, expires ${s1.note.expires.slice(0, 10)}${s1.activeLease ? `\nkey live until ${new Date(s1.activeLease.expires_at * 1000).toISOString()}` : ""}${s1.pendingRequest ? "\na request is pending with zkAPI's server" : ""}` : `no zkAPI note in ${stateDir}${s1.pendingDeposit ? ` (a deposit is ${s1.pendingDeposit.phase}; run ai deposit again to recover)` : ""}`);
          break;
        }
        case "close": {
          // zipcoin ai close --to 0x… [--escape]: cooperative close (now) or unilateral escape (24h) of the whole note
          const to = str("to") ?? die("usage: zipcoin ai close --to <address> [--escape]");
          await zkClose(ai, to, flags.escape ? "escape" : "mutual", log);
          out(json ? stateSummary(ai.snapshot(), price) : flags.escape ? `escape started to ${to}; finalize after the 24h challenge window with: zipcoin ai close --to ${to} --escape` : `closed; the balance went to ${to}`);
          break;
        }
        case "export": {
          const f = backupFile(stateDir);
          out(json ? { stateDir, file: f } : f ? `the note lives in ${f} (plus localStorage.json). Copy the directory to back it up; whoever has it can spend the note.` : "nothing to export yet");
          break;
        }
        default:
          die('usage: zipcoin ai fund <eth> | deposit <eth> | chat "<prompt>" [--model id] | balance | close --to <addr> [--escape] | export');
      }
      break;
    }
    case "door": {
      const who = rest[0] ?? die("door required");
      const rows = await z.door(who);
      out(json ? rows : rows.length ? rows.map(printSpeech).join("\n\n") : `nothing has been burned at ${who}'s door yet`);
      break;
    }
    case "today": {
      const rows = await z.today(Number(str("n") ?? 10));
      out(json ? rows : rows.map(printSpeech).join("\n\n"));
      break;
    }
    case "feed": {
      const rows = (await z.feed()).slice(0, Number(str("n") ?? 20));
      out(json ? rows : rows.map(printSpeech).join("\n\n"));
      break;
    }
    case "price": {
      const p = await z.price();
      const floor = await z.zcForUsd(10);
      out(json ? { ...p, floorZc: floor } : `1 zc = $${p.usdPerZc.toFixed(6)} · the $10 floor is ${fmt(floor)} zc today`);
      break;
    }
    case "quote": {
      out(await z.quote());
      break;
    }
    case "key": {
      const phrase = generateZipPhrase();
      out(json ? { zipPhrase: phrase } : `ZIPCOIN_ZIP_PHRASE="${phrase}"\n\nKeep it like a private key: it is the only way to spend your notes.`);
      break;
    }
    case "whoami": {
      out({ address: z.address, api: z.api });
      break;
    }
    default:
      console.log(`zipcoin — burn to speak, knock at doors, zip and unzip privately.

  speak "message" [--burn ZC | --usd 10] [--envelope "…"] [--anon]
  knock <door> "message" [--burn ZC | --usd 10] [--gift ZC] [--anon]
      pays with whatever the wallet holds: ZC, else ETH, else WETH / USDC / USDT / DAI (sold for ETH, then ZC)
      --anon burns from a zipped note; with no note it buys, zips, waits for vetting (minutes) and burns, in one go
  buy <eth>
  balance
  zip <amount> [--pool zc|eth|dai|usdc|usdt]
  notes [--pool …]
  unzip <amount> --to <address|ens> [--pool …]
  pay <amount> --tag <name>.zk.money [--pool …]
  ai deposit <eth> · ai chat "<prompt>" [--model id] · ai balance · ai close --to <addr> [--escape] · ai export
      private AI (works with zkAPI, experimental): this wallet deposits into zkAPI's vault, then every chat proves the note and gets
      a 5-minute key; prompts go straight to the model provider. ai fund <eth> [--to …] first sends ETH from a zipped note.
  door <ens|address> · today · feed · price · quote · key · whoami     (--json for machines)

env: ZIPCOIN_KEY, ZIPCOIN_ZIP_PHRASE, ZIPCOIN_RPC, ZIPCOIN_API
docs: https://www.zipcoin.cash/agents`);
  }
  // snarkjs leaves worker threads alive after proving; end explicitly.
  process.exit(0);
} catch (e) {
  die(e instanceof Error ? e.message : String(e));
}
