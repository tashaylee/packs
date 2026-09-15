import { NextResponse } from "next/server";
import { CoinflowError, getPayPalMerchantConfig, getVenmoMerchantId } from "@/lib/coinflow";
import { getOrCreateUserId } from "@/lib/session";

/**
 * paypalMerchantId comes from the authenticated endpoint Venmo's
 * implementation doc specifically names; paypalClientId is reused from the
 * public PayPal merchant-view lookup, since the doc confirms Venmo uses
 * "the same PayPal client-id" as PayPal on this account.
 *
 * Run sequentially (not Promise.all) so a failure in one is unambiguous —
 * this was previously masking which of the two calls was actually 401ing.
 */
export async function GET() {
  const userId = getOrCreateUserId();

  let paypalMerchantId: string;
  try {
    ({ paypalMerchantId } = await getVenmoMerchantId(userId));
  } catch (err) {
    console.error("[venmo/merchant-view] getVenmoMerchantId failed:", err);
    if (err instanceof CoinflowError) {
      return NextResponse.json(
        { error: err.message, step: "getVenmoMerchantId", coinflowStatus: err.status, coinflowBody: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Failed to load Venmo merchant id.", step: "getVenmoMerchantId" }, { status: 500 });
  }

  let paypalClientId: string;
  try {
    ({ paypalClientId } = await getPayPalMerchantConfig());
  } catch (err) {
    console.error("[venmo/merchant-view] getPayPalMerchantConfig failed:", err);
    if (err instanceof CoinflowError) {
      return NextResponse.json(
        { error: err.message, step: "getPayPalMerchantConfig", coinflowStatus: err.status, coinflowBody: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Failed to load PayPal client id.", step: "getPayPalMerchantConfig" }, { status: 500 });
  }

  return NextResponse.json({ paypalMerchantId, paypalClientId });
}
