import { NextResponse } from "next/server";
import { IS_SANDBOX, findApplePayWallet, getCustomer, getSessionKey } from "@/lib/coinflow";
import { getOrCreateUserId } from "@/lib/session";

// The merchant id itself isn't secret (it's already part of every checkout
// URL your own frontend would call), so it's safe to hand to the client for
// CoinflowCardForm's `merchantId` prop.
const MERCHANT_ID = process.env.COINFLOW_MERCHANT_ID ?? "";
// CoinflowCardForm/CoinflowApplePayButton's `env` prop uses 'prod' | 'sandbox'
// (not 'production').
const CARD_FORM_ENV = IS_SANDBOX ? "sandbox" : "prod";

/**
 * Card's saved-reference status lives in the browser's localStorage
 * (lib/cardStorage.ts) — this endpoint doesn't need to know about it.
 * card-on-file-authorized is a required gate inside /api/checkout itself
 * (not a separate pre-check here) for Card.
 *
 * Venmo/PayPal/Apple Pay vaulting status genuinely lives server-side on the
 * Coinflow customer profile, so it's checked live here every time.
 *
 * `sessionKey` is included so the client can render CoinflowApplePayButton
 * directly, per Coinflow's own SDK docs — that component requires the
 * session key as a prop. Session keys are short-lived and scoped to this
 * user+merchant, unlike the raw merchant API key, which never leaves the
 * server.
 */
export async function GET() {
  const userId = getOrCreateUserId();

  let venmoVaulted = false;
  let venmoAlias: string | null = null;
  let paypalVaulted = false;
  let paypalAlias: string | null = null;
  let applePayVaulted = false;
  let applePayAlias: string | null = null;
  try {
    const customer = await getCustomer(userId);
    // Confirmed against real Get Customer responses: there's no separate
    // `vaulted` boolean field anywhere — a saved account/wallet with a
    // `token` present IS the vault-eligible signal. Never send the raw
    // token to the client; only whether one exists and a display alias.
    if (customer.venmo?.token) {
      venmoVaulted = true;
      venmoAlias = customer.venmo.alias ?? null;
    }
    if (customer.paypal?.token) {
      paypalVaulted = true;
      paypalAlias = customer.paypal.alias ?? null;
    }
    const applePay = findApplePayWallet(customer.mobiles);
    if (applePay?.token) {
      applePayVaulted = true;
      applePayAlias = applePay.alias ?? null;
    }
  } catch {
    // No customer profile yet, or the lookup failed — treat as "nothing
    // vaulted" and let the first-purchase flow run instead.
  }

  let sessionKey: string | null = null;
  try {
    sessionKey = await getSessionKey(userId);
  } catch {
    // If this fails, CoinflowApplePayButton just won't render — the rest
    // of the checkout modal (Card/Venmo/PayPal) still works fine.
  }

  return NextResponse.json({
    venmoVaulted,
    venmoAlias,
    paypalVaulted,
    paypalAlias,
    applePayVaulted,
    applePayAlias,
    sandbox: IS_SANDBOX,
    merchantId: MERCHANT_ID,
    cardFormEnv: CARD_FORM_ENV,
    sessionKey,
  });
}
