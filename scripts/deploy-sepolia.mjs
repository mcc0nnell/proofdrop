import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const ROOT = process.cwd();
const SECRET_PATH = path.join(ROOT, ".secrets", "testnet-deployer.json");
const RPC = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";

if (!fs.existsSync(SECRET_PATH)) {
  throw new Error("Missing .secrets/testnet-deployer.json");
}

const secret = JSON.parse(fs.readFileSync(SECRET_PATH, "utf8"));
const account = privateKeyToAccount(secret.privateKey);
if (account.address.toLowerCase() !== secret.address.toLowerCase()) {
  throw new Error("Deployer secret/address mismatch");
}

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC),
});
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(RPC),
});

const chainId = await publicClient.getChainId();
if (chainId !== baseSepolia.id) {
  throw new Error(`Refusing deployment: expected chain 84532, got ${chainId}`);
}

const balance = await publicClient.getBalance({ address: account.address });
console.log(`deployer ${account.address}`);
console.log(`balance  ${formatEther(balance)} ETH`);
if (balance === 0n) {
  throw new Error("Deployer has no Base Sepolia ETH. Fund it from a testnet faucet first.");
}

function artifact(name) {
  const file = path.join(
    ROOT,
    "artifacts",
    "contracts",
    "src",
    `${name}.sol`,
    `${name}.json`,
  );
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  return { abi: json.abi, bytecode: json.bytecode };
}

const mock = artifact("MockUSDC");
const proof = artifact("ProofDrop");

console.log("deploying MockUSDC...");
const mockHash = await walletClient.deployContract({
  account,
  abi: mock.abi,
  bytecode: mock.bytecode,
});
const mockReceipt = await publicClient.waitForTransactionReceipt({ hash: mockHash });
if (mockReceipt.status !== "success" || !mockReceipt.contractAddress) {
  throw new Error("MockUSDC deployment failed");
}
const mockUsdc = mockReceipt.contractAddress;
console.log(`MockUSDC ${mockUsdc}`);

console.log("deploying ProofDrop...");
const proofHash = await walletClient.deployContract({
  account,
  abi: proof.abi,
  bytecode: proof.bytecode,
  args: [mockUsdc],
});
const proofReceipt = await publicClient.waitForTransactionReceipt({ hash: proofHash });
if (proofReceipt.status !== "success" || !proofReceipt.contractAddress) {
  throw new Error("ProofDrop deployment failed");
}
const proofDrop = proofReceipt.contractAddress;
console.log(`ProofDrop ${proofDrop}`);

const deploymentBlock =
  mockReceipt.blockNumber < proofReceipt.blockNumber
    ? mockReceipt.blockNumber
    : proofReceipt.blockNumber;

const env = [
  "NEXT_PUBLIC_CHAIN=base-sepolia",
  `NEXT_PUBLIC_PROOFDROP_ADDRESS=${proofDrop}`,
  `NEXT_PUBLIC_USDC_ADDRESS=${mockUsdc}`,
  `NEXT_PUBLIC_DEPLOYMENT_BLOCK=${deploymentBlock}`,
  "NEXT_PUBLIC_BUILDER_CODE=",
  "NEXT_PUBLIC_URL=http://localhost:3000",
  "FARCASTER_HEADER=",
  "FARCASTER_PAYLOAD=",
  "FARCASTER_SIGNATURE=",
  "",
].join("\n");
fs.writeFileSync(path.join(ROOT, ".env.local"), env, { mode: 0o600 });

const deployment = {
  chainId,
  network: "base-sepolia",
  deployer: account.address,
  mockUsdc,
  proofDrop,
  deploymentBlock: deploymentBlock.toString(),
  transactions: {
    mockUsdc: mockHash,
    proofDrop: proofHash,
  },
};
fs.writeFileSync(
  path.join(ROOT, ".secrets", "base-sepolia-deployment.json"),
  JSON.stringify(deployment, null, 2) + "\n",
  { mode: 0o600 },
);

console.log("wrote .env.local");
console.log(JSON.stringify(deployment, null, 2));
