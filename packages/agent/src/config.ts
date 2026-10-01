import type { Address } from "viem";

/** Everything public about zipcoin on Ethereum mainnet. Verified on Etherscan; see https://www.zipcoin.cash/docs#contracts */
export const API = process.env.ZIPCOIN_API ?? "https://www.zipcoin.cash";
export const RPC = process.env.ZIPCOIN_RPC ?? process.env.RPC_URL ?? "https://ethereum-rpc.publicnode.com";

export const ADDR = {
  zc: "0x4E67DB19044549fF420860834c91b45BaD298722" as Address,
  entrypoint: "0x7a8DA01D241C3cFcF7803cdB007EcE5663749193" as Address,
  pool: "0x6d0eBA4D1E2665bF2256507E8b0124C647ada422" as Address,
  broadcaster: "0x992550B536749125D63d5F9c19fea765232D6928" as Address,
  doorstep: "0x1813A541FB107C5E9b46e9cbB04e67140bCE7730" as Address,
  teller: "0x555E8A0CEAD850Ac195BAf160Aead84d5C8826ff" as Address,
  tellerEth: "0x7EAA5f0cb82232F7a673ef0fA74a2B2264b336F0" as Address,
  hearth: "0x5D711e59DeEBfAFbC8223eBE9A8f4Df286Af0531" as Address,
  tellerDai: "0x65614F5c532e525891302B7eD6050f5B6b777dAd" as Address,
  tellerUsdc: "0x0F6E7E5269be27e8f40C55DE5FFc5E99abCC406f" as Address,
  tellerUsdt: "0xc3288A1cA1206D9EA0b21caF7daF03B8f831FC13" as Address,
  dead: "0x000000000000000000000000000000000000dEaD" as Address,
};

export type PoolId = "zc" | "eth" | "dai" | "usdc" | "usdt";
export type PoolInfo = { id: PoolId; asset: string; decimals: number; pool: Address; entrypoint: Address; scope: bigint; minDeposit: bigint; token?: Address; teller: Address };

const BOW = "0x6818809EefCe719E480a7526D76bD3e561526b46" as Address;
export const POOLS: Record<PoolId, PoolInfo> = {
  zc: { id: "zc", asset: "ZC", decimals: 18, pool: ADDR.pool, entrypoint: ADDR.entrypoint, scope: 15272855998697339604342058151649103501360401326327795051058889250396111180967n, minDeposit: 10n ** 18n, token: ADDR.zc, teller: ADDR.teller },
  eth: { id: "eth", asset: "ETH", decimals: 18, pool: "0xF241d57C6DebAe225c0F2e6eA1529373C9A9C9fB", entrypoint: BOW, scope: 4916574638117198869413701114161172350986437430914933850166949084132905299523n, minDeposit: 10n ** 16n, teller: ADDR.tellerEth },
  dai: { id: "dai", asset: "DAI", decimals: 18, pool: "0x1c31C03B8CB2EE674D0F11De77135536db828257", entrypoint: BOW, scope: 15036211945525489305347805074288289358577232744970551616130812771908439733411n, minDeposit: 250n * 10n ** 18n, token: "0x6B175474E89094C44Da98b954EedeAC495271d0F", teller: ADDR.tellerDai },
  usdc: { id: "usdc", asset: "USDC", decimals: 6, pool: "0xb419c2867aB3CBc78921660cB95150d95A94ce86", entrypoint: BOW, scope: 16452108168275993030962142353354044100680963945240756716593099151407051066232n, minDeposit: 25n * 10n ** 6n, token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", teller: ADDR.tellerUsdc },
  usdt: { id: "usdt", asset: "USDT", decimals: 6, pool: "0xe859C0bD25f260BaEE534Fb52e307D3b64D24572", entrypoint: BOW, scope: 15021418340692283880916004685565940332387258944710606800522765380598358159605n, minDeposit: 25n * 10n ** 6n, token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", teller: ADDR.tellerUsdt },
};

/** The contracts' floor; the site's floor is about $10 of ZC, read live from the quote. */
export const MIN_BURN = 1000n * 10n ** 18n;
/** Gift at a door needs a burn of at least a tenth of it. */
export const MIN_BURN_OF_GIFT_BPS = 1000n;
export const MAX_MESSAGE_BYTES = 280;
export const MAX_TARGET_BYTES = 120;
