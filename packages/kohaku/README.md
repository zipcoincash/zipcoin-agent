# @zipcoin/kohaku

zipcoin's **$ZC Privacy Pool** as a preset for [Kohaku](https://github.com/ethereum/kohaku)'s Privacy Pools plugin. One call, and a
Kohaku-based wallet can zip (shield) and unzip (unshield) ZC.

```ts
import { createZipcoinPlugin } from "@zipcoin/kohaku";

const zc = createZipcoinPlugin(host);              // host: your Kohaku Host (network, storage, keystore, provider)
await zc.prepareShield({ asset: ZC_TOKEN, amount: 10_000n * 10n ** 18n });
await zc.prepareUnshield({ asset: ZC_TOKEN, amount: 5_000n * 10n ** 18n }, recipient);
```

## What it points at

| | |
|---|---|
| Entrypoint (mainnet) | `0x7a8dA01d241C3cFcF7803cdb007ECE5663749193`, block 26070387 |
| Asset | `$ZC` `0x4E67DB19044549fF420860834c91b45BaD298722` |
| Relayer | `https://www.zipcoin.cash/relayer` — `GET /details`, `POST /quote`, `POST /request` (the Privacy Pools relayer API) |
| Association set | `Entrypoint.updateRoot(root, ipfsCID)` carries the real CID of the tree; served at `https://www.zipcoin.cash/ipfs/<cid>` and at `GET /asp/1/public/mt-leaves` (0xbow style) |

The pool is a Privacy Pools v1 deployment: the same circuits and the same mainnet verifiers as 0xbow's pools, with zipcoin's own
Entrypoint, vetting (approve-after-delay, public blocklist, ragequit always possible) and relayer. Proofs made in Kohaku verify on the
pool unchanged.

Works with Kohaku (an Ethereum Foundation project) and with Privacy Pools (0xbow); not affiliated with either. Unaudited; use at your
own risk. More: https://www.zipcoin.cash/docs
