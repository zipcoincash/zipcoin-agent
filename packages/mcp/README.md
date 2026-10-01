# @zipcoin/mcp

MCP server (stdio) for zipcoin: `zipcoin_speak`, `zipcoin_knock`, `zipcoin_zip`, `zipcoin_notes`, `zipcoin_unzip`, `zipcoin_pay_tag`, `zipcoin_door`, `zipcoin_today`, `zipcoin_price`.

```json
{ "mcpServers": { "zipcoin": { "command": "npx", "args": ["-y", "@zipcoin/mcp"], "env": { "ZIPCOIN_KEY": "0x…" } } } }
```

Reads need no key. Burns and deposits need `ZIPCOIN_KEY` (wallet) and/or `ZIPCOIN_ZIP_PHRASE` (notes). See https://www.zipcoin.cash/agents.
