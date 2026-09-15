import { NextRequest, NextResponse } from "next/server";
import { getPack } from "@/data/packs";
import { CoinflowError, newPayPalCheckout } from "@/lib/coinflow";
import { getOrCreateUserId } from "@/lib/session";

/**
 * Creates a PayPal order for the embedded PayPal JS SDK button's
 * `createOrder` callback. The returned paymentId IS the PayPal order id —
 * the client returns it directly to the SDK, which then drives its own
 * approval overlay. No redirect, no popup.
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
    const origin = req.nextUrl.origin;
    const result = await newPayPalCheckout({
      userId,
      cents: pack.priceCents,
      currency: pack.currency,
      email,
      returnUrl: `${origin}/checkout/return?method=paypal`,
      cancelUrl: `${origin}/checkout/cancel?method=paypal`,
    });
    return NextResponse.json({ paymentId: result.paymentId });
  } catch (err) {
    if (err instanceof CoinflowError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "PayPal checkout failed." }, { status: 500 });
  }
}
