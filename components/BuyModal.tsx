"use client";

import { useEffect, useRef, useState } from "react";
import { CoinflowCardForm, CardFormRef } from "@coinflowlabs/react";
import { Pack } from "@/data/packs";
import { formatPrice } from "./PackCard";
import { RevealCard } from "./RevealCard";
import { ApplePaySdkButton } from "./ApplePaySdkButton";
import { PayPalButton } from "./PayPalButton";
import { VenmoButton } from "./VenmoButton";
import { useClientMetadataId } from "@/lib/useFraudNet";
import { StoredCardRef, clearStoredCardRef, getStoredCardRef, setStoredCardRef } from "@/lib/cardStorage";

type Method = "card" | "venmo" | "paypal" | "apple_pay";
type Step = "loading" | "ready" | "charging" | "reveal";

type MeResponse = {
  venmoVaulted: boolean;
  venmoAlias: string | null;
  paypalVaulted: boolean;
  paypalAlias: string | null;
  applePayVaulted: boolean;
  applePayAlias: string | null;
  sandbox: boolean;
  merchantId: string;
  cardFormEnv: "sandbox" | "prod";
  sessionKey: string | null;
};

type BillingDetails = {
  email: string;
  firstName: string;
  lastName: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

const emptyBilling: BillingDetails = {
  email: "",
  firstName: "",
  lastName: "",
  address1: "",
  city: "",
  state: "",
  zip: "",
  country: "US",
};

export function BuyModal({
  pack,
  onClose,
}: {
  pack: Pack;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("loading");
  const [method, setMethod] = useState<Method>("card");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [venmoEligible, setVenmoEligible] = useState(true);
  const [applePayAvailable, setApplePayAvailable] = useState(false);

  // The Card reference lives in the browser's localStorage — the server is
  // never asked "does this person have a card on file?" directly; we read
  // it here and send it back explicitly on every /api/checkout call.
  // Apple Pay/Venmo/PayPal don't need this — their vaulted status is
  // checked live from the Coinflow customer profile via /api/me instead.
  const [savedCard, setSavedCard] = useState<StoredCardRef | null>(null);

  const cardFormRef = useRef<CardFormRef>(null);
  const [billing, setBilling] = useState<BillingDetails>(emptyBilling);
  const [venmoEmail, setVenmoEmail] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");

  const clientMetadataId = useClientMetadataId(me?.sandbox ?? true);

  useEffect(() => {
    setSavedCard(getStoredCardRef());
    setApplePayAvailable(
      typeof window !== "undefined" &&
        !!window.ApplePaySession &&
        window.ApplePaySession.canMakePayments(),
    );

    let cancelled = false;
    fetch("/api/me")
      .then((r) => r.json())
      .then((data: MeResponse) => {
        if (cancelled) return;
        setMe(data);
        setStep("ready");
      })
      .catch(() => !cancelled && setStep("ready"));
    return () => {
      cancelled = true;
    };
  }, []);

  const billingComplete =
    billing.email && billing.firstName && billing.lastName && billing.address1 && billing.city && billing.state && billing.zip && billing.country;

  async function chargeSavedCard() {
    if (!savedCard) return;
    setStep("charging");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId: pack.id, paymentId: savedCard.paymentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        // A velocity limit/expired reference, or card-on-file-authorized
        // came back false — clear it and drop back to a fresh card
        // checkout, per the recovery rule.
        if (data.code === "CARD_REVERIFICATION_REQUIRED") {
          clearStoredCardRef();
          setSavedCard(null);
        }
        setErrorMessage(data.error || "Payment failed. Please try again.");
        setStep("ready");
        return;
      }
      setStep("reveal");
    } catch {
      setErrorMessage("Network error. Please try again.");
      setStep("ready");
    }
  }

  async function submitNewCard() {
    setErrorMessage(null);

    // Tokenize the card in the hosted CoinflowCardForm iframe — the raw
    // card number/CVV never touch our server, only the resulting token.
    let tokenResult;
    try {
      tokenResult = await cardFormRef.current?.tokenize();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Card details are invalid. Please check them and try again.",
      );
      return;
    }
    if (!tokenResult?.token || !tokenResult.expMonth || !tokenResult.expYear) {
      setErrorMessage("Could not tokenize card. Please check the details and try again.");
      return;
    }

    setStep("charging");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packId: pack.id,
          card: {
            token: tokenResult.token,
            expMonth: tokenResult.expMonth,
            expYear: tokenResult.expYear,
            ...billing,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Payment failed. Please try again.");
        setStep("ready");
        return;
      }
      if (data.savedCardReference) {
        setStoredCardRef(data.savedCardReference as StoredCardRef);
        setSavedCard(data.savedCardReference as StoredCardRef);
      }
      setStep("reveal");
    } catch {
      setErrorMessage("Network error. Please try again.");
      setStep("ready");
    }
  }

  async function chargeVaultedVenmo() {
    setStep("charging");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/checkout/venmo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId: pack.id, clientMetadataId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Payment failed. Please try again.");
        setStep("ready");
        return;
      }
      setStep("reveal");
    } catch {
      setErrorMessage("Network error. Please try again.");
      setStep("ready");
    }
  }

  async function chargeVaultedPayPal() {
    setStep("charging");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/checkout/paypal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId: pack.id, clientMetadataId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Payment failed. Please try again.");
        setStep("ready");
        return;
      }
      setStep("reveal");
    } catch {
      setErrorMessage("Network error. Please try again.");
      setStep("ready");
    }
  }

  async function chargeVaultedApplePay() {
    setStep("charging");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/checkout/apple-pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId: pack.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Payment failed. Please try again.");
        setStep("ready");
        return;
      }
      setStep("reveal");
    } catch {
      setErrorMessage("Network error. Please try again.");
      setStep("ready");
    }
  }

  const busy = step === "loading" || step === "charging";
  const savedCardUsable = Boolean(savedCard);

  function buyButtonLabel() {
    if (step === "charging") return "Processing…";
    return `Buy now for ${formatPrice(pack.priceCents, pack.currency)}`;
  }

  function handleBuy() {
    if (method === "card") {
      savedCardUsable ? chargeSavedCard() : submitNewCard();
    } else if (method === "venmo") {
      chargeVaultedVenmo();
    } else if (method === "paypal") {
      chargeVaultedPayPal();
    } else {
      chargeVaultedApplePay();
    }
  }

  // For a not-yet-vaulted Venmo/PayPal/Apple Pay purchase, the embedded SDK
  // button *is* the buy action — our generic button doesn't apply there.
  const venmoNeedsSdkButton = method === "venmo" && !me?.venmoVaulted;
  const paypalNeedsSdkButton = method === "paypal" && !me?.paypalVaulted;
  const applePayNeedsSdkButton = method === "apple_pay" && !me?.applePayVaulted;

  const buyDisabled =
    busy || (method === "card" && !savedCardUsable && !billingComplete);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-panel shadow-glow animate-rise max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "reveal" ? (
          <RevealCard pack={pack} onClose={onClose} />
        ) : (
          <div className="p-6">
            <div className="flex items-start justify-between">
              <h2 className="font-display text-2xl">Buy a pack</h2>
              <button onClick={onClose} aria-label="Close" className="text-white/50 hover:text-white">
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm text-white/50">{pack.name}</p>

            <div className="mt-6">
              <p className="text-sm font-medium text-white/70 mb-2">Select payment method</p>

              <div className="space-y-2">
                <MethodRow
                  icon="💳"
                  label={savedCardUsable ? `Card ${savedCard?.display}` : "Card"}
                  selected={method === "card"}
                  onSelect={() => setMethod("card")}
                />
                {venmoEligible && (
                  <MethodRow
                    icon="Ⓥ"
                    label={me?.venmoVaulted ? `Venmo — ${me.venmoAlias}` : "Venmo"}
                    selected={method === "venmo"}
                    onSelect={() => setMethod("venmo")}
                  />
                )}
                <MethodRow
                  icon="P"
                  label={me?.paypalVaulted ? `PayPal — ${me.paypalAlias}` : "PayPal"}
                  selected={method === "paypal"}
                  onSelect={() => setMethod("paypal")}
                />
                {applePayAvailable && (
                  <MethodRow
                    icon=""
                    label={me?.applePayVaulted ? `Apple Pay — ${me.applePayAlias}` : "Apple Pay"}
                    selected={method === "apple_pay"}
                    onSelect={() => setMethod("apple_pay")}
                  />
                )}
              </div>
            </div>

            {method === "card" && !savedCardUsable && me && (
              <div className="mt-4 space-y-3">
                <div>
                  <span className="text-xs text-white/50">Card details</span>
                  <div className="mt-1 rounded-lg border border-line bg-ink p-3">
                    <CoinflowCardForm
                      ref={cardFormRef}
                      merchantId={me.merchantId}
                      env={me.cardFormEnv}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label="First name"
                    value={billing.firstName}
                    onChange={(v) => setBilling((b) => ({ ...b, firstName: v }))}
                  />
                  <TextField
                    label="Last name"
                    value={billing.lastName}
                    onChange={(v) => setBilling((b) => ({ ...b, lastName: v }))}
                  />
                </div>
                <TextField
                  label="Email"
                  type="email"
                  value={billing.email}
                  onChange={(v) => setBilling((b) => ({ ...b, email: v }))}
                />
                <TextField
                  label="Address"
                  value={billing.address1}
                  onChange={(v) => setBilling((b) => ({ ...b, address1: v }))}
                />
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label="City"
                    value={billing.city}
                    onChange={(v) => setBilling((b) => ({ ...b, city: v }))}
                  />
                  <TextField
                    label="State"
                    value={billing.state}
                    onChange={(v) => setBilling((b) => ({ ...b, state: v }))}
                  />
                  <TextField
                    label="Zip"
                    value={billing.zip}
                    onChange={(v) => setBilling((b) => ({ ...b, zip: v }))}
                  />
                  <TextField
                    label="Country"
                    value={billing.country}
                    onChange={(v) => setBilling((b) => ({ ...b, country: v.toUpperCase() }))}
                  />
                </div>

                <p className="text-[11px] text-white/35">
                  We validate your card with a $0.00 authorization and store it securely so future
                  purchases are one tap.
                </p>
              </div>
            )}

            {method === "card" && savedCardUsable && (
              <button
                onClick={() => {
                  clearStoredCardRef();
                  setSavedCard(null);
                }}
                className="mt-2 text-xs text-white/40 hover:text-white/70 underline underline-offset-2"
              >
                Use a different card
              </button>
            )}

            {method === "venmo" && !me?.venmoVaulted && me && (
              <div className="mt-4 space-y-3">
                <TextField label="Venmo email" type="email" value={venmoEmail} onChange={setVenmoEmail} />
                <p className="text-[11px] text-white/35">
                  You'll approve this purchase with Venmo. Once approved, future purchases are one
                  tap — no popup, no approval.
                </p>
                {venmoEmail && (
                  <VenmoButton
                    pack={pack}
                    email={venmoEmail}
                    sandbox={me.sandbox}
                    onApprove={() => setStep("reveal")}
                    onError={(msg) => {
                      setErrorMessage(msg);
                      setStep("ready");
                    }}
                    onIneligible={() => setVenmoEligible(false)}
                  />
                )}
              </div>
            )}

            {method === "paypal" && !me?.paypalVaulted && (
              <div className="mt-4 space-y-3">
                <TextField label="PayPal email" type="email" value={paypalEmail} onChange={setPaypalEmail} />
                <p className="text-[11px] text-white/35">
                  You'll approve this purchase with PayPal. Once approved, future purchases are one
                  tap — no popup, no login.
                </p>
                {paypalEmail && (
                  <PayPalButton
                    pack={pack}
                    email={paypalEmail}
                    onApprove={() => setStep("reveal")}
                    onError={(msg) => {
                      setErrorMessage(msg);
                      setStep("ready");
                    }}
                  />
                )}
              </div>
            )}

            {method === "apple_pay" && !me?.applePayVaulted && (
              <div className="mt-4 space-y-3">
                <p className="text-[11px] text-white/35">
                  Complete this purchase with the Apple Pay sheet. Future purchases will be one tap —
                  no sheet, no Face ID.
                </p>
                {me?.sessionKey ? (
                  <ApplePaySdkButton
                    pack={pack}
                    merchantId={me.merchantId}
                    env={me.cardFormEnv}
                    sessionKey={me.sessionKey}
                    onSuccess={() => setStep("reveal")}
                    onError={(msg) => {
                      setErrorMessage(msg);
                      setStep("ready");
                    }}
                  />
                ) : (
                  <p className="text-sm text-ember">
                    Apple Pay isn't available right now. Please try another payment method.
                  </p>
                )}
              </div>
            )}

            {errorMessage && <p className="mt-3 text-sm text-ember">{errorMessage}</p>}

            {!venmoNeedsSdkButton && !paypalNeedsSdkButton && !applePayNeedsSdkButton && (
              <button
                disabled={buyDisabled}
                onClick={handleBuy}
                className="mt-6 w-full rounded-xl bg-white py-3 text-sm font-semibold text-ink disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/90 transition-colors"
              >
                {buyButtonLabel()}
              </button>
            )}

            <p className="mt-3 text-center text-[11px] text-white/35">
              By clicking buy, you acknowledge you are over 18 and have read and accept our terms of
              service.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-white/50">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-arc"
      />
    </label>
  );
}

function MethodRow({
  icon,
  label,
  selected,
  onSelect,
}: {
  icon: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-xl border px-4 py-3 flex items-center gap-3 text-left transition-colors ${
        selected ? "border-ember/60 bg-ember/5" : "border-line hover:border-white/20"
      }`}
    >
      <span aria-hidden className="w-4 text-center">
        {icon}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
