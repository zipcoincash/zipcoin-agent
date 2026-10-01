import { encodeAbiParameters, type Address, type Hex } from "viem";

export const relayDataParams = [
  {
    type: "tuple",
    components: [
      { name: "recipient", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "relayFeeBPS", type: "uint256" },
    ],
  },
] as const;

export const speechParams = [
  {
    type: "tuple",
    components: [
      { name: "message", type: "string" },
      { name: "target", type: "string" },
      { name: "feeRecipient", type: "address" },
      { name: "relayFeeBPS", type: "uint256" },
    ],
  },
] as const;

export const doorSpeechParams = [
  {
    type: "tuple",
    components: [
      { name: "message", type: "string" },
      { name: "target", type: "string" },
      { name: "to", type: "address" },
      { name: "gift", type: "uint256" },
      { name: "feeRecipient", type: "address" },
      { name: "relayFeeBPS", type: "uint256" },
    ],
  },
] as const;

export const encodeDoorSpeech = (message: string, target: string, to: Address, gift: bigint, feeRecipient: Address, relayFeeBPS: bigint) =>
  encodeAbiParameters(doorSpeechParams, [{ message, target, to, gift, feeRecipient, relayFeeBPS }]);

/** ZipTeller: pay DAI to `to` from a zipped note. */
export const paymentParams = [
  {
    type: "tuple",
    components: [
      { name: "to", type: "address" },
      { name: "minOut", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "feeRecipient", type: "address" },
      { name: "relayFeeBPS", type: "uint256" },
    ],
  },
] as const;

/** ZipHearth: speak or knock from an ETH note. */
export const wordParams = [
  {
    type: "tuple",
    components: [
      { name: "message", type: "string" },
      { name: "target", type: "string" },
      { name: "to", type: "address" },
      { name: "gift", type: "uint256" },
      { name: "minZcOut", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "feeRecipient", type: "address" },
      { name: "relayFeeBPS", type: "uint256" },
    ],
  },
] as const;

export const encodeWord = (w: { message: string; target: string; to: Address; gift: bigint; minZcOut: bigint; deadline: bigint; feeRecipient: Address; relayFeeBPS: bigint }) =>
  encodeAbiParameters(wordParams, [w]);

export const encodePayment = (to: Address, minOut: bigint, deadline: bigint, feeRecipient: Address, relayFeeBPS: bigint) =>
  encodeAbiParameters(paymentParams, [{ to, minOut, deadline, feeRecipient, relayFeeBPS }]);

export const encodeRelayData = (recipient: Address, feeRecipient: Address, relayFeeBPS: bigint) =>
  encodeAbiParameters(relayDataParams, [{ recipient, feeRecipient, relayFeeBPS }]);

export const encodeSpeech = (message: string, target: string, feeRecipient: Address, relayFeeBPS: bigint) =>
  encodeAbiParameters(speechParams, [{ message, target, feeRecipient, relayFeeBPS }]);

export type WithdrawalJson = { processooor: Address; data: Hex };
export type ProofJson = { pA: string[]; pB: string[][]; pC: string[]; pubSignals: string[] };
