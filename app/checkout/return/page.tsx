"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * The popup approval flow redirects here after the customer approves in
 * Venmo/PayPal. UNVERIFIED: I don't know exactly what query params Coinflow
 * appends to returnUrl — this reads `paymentId` defensively and just relays
 * whatever it finds back to the opener. Adjust the param name here once you
 * see a real redirect.
 */
function ReturnContent() {
  const params = useSearchParams();

  useEffect(() => {
    const method = params.get("method");
    const paymentId = params.get("paymentId");

    if (window.opener) {
      window.opener.postMessage(
        { source: "coinflow-checkout", status: "approved", method, paymentId },
        window.location.origin,
      );
      window.close();
    }
  }, [params]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-ink text-white">
      <p className="text-sm text-white/60">Payment approved — you can close this window.</p>
    </main>
  );
}

export default function ReturnPage() {
  return (
    <Suspense fallback={null}>
      <ReturnContent />
    </Suspense>
  );
}
