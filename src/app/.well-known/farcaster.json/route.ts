const root = process.env.NEXT_PUBLIC_URL ?? "https://proofdrop.vercel.app";

export async function GET() {
  return Response.json({
    accountAssociation: {
      header: process.env.FARCASTER_HEADER ?? "",
      payload: process.env.FARCASTER_PAYLOAD ?? "",
      signature: process.env.FARCASTER_SIGNATURE ?? "",
    },
    miniapp: {
      version: "1",
      name: "ProofDrop",
      subtitle: "Money behind proof",
      description:
        "Tiny USDC bounties with public proof and onchain payout receipts on Base.",
      iconUrl: `${root}/icon.svg`,
      homeUrl: root,
      splashImageUrl: `${root}/icon.svg`,
      splashBackgroundColor: "#10110d",
      screenshotUrls: [`${root}/hero.svg`],
      primaryCategory: "finance",
      tags: ["base", "bounties", "builders", "usdc", "proof"],
      heroImageUrl: `${root}/hero.svg`,
      tagline: "Put money behind proof.",
      ogTitle: "ProofDrop",
      ogDescription: "Tiny USDC bounties. Public proof. Onchain receipts.",
      ogImageUrl: `${root}/hero.svg`,
    },
  });
}
