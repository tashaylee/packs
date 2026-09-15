# Ripline — pack ripping storefront

A Next.js 14 app: a pack storefront (`/`) where clicking a pack opens a
"Buy a pack" modal. First purchase runs a **Zero Authorization** ($0, stores
the card); every purchase after that — for that same browser — runs a
**Card on File** charge with no card re-entry.

## How the payment flow works

1. Shopper clicks a pack → `Buy now` in the modal.
2. `POST /api/checkout` (server-side, `lib/coinflow.ts`):
   - **No saved card yet** → calls `zero-authorization` with the entered card,
     stores the returned `paymentId` in an **httpOnly** cookie
     (`cf_original_payment_id`), then immediately calls `card-on-file` with
     that `paymentId` as `originalPaymentId` to actually charge the pack
     price.
   - **Saved card exists** → skips straight to `card-on-file` using the
     stored `originalPaymentId`. No card form is shown.
3. If Coinflow returns `410` (the reference expired or hit its velocity/
   amount limit), the cookie is cleared and the modal falls back to fresh
   card entry.
4. On success, the modal shows a rip/reveal animation.

The customer's card is identified by a `cf_user_id` cookie (an anonymous id
sandbox — swap for your real auth user id in `lib/session.ts` once you have
accounts). Pricing is always looked up server-side from `data/packs.ts` — the
client only ever sends a `packId`, so a tampered request can't change the
charge amount.

## Card entry — CoinflowCardForm (real tokenization)

Card details are collected with Coinflow's own `CoinflowCardForm` component
(`@coinflowlabs/react`), which renders a PCI-compliant hosted iframe — the raw
card number and CVV never touch this app's server. `BuyModal.tsx` holds a
`CardFormRef` and calls `.tokenize()` on submit, which resolves to
`{ token, expMonth, expYear }`. That token, expiry, and the billing fields
collected alongside it (email, first/last name, address, city, country) are
what get sent to `/api/checkout`, which forwards them to Zero Authorization
as `{ cardToken, expMonth, expYear, email, firstName, lastName, address1,
city, country }`.

Because there's no raw card number available anymore, the saved-card display
shows the expiry (`exp 09/27`) instead of last-4 digits.

Two setup notes:
- `merchantId` and the form's `env` ('sandbox' | 'prod') are read from
  `/api/me` rather than hardcoded, since `COINFLOW_MERCHANT_ID` is otherwise
  a server-only env var — see `MERCHANT_ID`/`CARD_FORM_ENV` in
  `app/api/me/route.ts`. The merchant id itself isn't sensitive.
- `@coinflowlabs/react` pulls in `@solana/web3.js` as a hard dependency (it
  supports crypto payments too) even though this app only uses card
  checkout. Both are ~200kB, so `BuyModal` is lazy-loaded with
  `next/dynamic` in `components/Storefront.tsx` — it's only fetched once
  someone actually opens the buy modal, not on every storefront page load.

## Card — corrected: lookup → authorized → charge (with real confirmed auth)

Two real bugs fixed here, both confirmed by actual working curl + response
you provided:

1. **Card Checkout's response has no `token`.** The previous version
   assumed one existed alongside `paymentId` — it doesn't. The reusable
   card token only comes from looking the payment back up:
   `getMerchantPayment(paymentId)` → `cardInfo.token`. `lib/cardStorage.ts`
   is back to storing just `paymentId` — simpler, and correct.
2. **`card-on-file` and `card-on-file-authorized` want direct auth, not a
   session key.** Every other Coinflow call in this app (Zero Auth, Card
   Checkout, Venmo, PayPal) is confirmed to want
   `x-coinflow-auth-session-key`; these two specifically want
   `x-coinflow-auth-user-id` + `Authorization: <API key>` directly. This is
   very likely what caused the original "successful call, then Authentication
   Failed" symptom — the follow-up call was using the wrong auth mechanism
   for that specific endpoint. `directAuthHeaders()` in `lib/coinflow.ts` is
   now separate from `sessionKeyHeaders()` for exactly this reason.

The full returning-customer flow in `/api/checkout`, matching what you
specified:

1. Client sends the `paymentId` from localStorage.
2. Server calls `getMerchantPayment(paymentId)` → reads `cardInfo.token`.
3. Server calls `cardOnFileAuthorized({ token })`.
4. If `authorized: true` → `cardOnFile({ token, cents })` charges them.
5. If `authorized: false` (or no token found) → returns
   `CARD_REVERIFICATION_REQUIRED`; the client clears localStorage and shows
   the card form again, under the same `cf_user_id`/customer.

