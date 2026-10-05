import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  keccak256,
  parseUnits,
  http,
  toBytes,
} from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
} from "viem/accounts";
import { baseSepolia } from "viem/chains";

const ROOT = process.cwd();
const DEPLOYMENT_PATH = path.join(
  ROOT,
  ".secrets",
  "base-sepolia-deployment.json",
);
const SECRET_PATH = path.join(ROOT, ".secrets", "testnet-deployer.json");
const RPC = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";

for (const file of [DEPLOYMENT_PATH, SECRET_PATH]) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
if (deployment.chainId !== baseSepolia.id) {
  throw new Error(`Refusing smoke test on chain ${deployment.chainId}`);
}

const creatorSecret = JSON.parse(fs.readFileSync(SECRET_PATH, "utf8"));
const creator = privateKeyToAccount(creatorSecret.privateKey);
const claimant = privateKeyToAccount(generatePrivateKey());

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC),
});
const creatorWallet = createWalletClient({
  account: creator,
  chain: baseSepolia,
  transport: http(RPC),
});
const claimantWallet = createWalletClient({
  account: claimant,
  chain: baseSepolia,
  transport: http(RPC),
});

const chainId = await publicClient.getChainId();
if (chainId !== baseSepolia.id) {
  throw new Error(`Refusing smoke test: expected chain 84532, got ${chainId}`);
}

const usdcAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
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
    name: "createDrop",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint96" },
      { name: "challengeHash", type: "bytes32" },
      { name: "challengeURI", type: "string" },
    ],
    outputs: [{ name: "dropId", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dropId", type: "uint256" },
      { name: "proofHash", type: "bytes32" },
      { name: "proofURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approveAndPay",
    stateMutability: "nonpayable",
    inputs: [{ name: "dropId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "nextDropId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
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
];

async function wait(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction failed: ${hash}`);
  }
  return receipt;
}

async function waitUntil(label, check, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  const suffix =
    lastError instanceof Error ? `: last read error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${label}${suffix}`);
}

async function readDrop(dropId) {
  return publicClient.readContract({
    address: deployment.proofDrop,
    abi: proofDropAbi,
    functionName: "drops",
    args: [dropId],
  });
}

const oneUsdc = parseUnits("1", 6);

console.log(`creator  ${creator.address}`);
console.log(`claimant ${claimant.address}`);

const nextDropId = await publicClient.readContract({
  address: deployment.proofDrop,
  abi: proofDropAbi,
  functionName: "nextDropId",
});

console.log("funding claimant with test gas...");
await wait(
  await creatorWallet.sendTransaction({
    to: claimant.address,
    value: 5_000_000_000_000n,
    gas: 21_000n,
  }),
);
await waitUntil("claimant test ETH to become readable", async () => {
  const balance = await publicClient.getBalance({ address: claimant.address });
  return balance > 0n;
});

console.log("minting creator test USDC...");
await wait(
  await creatorWallet.writeContract({
    address: deployment.mockUsdc,
    abi: usdcAbi,
    functionName: "mint",
    args: [creator.address, oneUsdc],
    gas: 100_000n,
  }),
);
await waitUntil("creator test USDC balance", async () => {
  const balance = await publicClient.readContract({
    address: deployment.mockUsdc,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [creator.address],
  });
  return balance >= oneUsdc;
});

console.log("approving escrow...");
await wait(
  await creatorWallet.writeContract({
    address: deployment.mockUsdc,
    abi: usdcAbi,
    functionName: "approve",
    args: [deployment.proofDrop, oneUsdc],
    gas: 100_000n,
  }),
);
await waitUntil("USDC allowance to become readable", async () => {
  const allowance = await publicClient.readContract({
    address: deployment.mockUsdc,
    abi: usdcAbi,
    functionName: "allowance",
    args: [creator.address, deployment.proofDrop],
  });
  return allowance >= oneUsdc;
});

const challenge = "Smoke: ship one tiny useful Base feature";
console.log(`creating drop #${nextDropId}...`);
await wait(
  await creatorWallet.writeContract({
    address: deployment.proofDrop,
    abi: proofDropAbi,
    functionName: "createDrop",
    args: [
      oneUsdc,
      keccak256(toBytes(challenge)),
      "data:text/plain,Smoke%20test",
    ],
    gas: 300_000n,
  }),
);
await waitUntil("new drop to become readable", async () => {
  const drop = await readDrop(nextDropId);
  return (
    Number(drop[5]) === 0 &&
    drop[0].toLowerCase() === creator.address.toLowerCase()
  );
});

console.log("claiming from second wallet...");
await wait(
  await claimantWallet.writeContract({
    address: deployment.proofDrop,
    abi: proofDropAbi,
    functionName: "claim",
    args: [
      nextDropId,
      keccak256(toBytes("https://example.com/proofdrop-smoke")),
      "https://example.com/proofdrop-smoke",
    ],
    gas: 200_000n,
  }),
);
await waitUntil("claimed status to become readable", async () => {
  const drop = await readDrop(nextDropId);
  return (
    Number(drop[5]) === 1 &&
    drop[1].toLowerCase() === claimant.address.toLowerCase()
  );
});

console.log("creator approving + paying...");
await wait(
  await creatorWallet.writeContract({
    address: deployment.proofDrop,
    abi: proofDropAbi,
    functionName: "approveAndPay",
    args: [nextDropId],
    gas: 200_000n,
  }),
);
await waitUntil("paid status and claimant balance", async () => {
  const [drop, claimantBalance] = await Promise.all([
    readDrop(nextDropId),
    publicClient.readContract({
      address: deployment.mockUsdc,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [claimant.address],
    }),
  ]);
  return Number(drop[5]) === 2 && claimantBalance === oneUsdc;
});

const claimantBalance = await publicClient.readContract({
  address: deployment.mockUsdc,
  abi: usdcAbi,
  functionName: "balanceOf",
  args: [claimant.address],
});

console.log(
  JSON.stringify(
    {
      ok: true,
      chainId,
      dropId: nextDropId.toString(),
      creator: creator.address,
      claimant: claimant.address,
      payout: "1 test USDC",
      claimantBalance: claimantBalance.toString(),
    },
    null,
    2,
  ),
);
