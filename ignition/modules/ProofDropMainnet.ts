import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export default buildModule("ProofDropMainnet", (m) => {
  const usdc = m.getParameter("usdc", BASE_USDC);
  const proofDrop = m.contract("ProofDrop", [usdc]);

  return { proofDrop };
});
