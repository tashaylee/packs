import { NextRequest, NextResponse } from "next/server";
import { getPack } from "@/data/packs";
import { CoinflowError, getCustomer, vaultedVenmoCheckout } from "@/lib/coinflow";
import { getOrCreateUserId } from "@/lib/session";

/**
 * Vaulted (one-click) Venmo charge only — mirrors /api/checkout/paypal.
 * First-time / not-yet-vaulted purchases go through /api/checkout/venmo/new
 * instead.
 */
export async function POST(req: NextRequest) {
  const { packId, clientMetadataId } = await req.json();
  const pack = packId ? getPack(packId) : undefined;
  if (!pack) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 404 });
  }

  const userId = getOrCreateUserId();

  try {
    const { venmo } = await getCustomer(userId);

    if (!venmo?.token) {
      return NextResponse.json(
        {
          error:
            "This Venmo account isn't vaulted yet — complete a first purchase to vault it.",
        },
        { status: 400 },
      );
    }
    if (!clientMetadataId) {
      return NextResponse.json({ error: "Missing FraudNet clientMetadataId." }, { status: 400 });
    }

    const charge = await vaultedVenmoCheckout({
      userId,
      cents: pack.priceCents,
      currency: pack.currency,
      token: venmo.token,
      clientMetadataId,
    });
    return NextResponse.json({
      status: "charged",
      flow: "venmo-vaulted",
      paymentId: charge.paymentId,
    });
  } catch (err) {
    if (err instanceof CoinflowError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Venmo checkout failed." }, { status: 500 });
  }
}
