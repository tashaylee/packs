"use client";

import { useState } from "react";
import { CoinflowApplePayButton, Currency } from "@coinflowlabs/react";
import { Pack } from "@/data/packs";

export function ApplePaySdkButton({
  pack,
  merchantId,
  env,
  sessionKey,
  onSuccess,
  onError,
}: {
  pack: Pack;
  merchantId: string;
  env: "sandbox" | "prod";
  sessionKey: string;
  onSuccess: (paymentId: string) => void;
  onError: (message: string) => void;
}) {
  // The button renders inside an iframe that can change size (e.g. while
  // the Apple Pay sheet is active) — handleHeightChange keeps the
  // container sized to match instead of clipping or leaving dead space.
  const [height, setHeight] = useState("48px");

  return (
    <div style={{ height }}>
      <CoinflowApplePayButton
        env={env}
        sessionKey={sessionKey}
        merchantId={merchantId}
        handleHeightChange={(h) => setHeight(h)}
        subtotal={{ cents: pack.priceCents, currency: pack.currency as Currency }}
        color="black"
        onSuccess={(args) => {
          const paymentId = typeof args === "string" ? args : args.paymentId;
          onSuccess(paymentId);
        }}
        onError={onError}
      />
    </div>
  );
}
