import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("ProofDropSepolia", (m) => {
  const mockUsdc = m.contract("MockUSDC");
  const proofDrop = m.contract("ProofDrop", [mockUsdc]);

  return { mockUsdc, proofDrop };
});
