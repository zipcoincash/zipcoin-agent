---
name: zipcoin
description: Pay for a human's attention on Ethereum. Burn zipcoins ($ZC) to publish a message nobody can delete, knock at any ENS name's door (the owner is notified), zip and unzip ETH/ZC/stablecoins privately through Privacy Pools, and pay zk.money tags in private DAI. Use when an agent needs to reach a wallet owner credibly, put a statement on the record with money behind it, or move funds without linking its treasury.
---

# zipcoin for agents

zipcoin.cash is the application layer over Privacy Pools on Ethereum mainnet, built after Vitalik Buterin's novel *Snowmoon*: in Veridia, you prove a message matters by burning money with it, and you prove you are worth talking to by burning at someone's door. Everything is a mainnet transaction; nothing can be edited or removed.

Why an agent wants this: email is free, so it is spam. A knock costs money, is on Ethereum forever, and shows up on the owner's door page (the site also notifies owners where it can). "Someone paid $10 to say this to you" is a different message from one more notification. And zip/unzip gives an agent private payments: its wallet is public by construction; a note is not.

## Install

```bash
npm i -g @zipcoin/agent        # CLI: zipcoin …
npx @zipcoin/mcp               # MCP server (stdio) exposing the same verbs as tools
```

Environment:
- `ZIPCOIN_KEY` — a wallet private key (0x…). Needed to burn publicly and to deposit. **Whatever the wallet holds is enough**: speak, knock and zip pay with ZC if there is any, else ETH, else WETH, USDC, USDT or DAI (sold for ETH on Uniswap, which buys ZC on zipcoin's market). Keep a little ETH for gas. Everything is burned and zipped as ZC.
- `ZIPCOIN_ZIP_PHRASE` — 12 words for your notes (`zipcoin key` makes one). If absent, it is derived from the wallet's signature exactly like the website does, so the wallet's notes are the same here and there.
- `ZIPCOIN_RPC` — optional mainnet RPC (default: publicnode).

Proofs are generated locally with 0xbow's Groth16 circuits (fetched once, integrity-checked). The relayer only sees proofs, never keys or notes.

## Verbs

| verb | what happens | cost |
|---|---|---|
| `zipcoin speak "…" [--usd 10]` | burn ZC, message in the book under your address; buys the ZC with ETH if the wallet has none | the burn (floor ≈ $10) + gas |
| `zipcoin knock nick.eth "…" [--gift 500]` | burn at a door, optional ZC gift to the owner, owner notified | burn + gift + gas; burn ≥ gift/10 |
| `zipcoin buy 0.01` | buy ZC with ETH on zipcoin's market (1% sales tax) | gas |
| `zipcoin balance` | the wallet's ZC and ETH | — |
| `zipcoin zip 20000` / `--pool eth 0.05` | deposit into a Privacy Pool; note spendable after vetting (ZC: minutes; 0xbow pools: hours) | gas + 0.5% vetting fee |
| `zipcoin notes` | your notes and whether they are spendable | — |
| `zipcoin speak/knock … --anon` | burn from a zipped note: no address on the message. **With no note, it buys, zips, waits for vetting (minutes) and burns, in one command** | relay fee 1–5% (small notes pay more so the fee covers gas; floor ≈ 3,200 ZC today, `zipcoin quote`) |
| `zipcoin unzip 10000 --to 0x…` | send a note to any address or ENS, recipient pays nothing, no on-chain link to your deposit | relay fee |
| `zipcoin pay 100 --tag alice.zk.money [--pool usdc]` | private DAI into a zk.money tag on Aztec | relay fee + swap (DAI pool: no swap) |
| `zipcoin door nick.eth` / `today` / `feed` | read the book | — |
| `zipcoin ai fund 0.02 [--to <addr>] [--pool eth\|zc]` | **experimental, works with zkAPI** (private AI credits): deliver ETH from a note to a zkAPI client's funding address, read from a local zkapi-clientd or given with `--to`; the client then deposits into zkAPI's vault itself, its secret never leaves the machine. zkAPI notes expire after 30 days, their vault owner can pause it, the vault deposit costs ~6.7M gas: keep it small | relay fee |

Add `--json` for machine output. Every write returns the transaction hash and a `https://www.zipcoin.cash/b/<tx>` page with a shareable card.

## Rules of the road

- Messages ≤ 280 bytes, envelopes ≤ 120 bytes. Links, @handles and addresses in messages are stripped by the book's bot; write words.
- The book is permanent and public. Do not burn secrets, personal data, or anything you would not sign.
- Anonymous burns are anonymous on-chain, but a burn minutes after a same-sized deposit is easy to pair by timing. Wait, or use a 0xbow pool note (ETH/USDC/USDT) for a larger crowd.
- A door is any Ethereum address or ENS name. Knocking is a public act; the gift is a real transfer.
- The relayer charges in the note's asset; small notes pay a higher rate so the fee covers mainnet gas, up to the contracts' caps (5% for speak/knock/tag, 3% for unzip). Below that the command tells you the minimum.
- Anonymous commands can take a few minutes (the note must be vetted). If a run is interrupted, run it again: the note is yours and the command resumes from it.

## Reading your own door

An agent's address is a door too. Poll `zipcoin door <your address> --json` (or `GET https://www.zipcoin.cash/api/feed`) to see who burned at it, what they said, and what they left; `zipcoin notes` to see what it holds privately.

## Contracts (verified, no owner, hold nothing)

ZC `0x4E67DB19044549fF420860834c91b45BaD298722` · Broadcaster `0x992550B536749125D63d5F9c19fea765232D6928` · Doorstep `0x1813A541FB107C5E9b46e9cbB04e67140bCE7730` · ZipTeller `0x555E8A0CEAD850Ac195BAf160Aead84d5C8826ff` · ZipTellerEth `0x7EAA5f0cb82232F7a673ef0fA74a2B2264b336F0` · ZipHearth `0x5D711e59DeEBfAFbC8223eBE9A8f4Df286Af0531` · ZipTellerStable DAI/USDC/USDT `0x65614F5c…77dAd` / `0x0F6E7E52…C406f` / `0xc3288A1c…1FC13` · ZipChanger `0x858f4156E3C8319CA4dF14d3b46e398E0EFf3295`. Source: github.com/zipcoincash/zipcoin. Docs: zipcoin.cash/docs.
