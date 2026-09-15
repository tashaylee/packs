"use client";

import { useEffect, useRef } from "react";
import { Pack } from "@/data/packs";

// Window.paypal is declared once in types/paypal.d.ts (shared with
// PayPalButton, which loads the same PayPal JS SDK global).

// Required by Coinflow: identifies the integration as processed through
// Coinflow so PayPal attributes the transaction correctly.
const PARTNER_ATTRIBUTION_ID = "CoinflowLabsLimited_PSP";

export function VenmoButton({
  pack,
  email,
  sandbox,
  onApprove,
  onError,
  onIneligible,
}: {
  pack: Pack;
  email: string;
  sandbox: boolean;
  onApprove: (paymentId: string) => void;
  onError: (message: string) => void;
  onIneligible?: () => void;
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
      const configRes = await fetch("/api/venmo/merchant-view");
      const config = await configRes.json();
      if (cancelled) return;
      if (!configRes.ok || !config.paypalClientId || !config.paypalMerchantId) {
        onError(config.error || "Venmo isn't available for this merchant yet.");
        return;
      }

      try {
        await loadVenmoScript(config.paypalClientId, config.paypalMerchantId, pack.currency, sandbox);
      } catch {
        if (!cancelled) onError("Couldn't load Venmo. Please try again.");
        return;
      }
      if (cancelled || !window.paypal || !containerRef.current || renderedRef.current) return;

      const button = window.paypal.Buttons({
        fundingSource: window.paypal.FUNDING.VENMO,
        style: { layout: "horizontal", shape: "rect", height: 48, tagline: false },
        createOrder: async () => {
          const res = await fetch("/api/checkout/venmo/new", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ packId: pack.id, email: emailRef.current }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Could not start Venmo checkout");
          // Coinflow's paymentId IS the Venmo order id — return it directly.
          return data.paymentId as string;
        },
        onApprove: async (data) => {
          onApprove(data.orderID);
        },
        onError: (err) => {
          onError(err instanceof Error ? err.message : "Venmo payment failed.");
        },
      });

      // Venmo is US-only; skip rendering entirely when it's not eligible
      // for this customer/browser rather than forcing the button to show.
      if (!button.isEligible()) {
        onIneligible?.();
        return;
      }

      renderedRef.current = true;
      button.render(containerRef.current);
    }

    setup();
    return () => {
      cancelled = true;
    };
    // Deliberately NOT depending on `email` — see emailRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.id, sandbox]);

  return <div ref={containerRef} />;
}

function loadVenmoScript(
  clientId: string,
  merchantId: string,
  currency: string,
  sandbox: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const key = `${clientId}:${currency}:venmo`;
    const existing = document.getElementById("venmo-sdk") as HTMLScriptElement | null;

    if (existing && existing.dataset.key === key) {
      if (window.paypal) return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Venmo SDK failed to load")));
      return;
    }
    existing?.remove();

    const script = document.createElement("script");
    script.id = "venmo-sdk";
    script.dataset.key = key;
    script.src =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
      `&merchant-id=${encodeURIComponent(merchantId)}` +
      `&currency=${encodeURIComponent(currency)}` +
      `&intent=authorize&components=buttons&enable-funding=venmo&disable-funding=paylater` +
      // Venmo only renders for US customers; sandbox testing needs this to
      // make the funding source eligible outside a real US context.
      (sandbox ? "&buyer-country=US" : "");
    script.setAttribute("data-partner-attribution-id", PARTNER_ATTRIBUTION_ID);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Venmo SDK failed to load"));
    document.body.appendChild(script);
  });
}
