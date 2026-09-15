"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function CancelContent() {
  const params = useSearchParams();

  useEffect(() => {
    const method = params.get("method");
    if (window.opener) {
      window.opener.postMessage(
        { source: "coinflow-checkout", status: "cancelled", method },
        window.location.origin,
      );
      window.close();
    }
  }, [params]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-ink text-white">
      <p className="text-sm text-white/60">Payment cancelled — you can close this window.</p>
    </main>
  );
}

export default function CancelPage() {
  return (
    <Suspense fallback={null}>
      <CancelContent />
    </Suspense>
  );
}
