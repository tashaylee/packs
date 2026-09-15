import { NextRequest, NextResponse } from "next/server";
import { getPack } from "@/data/packs";
import {
  CoinflowError,
  cardOnFile,
  cardOnFileAuthorized,
  findApplePayWallet,
  getCustomer,
} from "@/lib/coinflow";
import { getOrCreateUserId } from "@/lib/session";

/**
 * Returning-customer Apple Pay charge — same lookup->authorized->charge
 * sequence as Card, but the token comes from Get Customer's
 * `mobiles` array (genus "applepay") instead of a locally-stored paymentId,
 * since Coinflow already tracks this on the customer profile.
 *
 * A first-time purchase doesn't go through this route at all — it renders
 * the real CoinflowApplePayButton (components/ApplePaySdkButton.tsx), which
 * charges directly and saves the method as a side effect.
 */
export async function POST(req: NextRequest) {
  const { packId } = await req.json();
  const pack = packId ? getPack(packId) : undefined;
  if (!pack) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 404 });
  }

  const userId = getOrCreateUserId();

  try {
    const { mobiles } = await getCustomer(userId);
    const applePay = findApplePayWallet(mobiles);
    if (!applePay?.token) {
      return NextResponse.json(
        {
          error: "No saved Apple Pay method found. Please pay with Apple Pay again.",
          code: "APPLE_PAY_REVERIFICATION_REQUIRED",
        },
        { status: 410 },
      );
    }

    const { authorized } = await cardOnFileAuthorized({ userId, token: applePay.token });
    if (!authorized) {
      return NextResponse.json(
        {
          error: "Your saved Apple Pay method needs to be re-verified. Please pay with Apple Pay again.",
          code: "APPLE_PAY_REVERIFICATION_REQUIRED",
        },
        { status: 410 },
      );
    }

    const charge = await cardOnFile({
      userId,
      token: applePay.token,
      cents: pack.priceCents,
      currency: pack.currency,
    });

    return NextResponse.json({
      status: "charged",
      flow: "apple-pay-card-on-file",
      paymentId: charge.paymentId,
    });
  } catch (err) {
    if (err instanceof CoinflowError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Apple Pay checkout failed." }, { status: 500 });
  }
}
