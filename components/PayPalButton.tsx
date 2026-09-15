"use client";

import { useEffect, useRef } from "react";
import { Pack } from "@/data/packs";

// Window.paypal is declared once in types/paypal.d.ts (shared with
// VenmoButton, which loads the same PayPal JS SDK global).

// Required by Coinflow: identifies the integration as processed through
// Coinflow so PayPal attributes the transaction correctly.
const PARTNER_ATTRIBUTION_ID = "CoinflowLabsLimited_PSP";

export function PayPalButton({
  pack,
  email,
  onApprove,
  onError,
}: {
  pack: Pack;
  email: string;
  onApprove: (paymentId: string) => void;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  // createOrder needs the *current* email at click time, but the button
  // itself should only be set up once — not torn down and rebuilt on every
  // keystroke, which is what depending on `email` directly in the effect
  // below used to do.
  const emailRef = useRef(email);
  useEffect(() => {
    emailRef.current = email;
  }, [email]);

  useEffect(() => {
    let cancelled = false;
    renderedRef.current = false;

    async function setup() {
      const configRes = await fetch("/api/paypal/merchant-view");
      const config = await configRes.json();
      if (cancelled) return;
      if (!configRes.ok || !config.paypalClientId || !config.paypalMerchantId) {
        onError(config.error || "PayPal isn't available for this merchant yet.");
        return;
      }

      try {
        await loadPayPalScript(config.paypalClientId, config.paypalMerchantId, pack.currency);
      } catch {
        if (!cancelled) onError("Couldn't load PayPal. Please try again.");
        return;
      }
      if (cancelled || !window.paypal || !containerRef.current || renderedRef.current) return;
      renderedRef.current = true;

      window.paypal
        .Buttons({
          style: { layout: "horizontal", shape: "rect", label: "paypal", height: 48 },
          createOrder: async () => {
            const res = await fetch("/api/checkout/paypal/new", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ packId: pack.id, email: emailRef.current }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Could not start PayPal checkout");
            // Coinflow's paymentId IS the PayPal order id — return it directly.
            return data.paymentId as string;
          },
          onApprove: async (data) => {
            onApprove(data.orderID);
          },
          onError: (err) => {
            onError(err instanceof Error ? err.message : "PayPal payment failed.");
          },
        })
        .render(containerRef.current);
    }

    setup();
    return () => {
      cancelled = true;
    };
    // Deliberately NOT depending on `email` — see emailRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.id]);

  return <div ref={containerRef} />;
}

function loadPayPalScript(
  clientId: string,
  merchantId: string,
  currency: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById("paypal-sdk") as HTMLScriptElement | null;
    const key = `${clientId}:${currency}`;

    if (existing && existing.dataset.key === key) {
      if (window.paypal) return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("PayPal SDK failed to load")));
      return;
    }
    existing?.remove();

    const script = document.createElement("script");
    script.id = "paypal-sdk";
    script.dataset.key = key;
    script.src =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
      `&merchant-id=${encodeURIComponent(merchantId)}` +
      `&currency=${encodeURIComponent(currency)}` +
      `&intent=authorize&components=buttons&disable-funding=paylater`;
    script.setAttribute("data-partner-attribution-id", PARTNER_ATTRIBUTION_ID);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("PayPal SDK failed to load"));
    document.body.appendChild(script);
  });
}
