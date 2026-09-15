"use client";

import { useEffect, useState } from "react";

const FNCLS = "fnparams-dede7cc5-15fd-4c75-a9f4-36c430ee3a99";

function loadFraudNet({
  clientMetadataId,
  sandbox,
}: {
  clientMetadataId: string;
  sandbox: boolean;
}) {
  if (document.getElementById("fnparams")) return;

  const params = document.createElement("script");
  params.type = "application/json";
  params.id = "fnparams";
  params.setAttribute("fncls", FNCLS);
  params.text = JSON.stringify({
    f: clientMetadataId,
    s: "Ripline_BuyPackModal",
    ...(sandbox ? { sandbox: true } : {}),
  });

  const script = document.createElement("script");
  script.type = "text/javascript";
  script.async = true;
  script.src = "https://c.paypal.com/da/r/fb.js";

  document.head.appendChild(params);
  document.head.appendChild(script);
}

/**
 * Generates a fresh CMID for this page view and embeds the FraudNet
 * snippet, per Coinflow's Venmo/PayPal vaulting docs. Required before
 * calling either vaulted checkout endpoint — without it, the vaulted charge
 * is rejected with a 400.
 */
export function useClientMetadataId(sandbox: boolean) {
  const [clientMetadataId, setClientMetadataId] = useState<string | null>(null);

  useEffect(() => {
    const cmid = crypto.randomUUID().replace(/-/g, "");
    setClientMetadataId(cmid);
    loadFraudNet({ clientMetadataId: cmid, sandbox });
  }, [sandbox]);

  return clientMetadataId;
}
