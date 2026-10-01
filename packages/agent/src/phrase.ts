import { randomBytes } from "node:crypto";

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** A fresh 12-word zip phrase. Keep it like a private key: it is the only way to spend your notes. */
export const generateZipPhrase = () => entropyToMnemonic(new Uint8Array(randomBytes(16)), wordlist);
