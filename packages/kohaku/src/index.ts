/**
 * zipcoin's ZC Privacy Pool, as a preset for Kohaku's Privacy Pools plugin.
 *
 * The ZC pool is a Privacy Pools v1 deployment (same circuits, same mainnet verifiers as 0xbow's) with its own Entrypoint, its own
 * association-set provider (zipcoin's postman, which writes each tree's IPFS CID on chain) and its own relayer. Kohaku's plugin is
 * parameterised by exactly those three things, so this package is configuration, not code: one call returns a plugin instance that
 * can zip (shield) and unzip (unshield) $ZC from any Kohaku-based wallet.
 *
 * Works with Kohaku (an Ethereum Foundation project); not affiliated.
 */
import { createPPv1Broadcaster, createPPv1Plugin, type PPv1Broadcaster, type PPv1BroadcasterParameters, type PPv1Instance, type PPv1PluginParameters } from "@kohaku-eth/privacy-pools";

/** Kohaku's Host (network, storage, keystore, provider), as the plugin factory types it. */
export type Host = Parameters<typeof createPPv1Plugin>[0];

export const ZC_TOKEN = "0x4E67DB19044549fF420860834c91b45BaD298722" as const;

/** The deployment, in the shape of @kohaku-eth/privacy-pools' `PrivacyPoolsV1_0xBow` constant. */
export const PrivacyPoolsV1_Zipcoin = {
  1: {
    entrypoint: {
      entrypointAddress: "0x7a8dA01d241C3cFcF7803cdb007ECE5663749193",
      deploymentBlock: 26070387n,
    },
    asset: ZC_TOKEN,
    /** zipcoin's relayer, speaking the Privacy Pools relayer API (GET /details, POST /quote, POST /request). Fee 1%, higher for small notes so it covers gas. */
    relayerUrl: "https://www.zipcoin.cash/relayer",
    /** Trees referenced by `Entrypoint.updateRoot(root, ipfsCID)` are served here by CID (and by any IPFS gateway that has them). */
    ipfsUrl: "https://www.zipcoin.cash/ipfs/",
    /** 0xbow-style association-set endpoint: GET /asp/1/public/mt-leaves with X-Pool-Scope. */
    aspUrl: "https://www.zipcoin.cash/asp",
    /** Vetting policy: every deposit is approved after a short delay unless the depositor is on a public blocklist; unapproved deposits can always ragequit. */
    policyUrl: "https://www.zipcoin.cash/docs#vetting",
  },
} as const;

export type ZipcoinPluginParameters = Partial<Omit<PPv1PluginParameters, "entrypoint">> & { chainId?: 1 };

/** `createPPv1Plugin(host, …)` pointed at the ZC pool. Override anything (e.g. `broadcasterUrl` for your own relayer, `ipfsUrl` for your gateway). */
export function createZipcoinPlugin(host: Host, params: ZipcoinPluginParameters = {}): PPv1Instance {
  const d = PrivacyPoolsV1_Zipcoin[params.chainId ?? 1];
  return createPPv1Plugin(host, {
    accountIndex: 0,
    broadcasterUrl: { zipcoin: d.relayerUrl },
    ipfsUrl: d.ipfsUrl,
    ...params,
    entrypoint: { address: BigInt(d.entrypoint.entrypointAddress), deploymentBlock: d.entrypoint.deploymentBlock },
  });
}

/** A broadcaster that submits private operations through zipcoin's relayer. */
export function createZipcoinBroadcaster(host: Host, params: Partial<PPv1BroadcasterParameters> = {}): PPv1Broadcaster {
  return createPPv1Broadcaster(host, { broadcasterUrl: { zipcoin: PrivacyPoolsV1_Zipcoin[1].relayerUrl }, ...params });
}
