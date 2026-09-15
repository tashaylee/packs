import { NextRequest, NextResponse } from "next/server";
import { getPack } from "@/data/packs";
import { CoinflowError, getCustomer, vaultedPayPalCheckout } from "@/lib/coinflow";
import { getOrCreateUserId } from "@/lib/session";

/**
 * Vaulted (one-click) PayPal charge only. First-time / not-yet-vaulted
 * purchases go through the embedded PayPal SDK button instead — see
 * components/PayPalButton.tsx and /api/checkout/paypal/new.
 */
export async function POST(req: NextRequest) {
  const { packId, clientMetadataId } = await req.json();
  const pack = packId ? getPack(packId) : undefined;
  if (!pack) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 404 });
  }

  const userId = getOrCreateUserId();

  try {
    const { paypal } = await getCustomer(userId);

    if (!paypal?.token) {
      return NextResponse.json(
        {
          error:
            "This PayPal account isn't vaulted yet — complete a first purchase with the PayPal button.",
        },
        { status: 400 },
      );
    }
    if (!clientMetadataId) {
      return NextResponse.json({ error: "Missing FraudNet clientMetadataId." }, { status: 400 });
    }

    const charge = await vaultedPayPalCheckout({
      userId,
      cents: pack.priceCents,
      currency: pack.currency,
      token: paypal.token,
      clientMetadataId,
    });
    return NextResponse.json({
      status: "charged",
      flow: "paypal-vaulted",
      paymentId: charge.paymentId,
    });
  } catch (err) {
    if (err instanceof CoinflowError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "PayPal checkout failed." }, { status: 500 });
  }
}
