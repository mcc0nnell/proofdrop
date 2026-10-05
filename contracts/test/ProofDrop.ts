import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import {
  keccak256,
  parseUnits,
  toBytes,
  type Hash,
  type PublicClient,
} from "viem";

async function mine(publicClient: PublicClient, hash: Hash) {
  await publicClient.waitForTransactionReceipt({ hash });
}

describe("ProofDrop", async () => {
  async function fixture() {
    const { viem } = await network.create();
    const publicClient = await viem.getPublicClient();
    const [creator, claimant, other] = await viem.getWalletClients();

    const usdc = await viem.deployContract("MockUSDC");
    const proofDrop = await viem.deployContract("ProofDrop", [usdc.address]);

    const seed = parseUnits("10", 6);
    await mine(
      publicClient,
      await usdc.write.mint([creator.account.address, seed], {
        account: creator.account,
      }),
    );

    return { publicClient, creator, claimant, other, usdc, proofDrop };
  }

  it("escrows USDC and pays an approved proof", async () => {
    const { publicClient, creator, claimant, usdc, proofDrop } = await fixture();
    const amount = parseUnits("1", 6);
    const challengeHash = keccak256(toBytes("Ship a tiny useful Base app"));
    const proofHash = keccak256(toBytes("https://example.com/proof"));

    await mine(
      publicClient,
      await usdc.write.approve([proofDrop.address, amount], {
        account: creator.account,
      }),
    );

    await mine(
      publicClient,
      await proofDrop.write.createDrop(
        [amount, challengeHash, "ipfs://challenge"],
        { account: creator.account },
      ),
    );

    assert.equal(await usdc.read.balanceOf([proofDrop.address]), amount);

    await mine(
      publicClient,
      await proofDrop.write.claim([1n, proofHash, "ipfs://proof"], {
        account: claimant.account,
      }),
    );

    await mine(
      publicClient,
      await proofDrop.write.approveAndPay([1n], {
        account: creator.account,
      }),
    );

    assert.equal(await usdc.read.balanceOf([claimant.account.address]), amount);
    assert.equal(await usdc.read.balanceOf([proofDrop.address]), 0n);

    const drop = await proofDrop.read.drops([1n]);
    assert.equal(drop[5], 2); // Paid
  });

  it("forbids creators from claiming their own drop", async () => {
    const { publicClient, creator, usdc, proofDrop } = await fixture();
    const amount = parseUnits("1", 6);
    const challengeHash = keccak256(toBytes("No self-dealing"));
    const proofHash = keccak256(toBytes("fake"));

    await mine(
      publicClient,
      await usdc.write.approve([proofDrop.address, amount], {
        account: creator.account,
      }),
    );
    await mine(
      publicClient,
      await proofDrop.write.createDrop([amount, challengeHash, ""], {
        account: creator.account,
      }),
    );

    await assert.rejects(
      proofDrop.write.claim([1n, proofHash, ""], {
        account: creator.account,
      }),
    );
  });

  it("lets a creator reject a proof and reopen the drop", async () => {
    const { publicClient, creator, claimant, other, usdc, proofDrop } =
      await fixture();
    const amount = parseUnits("1", 6);
    const challengeHash = keccak256(toBytes("Prove it"));
    const firstProof = keccak256(toBytes("bad proof"));
    const secondProof = keccak256(toBytes("good proof"));

    await mine(
      publicClient,
      await usdc.write.approve([proofDrop.address, amount], {
        account: creator.account,
      }),
    );
    await mine(
      publicClient,
      await proofDrop.write.createDrop([amount, challengeHash, ""], {
        account: creator.account,
      }),
    );
    await mine(
      publicClient,
      await proofDrop.write.claim([1n, firstProof, ""], {
        account: claimant.account,
      }),
    );
    await mine(
      publicClient,
      await proofDrop.write.rejectClaim([1n], {
        account: creator.account,
      }),
    );
    await mine(
      publicClient,
      await proofDrop.write.claim([1n, secondProof, ""], {
        account: other.account,
      }),
    );

    const drop = await proofDrop.read.drops([1n]);
    assert.equal(drop[1].toLowerCase(), other.account.address.toLowerCase());
    assert.equal(drop[5], 1); // Claimed
    assert.equal(drop[7], secondProof);
  });

  it("returns escrow to the creator when an open drop is cancelled", async () => {
    const { publicClient, creator, usdc, proofDrop } = await fixture();
    const amount = parseUnits("1", 6);
    const challengeHash = keccak256(toBytes("Cancel me"));

    await mine(
      publicClient,
      await usdc.write.approve([proofDrop.address, amount], {
        account: creator.account,
      }),
    );
    await mine(
      publicClient,
      await proofDrop.write.createDrop([amount, challengeHash, ""], {
        account: creator.account,
      }),
    );
    await mine(
      publicClient,
      await proofDrop.write.cancel([1n], { account: creator.account }),
    );

    assert.equal(
      await usdc.read.balanceOf([creator.account.address]),
      parseUnits("10", 6),
    );
    assert.equal(await usdc.read.balanceOf([proofDrop.address]), 0n);
  });
});
