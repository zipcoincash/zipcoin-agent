import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const errors = [
  "error AssetMismatch()",
  "error BurnTooSmall()",
  "error ContextMismatch()",
  "error EmptyMessage()",
  "error IncorrectASPRoot()",
  "error InvalidCommitment()",
  "error InvalidPoolState()",
  "error InvalidProcessooor()",
  "error InvalidProof()",
  "error InvalidTreeDepth()",
  "error InvalidWithdrawalAmount()",
  "error MessageTooLong()",
  "error MinimumDepositAmount()",
  "error NoRootsAvailable()",
  "error NotYetRagequitteable()",
  "error NullifierAlreadySpent()",
  "error OnlyOriginalDepositor()",
  "error PoolIsDead()",
  "error PoolNotFound()",
  "error PrecommitmentAlreadyUsed()",
  "error RelayFeeGreaterThanMax()",
  "error RelayFeeTooHigh()",
  "error TargetTooLong()",
  "error UnknownStateRoot()",
] as const;

const withdrawal = "(address processooor, bytes data)";
const withdrawProof = "(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals)";
const ragequitProof = "(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[4] pubSignals)";

export const entrypointAbi = parseAbi([
  "function deposit(address _asset, uint256 _value, uint256 _precommitment) returns (uint256)",
  "function deposit(uint256 _precommitment) payable returns (uint256)",
  `function relay(${withdrawal} _withdrawal, ${withdrawProof} _proof, uint256 _scope)`,
  "function latestRoot() view returns (uint256)",
  "function updateRoot(uint256 _root, string _ipfsCID) returns (uint256)",
  "function assetConfig(address) view returns (address pool, uint256 minimumDepositAmount, uint256 vettingFeeBPS, uint256 maxRelayFeeBPS)",
  "event RootUpdated(uint256 _root, string _ipfsCID, uint256 _timestamp)",
  "event WithdrawalRelayed(address indexed _relayer, address indexed _recipient, address indexed _asset, uint256 _amount, uint256 _feeAmount)",
  ...errors,
]);

export const poolAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
  "event Withdrawn(address indexed _processooor, uint256 _value, uint256 _spentNullifier, uint256 _newCommitment)",
  "event Ragequit(address indexed _ragequitter, uint256 _commitment, uint256 _label, uint256 _value)",
  `function ragequit(${ragequitProof} _proof)`,
  "function currentRoot() view returns (uint256)",
  ...errors,
]);

export const broadcasterAbi = parseAbi([
  "function speak(uint256 _amount, string _message, string _target)",
  `function speakAnon(${withdrawal} _withdrawal, ${withdrawProof} _proof)`,
  "event Spoken(address indexed speaker, uint256 indexed nullifierHash, uint256 burned, uint256 fee, string message, string target)",
  ...errors,
]);

export const doorstepAbi = parseAbi([
  "function speak(address _to, uint256 _burn, uint256 _gift, string _message, string _target)",
  `function speakAnon(${withdrawal} _withdrawal, ${withdrawProof} _proof)`,
  "event Spoken(address indexed speaker, address indexed to, uint256 indexed nullifierHash, uint256 burned, uint256 gift, uint256 fee, string message, string target)",
  "error GiftNeedsDoor()",
  "error InvalidDoor()",
  "error ValueTooSmall()",
  ...errors,
]);

export const tellerAbi = parseAbi([
  `function pay(${withdrawal} _withdrawal, ${withdrawProof} _proof)`,
  "function MAX_OUT() view returns (uint256)",
  "function MIN_OUT() view returns (uint256)",
  "event Paid(address indexed to, uint256 nullifierHash, uint256 zcIn, uint256 daiOut, uint256 fee)",
  "error InvalidRecipient()",
  "error Expired()",
  "error MinOutOfRange()",
  "error TooMuchForOneDeposit()",
  ...errors,
]);

export const tellerEthAbi = parseAbi([
  `function pay(${withdrawal} _withdrawal, ${withdrawProof} _proof)`,
  "event Paid(address indexed to, uint256 nullifierHash, uint256 ethIn, uint256 daiOut, uint256 fee)",
  "error InvalidRecipient()",
  "error Expired()",
  "error MinOutOfRange()",
  "error TooMuchForOneDeposit()",
  "error FeeTransferFailed()",
  ...errors,
]);

export const tellerStableAbi = parseAbi([
  `function pay(${withdrawal} _withdrawal, ${withdrawProof} _proof)`,
  "event Paid(address indexed to, uint256 nullifierHash, uint256 assetIn, uint256 daiOut, uint256 fee)",
  "error InvalidRecipient()",
  "error Expired()",
  "error MinOutOfRange()",
  "error TooMuchForOneDeposit()",
  "error TooLittleReceived()",
  ...errors,
]);

export const hearthAbi = parseAbi([
  `function speak(${withdrawal} _withdrawal, ${withdrawProof} _proof)`,
  "event Hearth(address indexed to, uint256 nullifierHash, uint256 ethIn, uint256 zcBurned, uint256 gift, uint256 fee)",
  "error GiftNeedsDoor()",
  "error InvalidDoor()",
  "error Expired()",
  "error TransferFailed()",
  ...errors,
]);

/** Stockereum's LaunchRouter quotes and Uniswap's QuoterV2, for pricing a payment before it is proven. */
export const routerQuoteAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function quoteSell(PoolKey key, address token, uint256 amountIn) returns (uint256 quoteOut)",
  "function quoteBuy(PoolKey key, address quote, uint256 amountIn) returns (uint256 tokensOut)",
]);
export const quoterV2Abi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const senderFactoryAbi = parseAbi([
  "function launches(address) view returns (address token, address creator, uint256 tokenId, bytes32 poolId, uint64 createdAt, address quote)",
]);

export const senderLockerAbi = parseAbi([
  "function claimable(uint256 tokenId) view returns (uint256 tokenAmount, uint256 ethAmount)",
  "event FeesCollected(uint256 indexed tokenId, uint256 tokenAmount, uint256 ethAmount, uint256 creatorEth, uint256 protocolEth)",
]);

export const poolManagerAbi = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);

export const chainlinkAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80)",
]);
