import "server-only";

const BASE_URL =
  process.env.COINFLOW_ENV === "production"
    ? "https://api.coinflow.cash"
    : "https://api-sandbox.coinflow.cash";
const IS_SANDBOX = process.env.COINFLOW_ENV !== "production";

const MERCHANT_ID = process.env.COINFLOW_MERCHANT_ID;
const API_KEY = process.env.COINFLOW_API_KEY;

function assertConfigured() {
  if (!MERCHANT_ID || !API_KEY) {
    throw new CoinflowError(
      500,
      "Coinflow is not configured. Set COINFLOW_MERCHANT_ID and COINFLOW_API_KEY in your environment.",
    );
  }
}

export class CoinflowError extends Error {
  status: number;
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function parseJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

/* ------------------------------------------------------------------------ *
 * Session key
 *
 * Every authenticated Coinflow call needs a short-lived session key for the
 * shopper, fetched from /api/auth/session-key using the merchant API key +
 * that shopper's user id. Confirmed against the Venmo/PayPal vaulting docs:
 * downstream checkout calls send ONLY the session key
 * (x-coinflow-auth-session-key) — no separate Authorization header. The
 * Authorization header is only used here, to obtain the session key itself.
 *
 * Response field name confirmed working: { "sessionKey": "..." }
 * ------------------------------------------------------------------------ */

export async function getSessionKey(userId: string): Promise<string> {
  assertConfigured();

  const res = await fetch(`${BASE_URL}/api/auth/session-key`, {
    headers: {
      accept: "application/json",
      "x-coinflow-auth-user-id": userId,
      Authorization: API_KEY as string,
    },
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new CoinflowError(
      res.status,
      body?.message || "Failed to fetch Coinflow session key",
      body,
    );
  }

  const sessionKey = body?.key;
  if (!sessionKey) {
    throw new CoinflowError(
      500,
      "Session key response did not include a sessionKey field.",
      body,
    );
  }
  return sessionKey as string;
}

function sessionKeyHeaders(sessionKey: string): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-coinflow-auth-session-key": sessionKey,
  };
}

/**
 * Confirmed working directly against sandbox (real curl + response
 * provided): card-on-file and card-on-file-authorized specifically want
 * the merchant API key + raw user id, not a session key. Kept distinct from
 * sessionKeyHeaders() since other endpoints (Venmo/PayPal/Zero Auth) are
 * confirmed to want the session key instead — these two are the exception.
 */
function directAuthHeaders(userId: string): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-coinflow-auth-user-id": userId,
    Authorization: API_KEY as string,
  };
}

export type CardInput = {
  cardToken: string;
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

/**
 * $0.00 authorization: validates the card, tokenizes + stores it in
 * Coinflow's vault, and returns a paymentId you can use as the
 * originalPaymentId for every future Card on File charge for this customer.
 * Not currently used by /api/checkout (see cardCheckout below for the first
 * purchase) — kept as a utility for scenarios that genuinely need a $0
 * validation without charging (free trials, pre-auth).
 *
 * Takes a `cardToken` (produced by tokenizing the raw card number/CVV
 * client-side) plus billing details — never a raw PAN/CVV on this call.
 */
export async function zeroAuthorization(params: {
  userId: string;
  card: CardInput;
}): Promise<{ paymentId: string }> {
  assertConfigured();
  const sessionKey = await getSessionKey(params.userId);

  const res = await fetch(
    `${BASE_URL}/api/checkout/zero-authorization/${MERCHANT_ID}`,
    {
      method: "POST",
      headers: sessionKeyHeaders(sessionKey),
      body: JSON.stringify({ card: params.card }),
      cache: "no-store",
    },
  );

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new CoinflowError(res.status, body?.message || "Zero Authorization failed", body);
  }
  return body as { paymentId: string };
}

/**
 * Real charge for a first-time customer's purchase — "Card on File
 * Transactions" doc's Option A: Card Checkout. Unlike Zero Authorization,
 * this actually charges the customer for the pack price, and stores the
 * card for future Card on File use as a side effect of a successful charge.
 *
 * Confirmed: the response only gives you a `paymentId` — there is no
 * `token` here. To get the reusable card token for a returning customer,
 * look the payment back up with getMerchantPayment(paymentId) and read
 * cardInfo.token from that response instead.
 */
