export type Pack = {
  id: string;
  name: string;
  subtitle: string;
  priceCents: number;
  currency: string;
  foil: string; // tailwind gradient classes for the pack art
  odds: string;
};

// Server-side catalog. The client only ever sends a packId — the API route
// looks up the real price here, so a tampered client request can't buy a
// pack for less than it costs.
export const PACKS: Pack[] = [
  {
    id: "sealed-magic-booster",
    name: "Sealed Magic: The Gathering Booster",
    subtitle: "1 booster pack inside",
    priceCents: 1000,
    currency: "USD",
    foil: "from-[#3a2a6b] via-[#1c1440] to-[#0a0a0d]",
    odds: "1 of 12 rarity tiers",
  },
  {
    id: "sealed-pokemon-booster",
    name: "Sealed Pokémon Booster",
    subtitle: "1 booster pack inside",
    priceCents: 1500,
    currency: "USD",
    foil: "from-[#ffb703] via-[#fb5607] to-[#8a0a1c]",
    odds: "1 of 10 rarity tiers",
  },
  {
    id: "sports-basic-pack",
    name: "Sports Basic Pack",
    subtitle: "Reveal your card",
    priceCents: 1500,
    currency: "USD",
    foil: "from-[#2ec4b6] via-[#116466] to-[#0a0a0d]",
    odds: "1 of 8 rarity tiers",
  },
  {
    id: "wildcard-basic-pack",
    name: "Wildcard Basic Pack",
    subtitle: "Reveal your card",
    priceCents: 1500,
    currency: "USD",
    foil: "from-[#c77dff] via-[#7b2cbf] to-[#240046]",
    odds: "1 of 8 rarity tiers",
  },
  {
    id: "baseball-starter-pack",
    name: "Baseball Starter Pack",
    subtitle: "Reveal your card",
    priceCents: 2500,
    currency: "USD",
    foil: "from-[#00b4d8] via-[#023e8a] to-[#03045e]",
    odds: "1 of 6 rarity tiers",
  },
  {
    id: "basketball-starter-pack",
    name: "Basketball Starter Pack",
    subtitle: "Reveal your card",
    priceCents: 2500,
    currency: "USD",
    foil: "from-[#ff9e00] via-[#ff6d00] to-[#5c1a00]",
    odds: "1 of 6 rarity tiers",
  },
];

export function getPack(id: string): Pack | undefined {
  return PACKS.find((p) => p.id === id);
}