Apple Pay's returning-customer path is unchanged and doesn't go through
this card-token lookup — it charges directly by `originalPaymentId`, since
nothing in what you've shared confirms the same `Get Payment` +
`cardInfo.token` pattern applies there too. Worth testing separately if you
want that path hardened the same way.

Also simplified: `newVenmoCheckout()`'s body now matches the doc's base
"Option 3" example exactly — `subtotal` + `venmo: { email }` + the
confirmed top-level `email`, nothing else. `vault`/`returnUrl`/`cancelUrl`
were removed, per request, to keep the backend-proxy architecture but match
this simpler body. **Worth knowing**: without `vault: true`, a first-time
purchase through this button won't save the account, so the vaulted-token
detection above has nothing to find unless vaulting is mandatory at the
account level on your Coinflow config — test a first purchase and check
`Get Customer` afterward to confirm whether `token` shows up or not.

## Fixed: Venmo/PayPal buttons re-mounting on every keystroke

Both `VenmoButton.tsx` and `PayPalButton.tsx` had `email` in their setup
`useEffect`'s dependency array. Since `email` is the customer's typed input,
it changes on every keystroke — tearing down and rebuilding the whole
SDK-button setup (merchant-view fetch, script load, button render) each
time, with the effect's own cleanup (`cancelled = true`) frequently aborting
the in-flight setup mid-request. Fixed by moving `email` into a ref
(`emailRef`) that `createOrder` reads from at click time, while the setup
effect itself only depends on `[pack.id, sandbox]` (Venmo) / `[pack.id]`
(PayPal) — it now runs once and stays mounted while the customer types.

## Apple Pay — corrected: the real CoinflowApplePayButton, not raw ApplePaySession

This is a full replacement, not a patch. The old implementation hand-built
the Apple Pay flow directly against Safari's `ApplePaySession` API, with two
of our own endpoints (`/api/apple-pay/validate-merchant`,
`/api/apple-pay/complete`) standing in for merchant validation and payment
completion — both flagged `UNVERIFIED` since no real spec for that part was
ever available. All of that is gone now, replaced by Coinflow's actual SDK
component, `CoinflowApplePayButton` (already installed via
`@coinflowlabs/react`), which handles the entire first-purchase flow
internally.

**First-time purchase**: `components/ApplePaySdkButton.tsx` renders
`<CoinflowApplePayButton env sessionKey merchantId subtotal color onSuccess onError />`
directly. Notably, this component needs a **session key exposed to the
client** — `/api/me` now includes one (`getSessionKey()` is exported from
`lib/coinflow.ts` for this). This is the sanctioned pattern, not a security
compromise: session keys are short-lived and scoped to one user+merchant,
unlike the raw merchant API key, which still never leaves the server.
`CoinflowPayPalButton` in Coinflow's own docs takes the same `sessionKey`
prop directly.

**Returning customer**: no localStorage involved at all anymore — Apple Pay
now works exactly like Venmo/PayPal. `GET /api/customer/v2`'s `mobiles`
array (confirmed real shape: `{ alias, type, genus: "applepay", token,
expMonth, expYear }`) is the source of truth. `/api/checkout/apple-pay`
(new route, mirrors the vaulted Venmo/PayPal routes) finds the Apple Pay
entry via `findApplePayWallet()`, gates the charge on
`card-on-file-authorized({ token })`, and if authorized, charges with
`card-on-file({ token })` — the exact same functions Card already uses,
since an Apple Pay token behaves identically to a card token once you have
it.

Files removed entirely: `components/ApplePayButton.tsx`,
`app/api/apple-pay/validate-merchant/route.ts`,
`app/api/apple-pay/complete/route.ts`, `types/apple-pay.d.ts`. A much
smaller `types/apple-pay-availability.d.ts` remains, only for the
`window.ApplePaySession.canMakePayments()` check used to decide whether to
show the Apple Pay row at all — that's the one piece of the raw browser API
still worth keeping, since `CoinflowApplePayButton` doesn't expose an
"is Apple Pay available here" check of its own.

## Venmo/PayPal merchant-view diagnostics

`/api/venmo/merchant-view` runs its two underlying calls
(`getVenmoMerchantId`, `getPayPalMerchantConfig`) sequentially now instead of
via `Promise.all`, so a failure names exactly which one it was
(`step: "getVenmoMerchantId"` or `"getPayPalMerchantConfig"`) along with the
raw Coinflow status/body — this was previously ambiguous.

