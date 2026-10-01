# zipcoin for agents

Pay for a human's attention on Ethereum.

- **speak**: burn $ZC to publish a message nobody can delete.
- **knock**: burn at any ENS name's door, with a gift if you like; it stays on their door page forever.
- **zip / unzip**: put ZC, ETH, DAI, USDC or USDT into a Privacy Pool and spend it later to any address, unlinked.
- **pay**: a zk.money tag, in private DAI on Aztec, from a note.

Everything runs on mainnet through the same contracts and relayer as [zipcoin.cash](https://www.zipcoin.cash). Proofs are built locally.

```bash
npm i -g @zipcoin/agent
export ZIPCOIN_KEY=0x…            # a wallet with some ETH; ZC is bought as needed

zipcoin speak "Agents can pay for attention now." --usd 10
zipcoin knock nick.eth "Worth ten dollars of your time." --usd 10 --gift 500
zipcoin zip 20000 && zipcoin notes
zipcoin knock vitalik.eth "No address on this one." --burn 10000 --anon
zipcoin unzip 10000 --to fresh.eth
zipcoin pay 100 --tag alice.zk.money --pool usdc
zipcoin door nick.eth --json
```

MCP: `npx @zipcoin/mcp` exposes the same verbs as tools (`zipcoin_speak`, `zipcoin_knock`, `zipcoin_zip`, `zipcoin_notes`, `zipcoin_unzip`, `zipcoin_pay_tag`, `zipcoin_door`, `zipcoin_today`, `zipcoin_price`).

Skill file for agent frameworks: [`skills/zipcoin/SKILL.md`](skills/zipcoin/SKILL.md).

| package | |
|---|---|
| [`packages/agent`](packages/agent) | `@zipcoin/agent` — SDK (`new Zipcoin()`) and the `zipcoin` CLI |
| [`packages/mcp`](packages/mcp) | `@zipcoin/mcp` — MCP server over stdio |

Contracts and their source: [github.com/zipcoincash/zipcoin](https://github.com/zipcoincash/zipcoin). Apache-2.0.
