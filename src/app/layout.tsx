import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

const root = process.env.NEXT_PUBLIC_URL ?? "https://proofdrop.vercel.app";

export const metadata: Metadata = {
  title: "ProofDrop — money behind proof",
  description:
    "Tiny USDC bounties with public proof and onchain payout receipts on Base.",
  metadataBase: new URL(root),
  openGraph: {
    title: "ProofDrop",
    description: "Put money behind proof.",
    images: ["/hero.svg"],
  },
  other: {
    "fc:miniapp": JSON.stringify({
      version: "next",
      imageUrl: `${root}/hero.svg`,
      button: {
        title: "Open ProofDrop",
        action: {
          type: "launch_miniapp",
          name: "ProofDrop",
          url: root,
          splashImageUrl: `${root}/icon.svg`,
          splashBackgroundColor: "#10110d",
        },
      },
    }),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