That diagnostic paid off immediately: the real 401 body was
`{"message":"Error Processing your request","details":"Authorization header
not set"}`. So `GET /api/merchant/v2` actually wants **both** the session
key *and* the `Authorization` header together — the doc's example curl only
showed the session key, which is why this was missed initially.
`getVenmoMerchantId()` now sends both. No other endpoint in this app needed
the same fix — `getCustomer`, the Venmo/PayPal checkout calls, and
`card-on-file`/`card-on-file-authorized` all have real confirmed working
curls using only the header(s) already implemented for each.

## Venmo/PayPal vaulting — corrected: no `vaulted` field actually exists

A real `Get Customer` response you shared showed
`customer.venmo: { type, alias, token, isDeleted }` — no `vaulted` boolean
anywhere. `/api/me` and both vaulted-checkout routes were checking
`customer.venmo?.vaulted` (and the PayPal equivalent), which was always
`undefined` — meaning **no returning customer ever got routed to the
one-click vaulted charge**, regardless of whether they actually had a saved
account. Every "returning" customer kept hitting the first-purchase flow
forever.

Fixed in three places (`app/api/checkout/venmo/route.ts`,
`app/api/checkout/paypal/route.ts`, `app/api/me/route.ts`): the check is now
just "does `customer.venmo.token` (or `.paypal.token`) exist" — presence of
a saved token *is* the vault-eligible signal, there's no separate flag to
check. Applied the identical fix to PayPal since it's the same code pattern
against the same endpoint — worth confirming against a real PayPal
`Get Customer` response too, but I'd expect the same shape.

Also fixed: `newVenmoCheckout()`'s request body was missing a top-level
`email` field — a real working request you tested included it alongside
the nested `venmo: { email }`, so both are now sent.

> ⚠️ **Separate, still-open issue**: `/api/venmo/merchant-view` (used to
> load the PayPal SDK script with Venmo enabled, before any of this vaulted-
> detection logic even runs) was returning a 401 from Coinflow's
> `/api/merchant/v2` with a generic `"Error Processing your request"`
> message. That's unrelated to the vaulted-detection bug above — it'll
> still block the Venmo button from ever rendering until it's resolved.
> Worth testing that endpoint directly via curl (session key → GET
> `/api/merchant/v2`) to confirm whether it's an account-side config issue
> or something else, independent of this fix.

## Venmo — corrected: real embedded button, not a guessed popup

Earlier versions of this app guessed at Venmo's first-purchase flow (an
`approvalUrl` field, a custom popup + `/checkout/return` relay). That was
wrong. Coinflow's actual Venmo "Option 3" doc — the same shape as PayPal's —
uses PayPal's own JS SDK with Venmo enabled as a funding source, embedded
directly like PayPal's button:

- **`components/VenmoButton.tsx`** loads the PayPal SDK with
  `enable-funding=venmo` (and `buyer-country=US` in sandbox, since Venmo is
  US-only and needs that to be eligible outside a real US context), renders
  `paypal.Buttons({ fundingSource: paypal.FUNDING.VENMO, ... })`, and checks
  `.isEligible()` before rendering — hiding the Venmo method row entirely if
  it isn't (`onIneligible` callback in `BuyModal.tsx`).
- **`createOrder`** calls `POST /api/checkout/venmo/new`, which returns
  `{ paymentId }` — same as PayPal, no `approvalUrl` at all. That response
  **is** the Venmo/PayPal order id, returned straight to the SDK.
- **`onApprove`** fires once the customer approves in Venmo's own popup
  (opened and managed entirely by the SDK, not by our code) — no
  `window.open`, no `postMessage` listener needed anymore. Both were removed
  from `BuyModal.tsx` along with the now-dead `awaiting-approval` step.
- **Merchant config** (`GET /api/venmo/merchant-view`) combines two calls:
  `paypalMerchantId` from the authenticated `Get Merchant (v2)` endpoint
  Venmo's doc specifically names, and `paypalClientId` reused from PayPal's
  existing public merchant-view lookup — the doc confirms Venmo "uses your
  paypalMerchantId and the same PayPal client-id" as PayPal, so there's no
  need to duplicate that value or hardcode the sandbox client id it also
  mentions.
- **Vaulting** (`vault: true` + `returnUrl`/`cancelUrl` on `newVenmoCheckout`)
  was already correct from before and needed no changes — same confirmed
  pattern as PayPal's.

