import { NextRequest, NextResponse } from "next/server";
import { getPack } from "@/data/packs";
import { CoinflowError, newVenmoCheckout } from "@/lib/coinflow";
import { getOrCreateUserId } from "@/lib/session";

/**
 * Creates a Venmo order for the embedded PayPal-SDK-with-Venmo-funding
 * button's `createOrder` callback. The returned paymentId IS the Venmo
 * order id — the client returns it directly to the SDK, which then drives
 * its own approval popup. No custom redirect handling needed on our end.
 */
export async function POST(req: NextRequest) {
  const { packId, email } = await req.json();
  const pack = packId ? getPack(packId) : undefined;
  if (!pack) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 404 });
  }
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const userId = getOrCreateUserId();
  try {
    const result = await newVenmoCheckout({
      userId,
      cents: pack.priceCents,
      currency: pack.currency,
      email,
    });
    return NextResponse.json({ paymentId: result.paymentId });
  } catch (err) {
    if (err instanceof CoinflowError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Venmo checkout failed." }, { status: 500 });
  }
}