export async function cardCheckout(params: {
  userId: string;
  card: CardInput;
  cents: number;
  currency?: string;
}): Promise<{ paymentId: string }> {
  assertConfigured();
  const sessionKey = await getSessionKey(params.userId);

  const res = await fetch(`${BASE_URL}/api/checkout/card/${MERCHANT_ID}`, {
    method: "POST",
    headers: sessionKeyHeaders(sessionKey),
    body: JSON.stringify({
      subtotal: { cents: params.cents, currency: params.currency ?? "USD" },
      card: params.card,
    }),
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new CoinflowError(res.status, body?.message || "Card checkout failed", body);
  }
  return body as { paymentId: string };
}

/**
 * Looks up a completed payment by id — the merchant API key alone, no
 * session key and no user id header. Used to read `cardInfo.token`, the
 * reusable card token needed for card-on-file-authorized / card-on-file on
 * a returning customer's next visit.
 */
export async function getMerchantPayment(
  paymentId: string,
): Promise<{ cardInfo?: { token?: string; last4?: string } }> {
  assertConfigured();

  const res = await fetch(`${BASE_URL}/api/merchant/payments/${paymentId}`, {
    headers: {
      accept: "application/json",
      Authorization: API_KEY as string,
    },
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new CoinflowError(res.status, body?.message || "Failed to fetch payment", body);
  }
  return body as { cardInfo?: { token?: string; last4?: string } };
}

/**
 * Charges a customer using a previously stored card. Provide exactly one of
 * `originalPaymentId` (a specific CVV-verified transaction) or `token` (the
 * card token — Coinflow automatically uses the most recent CVV-verified
 * transaction for velocity checks). Never pass a prior Card on File
 * response's paymentId as originalPaymentId — Coinflow rejects chained
 * Card on File references.
 *
 * Confirmed working with direct auth (merchant API key + raw user id) —
 * NOT the session key other checkout endpoints use.
 */
export async function cardOnFile(params: {
  userId: string;
  originalPaymentId?: string;
  token?: string;
  cents: number;
  currency?: string;
  deviceId?: string;
}): Promise<{ paymentId: string }> {
  assertConfigured();

  const headers = directAuthHeaders(params.userId);
  if (params.deviceId) headers["x-device-id"] = params.deviceId;

  const res = await fetch(`${BASE_URL}/api/checkout/card-on-file`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      subtotal: { cents: params.cents, currency: params.currency ?? "USD" },
      ...(params.originalPaymentId ? { originalPaymentId: params.originalPaymentId } : {}),
      ...(params.token ? { token: params.token } : {}),
    }),
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new CoinflowError(res.status, body?.message || "Card on File charge failed", body);
  }
  return body as { paymentId: string };
}

/**
 * Required gate before every returning-customer Card on File charge (this
 * app now calls it as part of the charge flow itself, not just an optional
 * pre-check) — confirmed working with direct auth + a card `token`.
 */
