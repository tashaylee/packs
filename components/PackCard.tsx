"use client";

import { Pack } from "@/data/packs";

export function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function PackCard({
  pack,
  onSelect,
}: {
  pack: Pack;
  onSelect: (pack: Pack) => void;
}) {
  return (
    <button
      onClick={() => onSelect(pack)}
      className="group text-left w-full rounded-2xl border border-line bg-panel/60 overflow-hidden shadow-glow transition-transform duration-200 hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ember"
    >
      <div
        className={`relative aspect-[4/3] bg-gradient-to-br ${pack.foil} overflow-hidden`}
      >
        <div className="absolute inset-0 opacity-40 mix-blend-overlay">
          <div className="absolute -left-1/2 top-0 h-full w-1/3 bg-white/60 blur-2xl foil-shimmer" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-20 w-14 rounded-md border-2 border-white/70 bg-black/20 backdrop-blur-sm flex items-center justify-center">
            <span className="font-display text-[10px] uppercase tracking-wide text-white/80">
              Sealed
            </span>
          </div>
        </div>
        <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-[11px] font-medium text-white/80">
          <span>{pack.odds}</span>
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-display text-lg leading-snug text-white group-hover:text-ember transition-colors">
          {pack.name}
        </h3>
        <p className="text-sm text-white/50 mt-0.5">{pack.subtitle}</p>
        <p className="mt-3 font-display text-xl">
          {formatPrice(pack.priceCents, pack.currency)}
        </p>
      </div>
    </button>
  );
}
