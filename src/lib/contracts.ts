import { parseAbi } from "viem";

export const PROOFDROP_ABI = parseAbi([
  "function nextDropId() view returns (uint256)",
  "function drops(uint256) view returns (address creator,address claimant,uint96 amount,uint40 createdAt,uint40 claimedAt,uint8 status,bytes32 challengeHash,bytes32 proofHash)",
  "function createDrop(uint96 amount,bytes32 challengeHash,string challengeURI) returns (uint256 dropId)",
  "function claim(uint256 dropId,bytes32 proofHash,string proofURI)",
  "function withdrawClaim(uint256 dropId)",
  "function rejectClaim(uint256 dropId)",
  "function approveAndPay(uint256 dropId)",
  "function cancel(uint256 dropId)",
  "event DropCreated(uint256 indexed dropId,address indexed creator,uint96 amount,bytes32 indexed challengeHash,string challengeURI)",
  "event DropClaimed(uint256 indexed dropId,address indexed claimant,bytes32 indexed proofHash,string proofURI)",
  "event ClaimWithdrawn(uint256 indexed dropId,address indexed claimant)",
  "event ClaimRejected(uint256 indexed dropId,address indexed claimant)",
  "event DropPaid(uint256 indexed dropId,address indexed claimant,uint96 amount)",
  "event DropCancelled(uint256 indexed dropId,uint96 amount)",
]);

export const USDC_ABI = parseAbi([
  "function mint(address to,uint256 amount)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export const BASE_USDC =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;