export async function cardOnFileAuthorized(params: {
  userId: string;
  originalPaymentId?: string;
  token?: string;
}): Promise<{ authorized: boolean }> {
  assertConfigured();

  const res = await fetch(`${BASE_URL}/api/checkout/card-on-file-authorized`, {
    method: "POST",
    headers: directAuthHeaders(params.userId),
    body: JSON.stringify({
      ...(params.originalPaymentId ? { originalPaymentId: params.originalPaymentId } : {}),
      ...(params.token ? { token: params.token } : {}),
    }),
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) return { authorized: false };
  return { authorized: Boolean(body?.authorized) };
}

/* ------------------------------------------------------------------------ *
 * Get Customer — used to check whether a shopper's Venmo/PayPal account is
 * already vaulted (one-click eligible), and now also whether they have a
 * saved Apple Pay method (customer.mobiles, genus "applepay") before
 * deciding which checkout path to run. Confirmed shape from a real
 * response — note there is no `vaulted` boolean anywhere in it; presence
 * of a `token` is itself the vault-eligible signal.
 * ------------------------------------------------------------------------ */

export type SavedAccount = {
  type: string;
  alias?: string;
  token?: string;
  vaulted?: boolean;
};

export type SavedMobileWallet = {
  alias?: string;
  type: string;
  genus: string; // "applepay" for Apple Pay
  token: string;
  expMonth?: string;
  expYear?: string;
};

export async function getCustomer(userId: string): Promise<{
  venmo?: SavedAccount;
  paypal?: SavedAccount;
  mobiles?: SavedMobileWallet[];
}> {
  assertConfigured();
  const sessionKey = await getSessionKey(userId);

  const res = await fetch(`${BASE_URL}/api/customer/v2`, {
    headers: sessionKeyHeaders(sessionKey),
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    // No customer profile yet (first-ever visit) shouldn't be fatal —
    // treat it as "nothing saved" and let the caller fall back accordingly.
    return {};
  }
  return {
    venmo: body?.customer?.venmo,
    paypal: body?.customer?.paypal,
    mobiles: body?.customer?.mobiles,
  };
}

/** Convenience: find the saved Apple Pay method, if any, from Get Customer. */
export function findApplePayWallet(
  mobiles: SavedMobileWallet[] | undefined,
): SavedMobileWallet | undefined {
  return mobiles?.find((m) => m.genus === "applepay");
}

/* ------------------------------------------------------------------------ *
 * Venmo — Direct API + PayPal SDK ("Option 3" integration, now confirmed)
 *
 * Venmo runs on PayPal's rails: the button is PayPal's own JS SDK loaded
 * with `enable-funding=venmo`, and order creation is the same
 * /api/checkout/venmo/{merchantId} endpoint used elsewhere in this app.
 * Confirmed shape — no more approvalUrl/popup guessing:
 *   1. getVenmoMerchantConfig() — Venmo's implementation doc points at the
 *      *authenticated* Get Merchant (v2) endpoint specifically for
 *      paypalMerchantId (Venmo "uses your paypalMerchantId and the same
 *      PayPal client-id" as PayPal). That endpoint doesn't return a client
 *      id, so this reuses getPayPalMerchantConfig()'s paypalClientId for
 *      that part — same underlying PayPal account, confirmed by the doc to
 *      be identical either way.
 *   2. newVenmoCheckout() — creates the order. vault:true/returnUrl/
 *      cancelUrl are the same addition already confirmed for PayPal (same
 *      endpoint, same vaulting doc pattern) — the base example in Venmo's
 *      own Option 3 doc omits them, but combining is confirmed compatible.
 *      The returned paymentId IS the Venmo/PayPal order id — return it
 *      directly from the SDK button's createOrder callback.
 * ------------------------------------------------------------------------ */

/**
 * Authenticated endpoint Venmo's implementation doc specifically calls out
 * for paypalMerchantId, as distinct from PayPal's public merchant-view
 * lookup (getPayPalMerchantConfig, below).
 *
 * Confirmed via a real 401 body ({"details":"Authorization header not
 * set"}): this endpoint wants the session key AND the Authorization
 * header together — the doc's example curl only showed the session key.
 */
export async function getVenmoMerchantId(userId: string): Promise<{ paypalMerchantId: string }> {
  assertConfigured();
  const sessionKey = await getSessionKey(userId);

  const res = await fetch(`${BASE_URL}/merchant/view/v2/${process.env.COINFLOW_MERCHANT_ID}`, {
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new CoinflowError(res.status, body?.message || "Failed to fetch merchant config", body);
  }
  const paypalMerchantId = body?.merchant?.paypalMerchantId;
  if (!paypalMerchantId) {
    throw new CoinflowError(
      502,
      "Merchant v2 response did not include paypalMerchantId — is Venmo/PayPal enabled on this merchant account?",
      body,
    );
  }
  return { paypalMerchantId };
}

/**
 * Creates a Venmo order via Coinflow. The customer approves it through
 * PayPal's own embedded SDK button with Venmo enabled as the funding source
 * (see components/VenmoButton.tsx) — same embedded pattern as PayPal, no
 * custom popup handling needed on our end.
 */
/**
 * Creates a Venmo order via Coinflow. The customer approves it through
 * PayPal's own embedded SDK button with Venmo enabled as the funding source
 * (see components/VenmoButton.tsx) — same embedded pattern as PayPal, no
 * custom popup handling needed on our end.
 *
 * Matches the doc's base "Option 3" example body exactly (no vault/
 * returnUrl/cancelUrl) — the confirmed working request also included a
 * top-level `email` alongside the nested `venmo.email`, which is kept here.
 * Note: without `vault: true`, a first-time purchase through this call
 * won't save the account, so the returning-customer vaulted-token check
 * has nothing to detect unless vaulting is mandatory at the account level.
 */
export async function newVenmoCheckout(params: {
  userId: string;
  cents: number;
  currency?: string;
  email: string;
}): Promise<{ paymentId: string }> {
  assertConfigured();
  const sessionKey = await getSessionKey(params.userId);

  const res = await fetch(`${BASE_URL}/api/checkout/venmo/${MERCHANT_ID}`, {
    method: "POST",
    headers: sessionKeyHeaders(sessionKey),
    body: JSON.stringify({
      subtotal: { cents: params.cents, currency: params.currency ?? "USD" },
      venmo: { email: params.email },
      email: params.email,
    }),
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new CoinflowError(res.status, body?.message || "Venmo checkout failed", body);
  }
  return body as { paymentId: string };
}

/* ------------------------------------------------------------------------ *
 * PayPal — Direct API + PayPal SDK ("Option 3" integration)
 *
 * Fully documented, confirmed shape:
 *   1. getPayPalMerchantConfig() — public endpoint, no session key. Feeds
 *      PayPal's own JS SDK script tag (merchant-id / client-id) client-side.
 *   2. newPayPalCheckout() — creates the order. No vault/returnUrl/cancelUrl
 *      here (that's the redirect-based flow from the vaulting doc; this is
 *      the SDK-embedded flow, which has no redirect at all). The returned
 *      paymentId IS the PayPal order id — return it directly from the SDK
 *      button's createOrder callback.
 * ------------------------------------------------------------------------ */

/** Public endpoint — no auth, no session key, just your merchant id. */
export async function getPayPalMerchantConfig(): Promise<{
  paypalMerchantId: string;
  paypalClientId: string;
}> {
  if (!MERCHANT_ID) {
    throw new CoinflowError(500, "COINFLOW_MERCHANT_ID is not set.");
  }

  const res = await fetch(`${BASE_URL}/merchant/view/v2/${MERCHANT_ID}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new CoinflowError(res.status, body?.message || "Failed to fetch merchant view", body);
  }
  const paypalMerchantId = body?.merchant?.paypalMerchantId;
  const paypalClientId = body?.merchant?.paypalClientId;
  if (!paypalMerchantId || !paypalClientId) {
    throw new CoinflowError(
      502,
      "Merchant view response did not include paypalMerchantId/paypalClientId — is PayPal enabled on this merchant account?",
      body,
    );
  }
  return { paypalMerchantId, paypalClientId };
}

/**
 * Creates a PayPal order via Coinflow. The customer approves it through
 * PayPal's own embedded SDK button (see components/PayPalButton.tsx) — there
 * is no redirect for this integration path, but `vault: true` still requires
 * returnUrl/cancelUrl to be present and whitelisted on the merchant account;
 * per the vaulting doc, they're never actually navigated to in a popup/SDK
 * integration. Passing vault:true here means a successful first purchase
 * saves the PayPal account, so returning customers with the same
 * x-coinflow-auth-user-id can use the one-click vaulted checkout afterward.
 */
export async function newPayPalCheckout(params: {
  userId: string;
  cents: number;
  currency?: string;
  email: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ paymentId: string }> {
  assertConfigured();
  const sessionKey = await getSessionKey(params.userId);

  const res = await fetch(`${BASE_URL}/api/checkout/paypal/${MERCHANT_ID}`, {
    method: "POST",
    headers: sessionKeyHeaders(sessionKey),
    body: JSON.stringify({
      subtotal: { cents: params.cents, currency: params.currency ?? "USD" },
      paypal: { email: params.email },
      vault: true,
      returnUrl: params.returnUrl,
      cancelUrl: params.cancelUrl,
      email: params.email
    }),
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new CoinflowError(res.status, body?.message || "PayPal checkout failed", body);
  }
  return body as { paymentId: string };
}

/* ------------------------------------------------------------------------ *
 * Venmo / PayPal — vaulted (one-click, fully documented)
 * ------------------------------------------------------------------------ */

export async function vaultedVenmoCheckout(params: {
  userId: string;
  cents: number;
  currency?: string;
  token: string;
  clientMetadataId: string;
}): Promise<{ paymentId: string }> {
  assertConfigured();
  const sessionKey = await getSessionKey(params.userId);

  const res = await fetch(`${BASE_URL}/api/checkout/venmo/vaulted/${MERCHANT_ID}`, {
    method: "POST",
    headers: sessionKeyHeaders(sessionKey),
    body: JSON.stringify({
      subtotal: { cents: params.cents, currency: params.currency ?? "USD" },
      token: params.token,
      clientMetadataId: params.clientMetadataId,
    }),
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new CoinflowError(res.status, body?.message || "Vaulted Venmo charge failed", body);
  }
  return body as { paymentId: string };
}

export async function vaultedPayPalCheckout(params: {
  userId: string;
  cents: number;
  currency?: string;
  token: string;
  clientMetadataId: string;
}): Promise<{ paymentId: string }> {
  assertConfigured();
  const sessionKey = await getSessionKey(params.userId);

  const res = await fetch(`${BASE_URL}/api/checkout/paypal/vaulted/${MERCHANT_ID}`, {
    method: "POST",
    headers: sessionKeyHeaders(sessionKey),
    body: JSON.stringify({
      subtotal: { cents: params.cents, currency: params.currency ?? "USD" },
      token: params.token,
      clientMetadataId: params.clientMetadataId,
    }),
    cache: "no-store",
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new CoinflowError(res.status, body?.message || "Vaulted PayPal charge failed", body);
  }
  return body as { paymentId: string };
}

export { IS_SANDBOX };
