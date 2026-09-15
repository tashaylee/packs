"use client";

import { useMemo, useState } from "react";
import { Pack } from "@/data/packs";

const RARITIES = [
  { label: "Common", weight: 50, ring: "from-white/40 to-white/10" },
  { label: "Rare", weight: 30, ring: "from-arc to-arc/20" },
  { label: "Ultra Rare", weight: 15, ring: "from-volt to-volt/20" },
  { label: "Secret Rare", weight: 5, ring: "from-ember to-ember/20" },
];

function pickRarity() {
  const total = RARITIES.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of RARITIES) {
    if (roll < r.weight) return r;
    roll -= r.weight;
  }
  return RARITIES[0];
}

export function RevealCard({
  pack,
  onClose,
}: {
  pack: Pack;
  onClose: () => void;
}) {
  const [ripped, setRipped] = useState(false);
  const rarity = useMemo(() => pickRarity(), []);

  return (
    <div className="p-6 flex flex-col items-center text-center">
      <p className="text-sm text-white/50">{pack.name}</p>
      <h2 className="font-display text-2xl mt-1">
        {ripped ? "You pulled…" : "Payment confirmed"}
      </h2>

      <button
        onClick={() => setRipped(true)}
        className={`relative mt-6 h-56 w-40 rounded-xl border-2 border-white/70 bg-gradient-to-br ${pack.foil} shadow-glow transition-transform duration-500 ${
          ripped ? "scale-105" : "hover:scale-[1.02]"
        }`}
      >
        {!ripped ? (
          <span className="absolute inset-0 flex items-center justify-center font-display text-sm uppercase tracking-wide text-white/85">
            Tap to rip
          </span>
        ) : (
          <span
            className={`absolute inset-2 rounded-lg bg-ink/70 border border-white/20 flex flex-col items-center justify-center bg-gradient-to-br ${rarity.ring}`}
          >
            <span className="font-display text-lg text-ink drop-shadow-sm bg-white/90 px-2 py-0.5 rounded">
              {rarity.label}
            </span>
          </span>
        )}
      </button>

      {ripped && (
        <p className="mt-4 text-sm text-white/50">
          Nice pull! It's been added to your collection.
        </p>
      )}

      <button
        onClick={onClose}
        className="mt-8 w-full rounded-xl border border-line py-3 text-sm font-semibold hover:bg-white/5 transition-colors"
      >
        Done
      </button>
    </div>
  );
}
