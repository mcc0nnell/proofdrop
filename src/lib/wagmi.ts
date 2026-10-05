import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { Attribution } from "ox/erc8021";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { createConfig, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";

const isMainnet = process.env.NEXT_PUBLIC_CHAIN === "base";
export const proofDropChain = isMainnet ? base : baseSepolia;

const builderCode = process.env.NEXT_PUBLIC_BUILDER_CODE?.trim();
const dataSuffix = builderCode
  ? Attribution.toDataSuffix({ codes: [builderCode] })
  : undefined;

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    farcasterMiniApp(),
    coinbaseWallet({
      appName: "ProofDrop",
      preference: "smartWalletOnly",
    }),
    injected(),
  ],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
  ...(dataSuffix ? { dataSuffix } : {}),
  ssr: true,
});
