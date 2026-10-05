import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const ROOT = process.cwd();
const DEPLOYMENT_PATH = path.join(
  ROOT,
  ".secrets",
  "base-sepolia-deployment.json",
);
const SECRET_PATH = path.join(ROOT, ".secrets", "testnet-deployer.json");
const RPC = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const dropId = BigInt(process.argv[2] ?? "1");

for (const file of [DEPLOYMENT_PATH, SECRET_PATH]) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
if (deployment.chainId !== baseSepolia.id) {
  throw new Error(`Refusing resume on chain ${deployment.chainId}`);
}

const creatorSecret = JSON.parse(fs.readFileSync(SECRET_PATH, "utf8"));
const creator = privateKeyToAccount(creatorSecret.privateKey);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC),
});
const creatorWallet = createWalletClient({
  account: creator,
  chain: baseSepolia,
  transport: http(RPC),
});

const chainId = await publicClient.getChainId();
if (chainId !== baseSepolia.id) {
  throw new Error(`Refusing resume: expected chain 84532, got ${chainId}`);
}

const usdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const proofDropAbi = [
  {
    type: "function",
    name: "drops",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "claimant", type: "address" },
      { name: "amount", type: "uint96" },
      { name: "createdAt", type: "uint40" },
      { name: "claimedAt", type: "uint40" },
      { name: "status", type: "uint8" },
      { name: "challengeHash", type: "bytes32" },
      { name: "proofHash", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "approveAndPay",
    stateMutability: "nonpayable",
    inputs: [{ name: "dropId", type: "uint256" }],
    outputs: [],
  },
];

async function readDrop() {
  return publicClient.readContract({
    address: deployment.proofDrop,
    abi: proofDropAbi,
    functionName: "drops",
    args: [dropId],
  });
}

async function waitUntil(label, check, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const before = await readDrop();
const status = Number(before[5]);
const claimant = before[1];

console.log(
  JSON.stringify(
    {
      chainId,
      dropId: dropId.toString(),
      creator: before[0],
      claimant,
      amount: formatUnits(before[2], 6),
      status,
    },
    null,
    2,
  ),
);

if (before[0].toLowerCase() !== creator.address.toLowerCase()) {
  throw new Error("Configured deployer is not the drop creator");
}
if (status === 2) {
  console.log("Drop is already paid.");
  process.exit(0);
}
if (status !== 1) {
  throw new Error(`Drop must be Claimed (1) to resume; current status is ${status}`);
}

console.log(`paying claimed drop #${dropId}...`);
const hash = await creatorWallet.writeContract({
  address: deployment.proofDrop,
  abi: proofDropAbi,
  functionName: "approveAndPay",
  args: [dropId],
  gas: 200_000n,
});

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") {
  throw new Error(`Payment transaction failed: ${hash}`);
}

await waitUntil("paid status and claimant balance", async () => {
  const [drop, balance] = await Promise.all([
    readDrop(),
    publicClient.readContract({
      address: deployment.mockUsdc,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [claimant],
    }),
  ]);
  return Number(drop[5]) === 2 && balance === before[2];
});

const balance = await publicClient.readContract({
  address: deployment.mockUsdc,
  abi: usdcAbi,
  functionName: "balanceOf",
  args: [claimant],
});

console.log(
  JSON.stringify(
    {
      ok: true,
      chainId,
      dropId: dropId.toString(),
      claimant,
      transactionHash: hash,
      claimantBalance: formatUnits(balance, 6),
      status: "Paid",
    },
    null,
    2,
  ),
);
