import { NextRequest, NextResponse } from "next/server";
import { getPack } from "@/data/packs";
import { CoinflowError, cardCheckout, cardOnFile, cardOnFileAuthorized, getMerchantPayment } from "@/lib/coinflow";
import { getOrCreateUserId } from "@/lib/session";

/**
 * Card only. Apple Pay has its own routes now:
 *   - Returning customer: POST /api/checkout/apple-pay (vaulted, one-click,
 *     using the token from Get Customer's `mobiles` array)
 *   - First-time customer: the real CoinflowApplePayButton SDK component
 *     (components/ApplePaySdkButton.tsx) charges directly
 */
type CheckoutBody = {
  packId: string;
  // Sent by the client from localStorage (see lib/cardStorage.ts) when a
  // Card reference already exists.
  paymentId?: string;
  card?: {
    // Field names match CardFormTokenResponse from @coinflowlabs/react's
    // CoinflowCardForm.tokenize() (token/expMonth/expYear), plus the billing
    // details Card Checkout also requires.
    token: string;
    expMonth: string;
    expYear: string;
    email: string;
    firstName: string;
    lastName: string;
    address1: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
};

const CARD_REVERIFICATION = {
  error: "Your saved card needs to be re-verified. Please enter your card details again.",
  code: "CARD_REVERIFICATION_REQUIRED",
} as const;

export async function POST(req: NextRequest) {
  let body: CheckoutBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const pack = body.packId ? getPack(body.packId) : undefined;
  if (!pack) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 404 });
  }

  const userId = getOrCreateUserId();

  try {
    // --- Returning customer: look up the original payment to get its
    // reusable card token, then gate the charge on card-on-file-authorized
    // before attempting it — per the documented flow, not just a
    // nice-to-have pre-check. ---
    if (body.paymentId) {
      const payment = await getMerchantPayment(body.paymentId);
      const cardToken = payment.cardInfo?.token;
      if (!cardToken) {
        return NextResponse.json(CARD_REVERIFICATION, { status: 410 });
      }

      const { authorized } = await cardOnFileAuthorized({ userId, token: cardToken });
      if (!authorized) {
        return NextResponse.json(CARD_REVERIFICATION, { status: 410 });
      }

      const charge = await cardOnFile({
        userId,
        token: cardToken,
        cents: pack.priceCents,
        currency: pack.currency,
      });
      return NextResponse.json({
        status: "charged",
        flow: "card-on-file",
        paymentId: charge.paymentId,
      });
    }

    // --- First-time customer: Card Checkout charges for real and stores
    // the card as a side effect ---
    if (!body.card) {
      return NextResponse.json(
        { error: "Card details are required for a first purchase." },
        { status: 400 },
      );
    }
    const { token, expMonth, expYear, email, firstName, lastName, address1, city, state, zip, country } =
      body.card;
    if (!token || !expMonth || !expYear || !email || !firstName || !lastName || !address1 || !city || !state || !zip || !country) {
      return NextResponse.json(
        { error: "Card token, expiry, and billing details are all required." },
        { status: 400 },
      );
    }

    const charge = await cardCheckout({
      userId,
      card: {
        cardToken: token,
        expMonth,
        expYear,
        email,
        firstName,
        lastName,
        address1,
        city,
        state,
        zip,
        country,
      },
      cents: pack.priceCents,
      currency: pack.currency,
    });

    // We no longer see a raw card number (CoinflowCardForm tokenizes it
    // before it ever reaches this server), so show the expiry instead of
    // last-4 in the saved-payment-method UI.
    const display = `exp ${expMonth}/${expYear}`;

    return NextResponse.json({
      status: "charged",
      flow: "card-checkout",
      paymentId: charge.paymentId,
      // The client stores this in localStorage (lib/cardStorage.ts). Next
      // visit, the server looks up its card token via getMerchantPayment —
      // never store a token client-side.
      savedCardReference: { paymentId: charge.paymentId, display, source: "card" as const },
    });
  } catch (err) {
    if (err instanceof CoinflowError) {
      if (err.status === 410) {
        return NextResponse.json(CARD_REVERIFICATION, { status: 410 });
      }
      if (err.status === 412) {
        return NextResponse.json(
          {
            error:
              "Your card issuer requires additional verification (3D Secure), which this demo doesn't yet handle.",
            code: "THREE_DS_REQUIRED",
          },
          { status: 412 },
        );
      }
      return NextResponse.json(
        { error: err.message, code: "COINFLOW_ERROR" },
        { status: err.status },
      );
    }

    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong processing your payment." },
      { status: 500 },
    );
  }
}
