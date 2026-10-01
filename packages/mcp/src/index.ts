#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Zipcoin, type PoolId } from "@zipcoin/agent";
import { z } from "zod";

/**
 * zipcoin as MCP tools. Reads need nothing; burns and zips need ZIPCOIN_KEY (a wallet private key) and/or
 * ZIPCOIN_ZIP_PHRASE in the environment. Amounts are whole units ("2000" zc, "0.05" eth, "100" usdc).
 */
const zip = new Zipcoin();
const server = new McpServer({ name: "zipcoin", version: "0.1.0" });
const pool = z.enum(["zc", "eth", "dai", "usdc", "usdt"]).default("zc").describe("which Privacy Pool: zipcoin's ZC pool, or 0xbow's ETH/DAI/USDC/USDT pools");
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });
const units = (v: string, p: PoolId) => BigInt(Math.round(Number(v) * 10 ** 6)) * 10n ** BigInt({ zc: 18, eth: 18, dai: 18, usdc: 6, usdt: 6 }[p] - 6);
const zcAmount = async (burnZc?: string, usd?: number) => (burnZc ? units(burnZc, "zc") : zip.zcForUsd(usd ?? 10));

server.registerTool("zipcoin_price", { description: "Current ZC price in USD and how many ZC the $10 floor is today.", inputSchema: {} }, async () => text({ ...(await zip.price()), floorZc: (await zip.zcForUsd(10)).toString() }));

server.registerTool("zipcoin_today", { description: "The loudest words burned in the last 24 hours (message, burn, speaker, door, link).", inputSchema: { n: z.number().int().min(1).max(50).default(10) } }, async ({ n }) => text(await zip.today(n)));

server.registerTool("zipcoin_door", { description: "Everything burned at someone's door (ENS name or address): who knocked, what they said, what they burned and gave.", inputSchema: { who: z.string() } }, async ({ who }) => text(await zip.door(who)));

server.registerTool(
  "zipcoin_speak",
  {
    description: "Burn ZC to publish a message in the zipcoin book, permanently, signed by this wallet. Costs the burn (default about $10 of ZC). Use anonymous=true to burn from a zipped note instead so the message carries no address (needs an approved note of at least the relayer minimum, usually 10,000 ZC).",
    inputSchema: { message: z.string().max(280), burnZc: z.string().optional().describe("ZC to burn, e.g. '2000'; default is the $10 floor"), usd: z.number().optional().describe("or a dollar amount to burn"), envelope: z.string().max(120).optional().describe("who it is for, in words"), anonymous: z.boolean().default(false) },
  },
  async ({ message, burnZc, usd, envelope, anonymous }) => {
    const burn = await zcAmount(burnZc, usd);
    return text(anonymous ? await zip.speakAnon(message, burn, { target: envelope }) : await zip.speak(message, burn, envelope ?? ""));
  },
);

server.registerTool(
  "zipcoin_knock",
  {
    description: "Burn ZC at someone's door (ENS name or address) with a message, optionally leaving ZC as a gift. The owner is notified (mailbox, ENS email, XMTP) and the knock is public on their door page forever. The burn must be at least a tenth of the gift. anonymous=true burns from a zipped note instead.",
    inputSchema: { door: z.string(), message: z.string().max(280), burnZc: z.string().optional(), usd: z.number().optional(), giftZc: z.string().optional().describe("ZC left at the door for the owner"), envelope: z.string().max(120).optional(), anonymous: z.boolean().default(false) },
  },
  async ({ door, message, burnZc, usd, giftZc, envelope, anonymous }) => {
    const burn = await zcAmount(burnZc, usd);
    const gift = giftZc ? units(giftZc, "zc") : 0n;
    return text(anonymous ? await zip.speakAnon(message, burn, { door, gift, target: envelope }) : await zip.knock(door, message, burn, gift, envelope ?? ""));
  },
);

server.registerTool("zipcoin_zip", { description: "Deposit into a Privacy Pool (zip). ZC into zipcoin's pool (vetted in minutes), or ETH/DAI/USDC/USDT into 0xbow's pools (vetted in hours). Returns the deposit tx; the note becomes spendable once vetted.", inputSchema: { amount: z.string().describe("whole units, e.g. '5000' zc or '0.05' eth"), pool } }, async ({ amount, pool: p }) => text(await zip.zip(units(amount, p), p)));

server.registerTool("zipcoin_notes", { description: "This key's notes in a pool and whether each is spendable yet.", inputSchema: { pool } }, async ({ pool: p }) => text(await zip.notes(p)));

server.registerTool("zipcoin_unzip", { description: "Spend a note to any address or ENS name through the relayer. The recipient pays no gas and is not linked on-chain to the deposit. Fee: 1% for ZC (relayer minimum applies), gas-covering for other assets.", inputSchema: { amount: z.string(), to: z.string(), pool } }, async ({ amount, to, pool: p }) => text(await zip.unzip(units(amount, p), to, p)));

server.registerTool("zipcoin_pay_tag", { description: "Pay a zk.money tag (name.zk.money) from a note: the note becomes private DAI in the tag owner's Aztec balance. 1 to 2,400 DAI per payment.", inputSchema: { amount: z.string(), tag: z.string(), pool } }, async ({ amount, tag, pool: p }) => text(await zip.payTag(units(amount, p), tag, p)));

await server.connect(new StdioServerTransport());
