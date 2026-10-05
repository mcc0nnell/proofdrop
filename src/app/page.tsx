"use client";

import { sdk } from "@farcaster/miniapp-sdk";
import {
  ArrowRight,
  Check,
  CircleDollarSign,
  ExternalLink,
  Flame,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatUnits,
  keccak256,
  parseAbiItem,
  parseUnits,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import {
  BASE_USDC,
  PROOFDROP_ABI,
  USDC_ABI,
  ZERO_ADDRESS,
} from "@/lib/contracts";
import { proofDropChain } from "@/lib/wagmi";

type DropView = {
  id: bigint;
  creator: Address;
  claimant: Address;
  amount: bigint;
  createdAt: bigint;
  status: number;
  challengeHash: Hex;
  proofHash: Hex;
  challenge: string;
};

const STATUS = ["OPEN", "CLAIMED", "PAID", "CANCELLED"] as const;
const CONTRACT = process.env.NEXT_PUBLIC_PROOFDROP_ADDRESS as
  | Address
  | undefined;
const CONFIGURED_USDC = process.env.NEXT_PUBLIC_USDC_ADDRESS as
  | Address
  | undefined;
const USDC =
  CONFIGURED_USDC ?? (proofDropChain.id === 8453 ? BASE_USDC : undefined);

function short(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

function challengeToUri(challenge: string) {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(challenge)}`;
}

function challengeFromUri(uri?: string) {
  if (!uri?.startsWith("data:text/plain")) return "Proof-backed micro-bounty";
  const comma = uri.indexOf(",");
  if (comma === -1) return "Proof-backed micro-bounty";
  try {
    return decodeURIComponent(uri.slice(comma + 1));
  } catch {
    return "Proof-backed micro-bounty";
  }
}

function DemoDrop() {
  return (
    <article className="drop-card demo-card">
      <div className="drop-topline">
        <span className="status-pill">OPEN</span>
        <span className="drop-id">DRY RUN</span>
      </div>
      <div className="amount-row">
        <span className="amount">$1</span>
        <span className="token">USDC</span>
      </div>
      <h3>Ship one tiny, useful Base app feature.</h3>
      <p className="muted">
        Submit a public URL that proves the work. Creator approves. Escrow pays.
      </p>
      <div className="receipt">
        <ShieldCheck size={16} />
        <span>challenge hash → proof hash → payout receipt</span>
      </div>
    </article>
  );
}

export default function Home() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: isConnecting, error: connectError } =
    useConnect();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const [drops, setDrops] = useState<DropView[]>([]);
  const [loadingDrops, setLoadingDrops] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [challenge, setChallenge] = useState(
    "Ship a tiny useful Base app feature.",
  );
  const [amount, setAmount] = useState("1");
  const [proofs, setProofs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [insideMiniApp, setInsideMiniApp] = useState(false);

  const configured = Boolean(CONTRACT && USDC);

  useEffect(() => {
    let active = true;
    sdk.isInMiniApp().then((inside) => {
      if (!active) return;
      setInsideMiniApp(inside);
      if (inside && !isConnected) {
        const mini = connectors.find(
          (connector) =>
            connector.id.toLowerCase().includes("farcaster") ||
            connector.name.toLowerCase().includes("farcaster"),
        );
        if (mini) connect({ connector: mini });
      }
    });
    return () => {
      active = false;
    };
  }, [connect, connectors, isConnected]);

  const loadDrops = useCallback(async () => {
    if (!publicClient || !CONTRACT) {
      setDrops([]);
      return;
    }

    setLoadingDrops(true);
    try {
      const latest = await publicClient.getBlockNumber();
      const deploymentBlock = process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK;
      const fromBlock = deploymentBlock
        ? BigInt(deploymentBlock)
        : latest > 50_000n
          ? latest - 50_000n
          : 0n;

      const logs = await publicClient.getLogs({
        address: CONTRACT,
        event: parseAbiItem(
          "event DropCreated(uint256 indexed dropId,address indexed creator,uint96 amount,bytes32 indexed challengeHash,string challengeURI)",
        ),
        fromBlock,
        toBlock: "latest",
      });

      const rows = await Promise.all(
        logs.slice(-50).map(async (log) => {
          const args = log.args as {
            dropId?: bigint;
            creator?: Address;
            amount?: bigint;
            challengeHash?: Hex;
            challengeURI?: string;
          };
          const id = args.dropId ?? 0n;
          const onchain = (await publicClient.readContract({
            address: CONTRACT,
            abi: PROOFDROP_ABI,
            functionName: "drops",
            args: [id],
          })) as readonly [
            Address,
            Address,
            bigint,
            number,
            number,
            number,
            Hex,
            Hex,
          ];

          return {
            id,
            creator: onchain[0],
            claimant: onchain[1],
            amount: onchain[2],
            createdAt: BigInt(onchain[3]),
            status: Number(onchain[5]),
            challengeHash: onchain[6],
            proofHash: onchain[7],
            challenge: challengeFromUri(args.challengeURI),
          } satisfies DropView;
        }),
      );

      setDrops(rows.reverse());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load drops.");
    } finally {
      setLoadingDrops(false);
    }
  }, [publicClient]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDrops();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDrops, refreshNonce]);

  const preferredConnector = useMemo(
    () =>
      connectors.find((c) => c.name.toLowerCase().includes("coinbase")) ??
      connectors.find((c) => !c.id.toLowerCase().includes("farcaster")) ??
      connectors[0],
    [connectors],
  );

  async function wait(hash: Hex) {
    if (!publicClient) throw new Error("No Base RPC client.");
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function mintTestUsdc() {
    setError("");
    setNotice("");
    if (!address || !USDC || proofDropChain.id === 8453) return;
    try {
      setNotice("Minting 10 test USDC…");
      const hash = await writeContractAsync({
        address: USDC,
        abi: USDC_ABI,
        functionName: "mint",
        args: [address, parseUnits("10", 6)],
        chainId: proofDropChain.id,
      });
      await wait(hash);
      setNotice("10 test USDC minted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Test mint failed.");
      setNotice("");
    }
  }

  async function createDrop() {
    setError("");
    setNotice("");
    if (!address || !CONTRACT || !USDC || !publicClient) {
      setError("Connect a wallet and configure the testnet deployment first.");
      return;
    }

    const cleanChallenge = challenge.trim();
    if (!cleanChallenge) {
      setError("Challenge cannot be empty.");
      return;
    }

    try {
      const units = parseUnits(amount, 6);
      if (units <= 0n) throw new Error("Amount must be greater than zero.");
      const challengeHash = keccak256(toBytes(cleanChallenge));

      setNotice("1/2 Approving USDC escrow…");
      const approveHash = await writeContractAsync({
        address: USDC,
        abi: USDC_ABI,
        functionName: "approve",
        args: [CONTRACT, units],
        chainId: proofDropChain.id,
      });
      await wait(approveHash);

      setNotice("2/2 Creating ProofDrop…");
      const createHash = await writeContractAsync({
        address: CONTRACT,
        abi: PROOFDROP_ABI,
        functionName: "createDrop",
        args: [units, challengeHash, challengeToUri(cleanChallenge)],
        chainId: proofDropChain.id,
      });
      await wait(createHash);

      setNotice("Drop is live. The $1 is in escrow.");
      setRefreshNonce((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transaction failed.");
      setNotice("");
    }
  }

  async function submitProof(drop: DropView) {
    const proofUri = proofs[drop.id.toString()]?.trim();
    if (!proofUri || !CONTRACT) {
      setError("Paste a public proof URL first.");
      return;
    }
    setError("");
    setNotice(`Claiming drop #${drop.id.toString()}…`);
    try {
      const proofHash = keccak256(toBytes(proofUri));
      const hash = await writeContractAsync({
        address: CONTRACT,
        abi: PROOFDROP_ABI,
        functionName: "claim",
        args: [drop.id, proofHash, proofUri],
        chainId: proofDropChain.id,
      });
      await wait(hash);
      setNotice("Proof committed onchain.");
      setRefreshNonce((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Claim failed.");
      setNotice("");
    }
  }

  async function act(
    drop: DropView,
    action: "approveAndPay" | "rejectClaim" | "cancel",
  ) {
    if (!CONTRACT) return;
    setError("");
    setNotice(
      action === "approveAndPay"
        ? `Paying drop #${drop.id.toString()}…`
        : `Updating drop #${drop.id.toString()}…`,
    );
    try {
      const hash = await writeContractAsync({
        address: CONTRACT,
        abi: PROOFDROP_ABI,
        functionName: action,
        args: [drop.id],
        chainId: proofDropChain.id,
      });
      await wait(hash);
      setNotice(action === "approveAndPay" ? "Paid. Receipt is final." : "Done.");
      setRefreshNonce((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transaction failed.");
      setNotice("");
    }
  }

  return (
    <main className="shell">
      <header className="nav">
        <a className="brand" href="#">
          <span className="brand-mark">P</span>
          <span>PROOFDROP</span>
        </a>
        <div className="network-pill">
          <span className="live-dot" />
          {proofDropChain.id === 8453 ? "BASE" : "BASE SEPOLIA"}
        </div>
        {isConnected ? (
          <button className="wallet-button ghost" onClick={() => disconnect()}>
            <Wallet size={15} />
            {short(address)}
          </button>
        ) : (
          <button
            className="wallet-button"
            disabled={!preferredConnector || isConnecting}
            onClick={() =>
              preferredConnector && connect({ connector: preferredConnector })
            }
          >
            <Wallet size={15} />
            {isConnecting ? "CONNECTING…" : "CONNECT"}
          </button>
        )}
      </header>

      <section className="hero">
        <div className="eyebrow">
          <Flame size={16} />
          $10 → BUILD THE LOTTERY TICKET
        </div>
        <h1>
          PUT MONEY
          <br />
          <span>BEHIND PROOF.</span>
        </h1>
        <p className="hero-copy">
          Tiny USDC bounties. Public proof. Onchain receipts. No leverage, no
          memecoin, no admin rug switch.
        </p>
        <div className="hero-facts">
          <div>
            <strong>$1</strong>
            <span>DEFAULT DROP</span>
          </div>
          <div>
            <strong>0×</strong>
            <span>LEVERAGE</span>
          </div>
          <div>
            <strong>8021</strong>
            <span>BUILDER ATTRIBUTION</span>
          </div>
        </div>
      </section>

      <section className="composer">
        <div className="section-kicker">
          <Sparkles size={15} />
          CREATE A DROP
        </div>
        <textarea
          value={challenge}
          onChange={(event) => setChallenge(event.target.value)}
          maxLength={180}
          aria-label="Challenge"
        />
        <div className="composer-bottom">
          <label className="amount-input">
            <CircleDollarSign size={18} />
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label="USDC amount"
            />
            <span>USDC</span>
          </label>
          <button
            className="primary"
            onClick={createDrop}
            disabled={!configured || !isConnected || isWriting}
          >
            {isWriting ? "SIGNING…" : "FUND DROP"}
            <ArrowRight size={18} />
          </button>
        </div>
        {!configured && (
          <div className="dry-run">
            TESTNET DRY RUN — contract addresses are intentionally unset until
            deployment.
          </div>
        )}
        {configured && proofDropChain.id !== 8453 && isConnected && (
          <button
            className="test-mint"
            onClick={mintTestUsdc}
            disabled={isWriting}
          >
            MINT 10 TEST USDC
          </button>
        )}
      </section>

      {(notice || error || connectError) && (
        <div className={error || connectError ? "flash error" : "flash"}>
          {error || connectError?.message || notice}
        </div>
      )}

      <section className="feed">
        <div className="feed-heading">
          <div>
            <span className="section-kicker">LIVE DROPS</span>
            <h2>Proof earns the payout.</h2>
          </div>
          <button
            className="icon-button"
            onClick={() => setRefreshNonce((value) => value + 1)}
            aria-label="Refresh drops"
          >
            <RefreshCw size={18} className={loadingDrops ? "spin" : ""} />
          </button>
        </div>

        <div className="drop-grid">
          {!configured && <DemoDrop />}
          {configured && !loadingDrops && drops.length === 0 && (
            <div className="empty">No drops yet. Make the first one filthy.</div>
          )}

          {drops.map((drop) => {
            const mine =
              address?.toLowerCase() === drop.creator.toLowerCase();
            const open = drop.status === 0;
            const claimed = drop.status === 1;

            return (
              <article className="drop-card" key={drop.id.toString()}>
                <div className="drop-topline">
                  <span className={`status-pill status-${drop.status}`}>
                    {STATUS[drop.status] ?? "UNKNOWN"}
                  </span>
                  <span className="drop-id">#{drop.id.toString()}</span>
                </div>

                <div className="amount-row">
                  <span className="amount">
                    ${formatUnits(drop.amount, 6)}
                  </span>
                  <span className="token">USDC</span>
                </div>

                <h3>{drop.challenge}</h3>
                <div className="addresses">
                  <span>by {short(drop.creator)}</span>
                  {drop.claimant !== ZERO_ADDRESS && (
                    <span>claim {short(drop.claimant)}</span>
                  )}
                </div>

                {open && !mine && (
                  <div className="claim-box">
                    <input
                      type="url"
                      placeholder="https://your-proof.example"
                      value={proofs[drop.id.toString()] ?? ""}
                      onChange={(event) =>
                        setProofs((current) => ({
                          ...current,
                          [drop.id.toString()]: event.target.value,
                        }))
                      }
                    />
                    <button
                      onClick={() => submitProof(drop)}
                      disabled={!isConnected || isWriting}
                    >
                      CLAIM
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}

                {mine && claimed && (
                  <div className="creator-actions">
                    <button
                      className="approve"
                      onClick={() => act(drop, "approveAndPay")}
                      disabled={isWriting}
                    >
                      <Check size={15} /> APPROVE + PAY
                    </button>
                    <button
                      className="reject"
                      onClick={() => act(drop, "rejectClaim")}
                      disabled={isWriting}
                    >
                      <X size={15} /> REJECT
                    </button>
                  </div>
                )}

                {mine && open && (
                  <button
                    className="cancel-button"
                    onClick={() => act(drop, "cancel")}
                    disabled={isWriting}
                  >
                    CANCEL + REFUND
                  </button>
                )}

                <div className="receipt">
                  <ShieldCheck size={16} />
                  <span>{drop.challengeHash.slice(0, 12)}…</span>
                  <a
                    href={`https://${proofDropChain.id === 8453 ? "" : "sepolia."}basescan.org/address/${CONTRACT}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View contract"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <footer>
        <span>PROOFDROP / BASE / ERC-8021</span>
        <span>{insideMiniApp ? "MINI APP MODE" : "WEB MODE"}</span>
      </footer>
    </main>
  );
}
