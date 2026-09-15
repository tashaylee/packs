import { NextResponse } from "next/server";
import { CoinflowError, getPayPalMerchantConfig } from "@/lib/coinflow";

/**
 * Public Coinflow endpoint (no session key needed), proxied through our own
 * backend so the client doesn't need to know Coinflow's base URL / sandbox
 * vs. production selection itself. Feeds the PayPal JS SDK script tag.
 */
export async function GET() {
  try {
    const config = await getPayPalMerchantConfig();
    return NextResponse.json(config);
  } catch (err) {
    if (err instanceof CoinflowError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to load PayPal configuration." }, { status: 500 });
  }
}
