"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Pack } from "@/data/packs";
import { PackCard } from "./PackCard";

// Lazy-loaded: pulls in @coinflowlabs/react (and its Solana peer dep), which
// is only needed once someone actually opens the buy modal, not on every
// storefront page load.
const BuyModal = dynamic(() => import("./BuyModal").then((m) => m.BuyModal), {
  ssr: false,
});

export function Storefront({ packs }: { packs: Pack[] }) {
  const [activePack, setActivePack] = useState<Pack | null>(null);

  return (
    <main className="min-h-screen">
      <header className="border-b border-line/60">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <span className="font-display text-xl tracking-wide">Ripline</span>
          <span className="text-xs text-white/40">Sandbox checkout</span>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-16 pb-10">
        <h1 className="font-display text-5xl sm:text-6xl leading-[1.05] max-w-xl">
          Buy a pack. Rip it right here.
        </h1>
        <p className="mt-4 max-w-md text-white/50">
          Pick a pack, pay once, and every purchase after that is a single
          tap — your card stays on file, securely.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-display text-2xl">Grab a pack</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {packs.map((pack) => (
            <PackCard key={pack.id} pack={pack} onSelect={setActivePack} />
          ))}
        </div>
      </section>

      {activePack && (
        <BuyModal pack={activePack} onClose={() => setActivePack(null)} />
      )}
    </main>
  );
}
