import { getAddress, isAddress, type Address } from "viem";

/**
 * Names, claimed by burning: `alice.zipcoin.cash` is a page, a door and an ENS name (`alice.zipbook.eth`), and the Book is
 * the registry. A claim is an ordinary public burn with `/claim alice` on the envelope; the site's API says what a name
 * costs and who holds it. Rules (reserved words, names kept for the owner of a .eth, the price by length) are data on
 * `GET /api/v1/rules` under `names`. Docs: https://www.zipcoin.cash/docs#names.
 */
export type NameStatus = "available" | "taken" | "released" | "reserved" | "reserved-for" | "invalid";
export type NameCheck = {
  name: string;
  status: NameStatus;
  /** The holder (`taken`), or the only address the name may bind to (`reserved-for`). */
  address: string | null;
  since: number | null;
  tx: string | null;
  /** What a claim of this label burns now: the tier by its length and the amounts, whole zipcoins. */
  tier: "row" | "card" | "large";
  priceZc: number;
  presetZc: number;
  priceUsd: number | null;
  room: number;
};
export type NameEvent = { verb: "claim" | "release" | "transfer" | "reserve"; tx: string; block: number; time: number; speaker: string | null; from: string | null; to: string | null; zc: number };
export type NameRecord = { name: string; address: string | null; since: number; tx: string | null; claimedAt: number; reservedFor: string | null; history: NameEvent[] };

/** 3–24 lowercase letters, digits and hyphens, no hyphen at either end — checked here before the API is asked. */
export const NAME_RE = /^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/;

/** `alice`, `Alice.zipcoin.cash` or `alice.zipbook.eth` → `alice`; throws for anything that cannot be a name. */
export function nameLabel(input: string): string {
  const label = input
    .trim()
    .toLowerCase()
    .replace(/\.(zipcoin\.cash|zipbook\.eth)$/, "");
  if (!NAME_RE.test(label)) throw new Error(`"${input}" is not a name: 3–24 lowercase letters, digits and hyphens, no hyphen at either end`);
  return label;
}

/** The envelope that claims a name, for the wallet that burns or for `forAddress`. */
export function claimEnvelope(label: string, forAddress?: string | null): string {
  if (forAddress && !isAddress(forAddress)) throw new Error(`${forAddress} is not an address`);
  return `/claim ${label}${forAddress ? ` ${getAddress(forAddress).toLowerCase()}` : ""}`;
}

/** What a claim buys, in one line. */
export function describeClaimPrice(c: NameCheck): string {
  const words = c.tier === "row" ? "a row: a name costs one word" : c.tier === "card" ? "a front-page card at the room, four letters being short" : "a large word at the room, three letters being rare";
  return `${c.presetZc.toLocaleString("en-US")} zc${c.priceUsd ? ` (≈ $${c.priceUsd.toFixed(0)})` : ""} — ${words}`;
}

/** Whether a check lets `who` claim the name (the site's rules, read back from its answer). */
export function claimable(c: NameCheck, who: Address | null, forAddress?: string | null): { ok: true; bindTo: string | null } | { ok: false; why: string } {
  const to = (forAddress ?? who ?? "").toLowerCase() || null;
  switch (c.status) {
    case "available":
    case "released":
      return { ok: true, bindTo: forAddress ? to : null };
    case "reserved-for":
      if (!c.address) return { ok: false, why: `${c.name} is kept for the owner of ${c.name}.eth, which points at no address yet; nobody can claim it` };
      // theirs to claim: the envelope names the address unless the wallet that burns is that address already
      if (to === c.address) return { ok: true, bindTo: who?.toLowerCase() === c.address && !forAddress ? null : c.address };
      return { ok: false, why: `${c.name} is kept for ${c.address}: a claim must be for that address (--for ${c.address})` };
    case "taken":
      return { ok: false, why: `${c.name} is held by ${c.address} since ${new Date((c.since ?? 0) * 1000).toISOString().slice(0, 10)}` };
    case "reserved":
      return { ok: false, why: `${c.name} is reserved` };
    default:
      return { ok: false, why: `${c.name} is not a valid name` };
  }
}