The `app/checkout/return` and `app/checkout/cancel` pages still exist
(they're referenced as `returnUrl`/`cancelUrl` values, which must point at a
real whitelisted URL even though the SDK-embedded flow never navigates
there) but nothing in this app's own JS opens them anymore — they're a
formality for Coinflow's validation, not a working part of the flow.

## Card — first purchase uses Card Checkout, not Zero Auth

The first-purchase flow uses **Card Checkout**
(`POST /api/checkout/card/{merchantId}`) — a real charge for the pack price
— rather than a $0 Zero Authorization chained into a separate Card on File
call. Per the Card on File doc's "Option A: Card Checkout" step, this both
charges the customer and stores the card as a side effect of the successful
charge; no second call needed. `zeroAuthorization()` is still in
`lib/coinflow.ts` as a utility (genuinely $0-auth use cases like free
trials still want it), it's just not part of this checkout path anymore.

See the "Card — corrected" section below for how the *returning*-customer
side of this now works — it changed after real sandbox testing surfaced two
mistaken assumptions.

## Card — client-side localStorage, not a server cookie

Card is the one payment method that still needs this — its saved-payment
status genuinely isn't tracked anywhere on the Coinflow customer profile.
Apple Pay used to work this way too, but no longer does — see "Apple Pay —
corrected" above; it now checks the customer profile live, same as
Venmo/PayPal. That storage lives in `lib/cardStorage.ts`, in the browser's
**localStorage**, not a server cookie:

- On a successful first purchase, `/api/checkout` returns a
  `savedCardReference: { paymentId, display }` in the response. The client
  writes it to localStorage.
- On every subsequent purchase, the client reads it back and sends
  `paymentId` explicitly in the request body. `/api/checkout` only takes
  the Card on File path when the client sends one — the server itself has
  no memory of "is this a returning customer" for Card otherwise.
- If nothing is in localStorage, a fresh Card Checkout is required before
  any Card on File charge can happen — exactly as if it were a first-time
  customer.
- A `410`/`CARD_REVERIFICATION_REQUIRED` (either an expired reference or
  `card-on-file-authorized` returning `false`) clears the localStorage entry
  client-side and falls back to fresh card entry, under the same
  `cf_user_id`/customer.

Trade-off worth knowing: this only works within one browser. Clearing site
data, switching browsers, or using a different device all look like a
first-time customer, even though Coinflow may still have the card on file.
The fix for that would be a proper database keyed to a real authenticated
user (not this app's anonymous per-browser id) rather than localStorage or a
cookie — worth doing if this becomes more than a demo.

## PayPal — Direct API + PayPal SDK (Option 3, fully implemented)

Same pattern as Venmo above, with no guessing:

1. **`GET /api/paypal/merchant-view`** proxies Coinflow's public
   `merchant/view/v2/{merchantId}` endpoint (no auth needed) to get
   `paypalClientId` / `paypalMerchantId` for the current sandbox/production
   environment.
2. **`components/PayPalButton.tsx`** loads PayPal's own JS SDK script with
   those values (`intent=authorize`, `components=buttons`,
   `disable-funding=paylater`, and the required
   `data-partner-attribution-id="CoinflowLabsLimited_PSP"`), then renders
   PayPal's real button.
3. The button's `createOrder` calls **`POST /api/checkout/paypal/new`**,
   which calls Coinflow's PayPal checkout and returns `paymentId` — which
   **is** the PayPal order id, returned straight back to the SDK.
4. `onApprove` fires once the customer approves inside PayPal's own overlay
   — no redirect, no popup window, unlike the Venmo flow. The modal treats
   that as success and shows the reveal screen.
5. **Vaulted returning customers skip all of this** — `POST
   /api/checkout/paypal` (unchanged, still fully documented) charges the
   saved account in one click, exactly as before.

One judgment call that's now **resolved** rather than open: earlier I'd left `vault: true` off the first-purchase call, assuming it needed the redirect-based flow. The vaulting doc actually shows `vault: true` on the exact same `POST /api/checkout/paypal/{merchantId}` endpoint Option 3 uses for `createOrder`, and its own note says `returnUrl`/`cancelUrl` are never navigated to in a popup/SDK integration — they just need to be whitelisted. So `newPayPalCheckout()` now passes `vault: true` plus the same `returnUrl`/`cancelUrl` pattern already used for Venmo. A successful first purchase now vaults the account, so a returning customer with the same `x-coinflow-auth-user-id` gets the one-click `POST /api/checkout/paypal` path automatically on their next visit.

## Venmo & PayPal vaulting

Both appear as rows in "Select payment method," alongside Card. Behavior
splits on whether Coinflow reports the account as `vaulted` (checked live
via `getCustomer()` in `lib/coinflow.ts` — no local cookie needed, since
Coinflow tracks vaulting on the customer profile itself):

- **Vaulted (returning customer)**: one click. `/api/checkout/venmo` or
  `/api/checkout/paypal` calls the vaulted endpoint directly with the
  account's token (fetched server-side, never sent to the browser) and the
  FraudNet `clientMetadataId` generated by `lib/useFraudNet.ts`. No popup, no
  approval screen, per the docs.
- **First-time (not yet vaulted)**: the shopper enters their email, and
  `/api/checkout/venmo` / `/api/checkout/paypal` calls the "new checkout"
  endpoint with `vault: true`. The modal opens a popup to the returned
  approval URL; `app/checkout/return/page.tsx` and
  `app/checkout/cancel/page.tsx` relay the result back via `postMessage` and
  close themselves.

FraudNet (required for any vaulted charge) is embedded via
`lib/useFraudNet.ts` as soon as the modal opens, exactly per the doc's
snippet — a fresh CMID is generated per page view.

> ⚠️ **The first-purchase flow has two unverified pieces**, flagged in
> `lib/coinflow.ts` — but only for **Venmo**. PayPal's first-purchase flow is
> now fully documented and implemented for real (see the section above); this
> caveat applies to `newVenmoCheckout` only. The docs I had only linked to
> "New Venmo Checkout" without detailing the response, so I'm assuming it
> returns `{ paymentId, approvalUrl }` — the `approvalUrl` field name is a
> guess. Likewise, `app/checkout/return/page.tsx` assumes Coinflow appends a
> `paymentId` query param to your `returnUrl`, which is also unconfirmed for
> Venmo specifically.
> Both the **vaulted** path and the FraudNet setup are fully documented and
> should work as-is; only the first-time approval popup needs verifying
> against Coinflow's actual API reference for those two endpoints.
>
> Also: `returnUrl`/`cancelUrl` must be on your merchant account's
> **whitelisted URL list** or the request is rejected with a 403 — add
> `http://localhost:3000/checkout/return` and `.../checkout/cancel` (and your
> production domain's equivalents) there before testing.

## Session-key authentication

Every authenticated Coinflow call now fetches a short-lived **session key**
first (`GET /api/auth/session-key`, headers `x-coinflow-auth-user-id` +
`Authorization`), then sends that session key on the actual checkout call
instead of the raw user id. This lives in `getSessionKey()` in
`lib/coinflow.ts` and runs before every `zeroAuthorization`, `cardOnFile`,
`cardOnFileAuthorized`, and Apple Pay call — no caching, a fresh key is
fetched per request.

> ⚠️ **Two things here are still a guess**, marked `SESSION_KEY_ASSUMPTION`
> in `lib/coinflow.ts`:
> 1. The session-key response body is assumed to be `{ "sessionKey": "..." }`.
>
> **Confirmed** by the Venmo/PayPal vaulting docs: the session key is sent
> back as header `x-coinflow-auth-session-key`, and downstream checkout
> calls no longer need the separate `Authorization` header at all — that's
> now only used to fetch the session key itself. Code updated accordingly.

## Apple Pay

See "Apple Pay — corrected" further up — this section used to describe a
hand-built `ApplePaySession` implementation that's been fully replaced by
the real `CoinflowApplePayButton` SDK component.

## What's intentionally out of scope for this scaffold

- **Google Pay / Link** — the modal implements `Card` and `Apple Pay` only,
  per spec. The UI has room to add the others later.
- **3D Secure** — if a card issuer requires a 3DS challenge, Coinflow returns
  `412` and this scaffold just surfaces an error message. See Coinflow's
  [3DS challenge guide](/recipes/recipes/complete-checkout-with-3-ds-challenge-react)
  to add the iframe flow.
- **Chargeback protection device ID** — `cardOnFile()` in `lib/coinflow.ts`
  accepts an optional `deviceId`; wire up Coinflow Purchase Protection and
  pass it through once that's enabled on your merchant account.
- **Persistent storage** — the card reference lives in a cookie, so it's
  scoped to one browser. For real accounts, store `originalPaymentId` next to
  your user record in a database instead.

## Setup

```bash
npm install
cp .env.example .env.local
# fill in COINFLOW_MERCHANT_ID / COINFLOW_API_KEY from your Coinflow rep
npm run dev
```

Open http://localhost:3000. Use Coinflow's sandbox test cards for the first
purchase — subsequent purchases in the same browser will skip the card form.
