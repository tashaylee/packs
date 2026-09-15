"use client";

const KEY = "cf_card_reference";

// Card only now — Apple Pay's saved-method status lives on the Coinflow
// customer profile (Get Customer's `mobiles` array) and is checked live via
// /api/me, the same way Venmo/PayPal vaulting already works. No local
// storage needed for it.
export type StoredCardRef = {
  paymentId: string;
  display: string; // e.g. "exp 09/27"
};

/**
 * The server never remembers a shopper's card between requests — the
 * browser does. Every /api/checkout call for a returning customer sends
 * this paymentId back explicitly; the server looks up the card's reusable
 * token from it (getMerchantPayment), checks card-on-file-authorized, and
 * only then charges. If there's nothing here, it's treated as a first-time
 * purchase requiring a fresh Card Checkout.
 */
export function getStoredCardRef(): StoredCardRef | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.paymentId) return null;
    return parsed as StoredCardRef;
  } catch {
    // Corrupted value or localStorage unavailable (private browsing, quota,
    // disabled) — treat exactly like "no card on file" rather than throwing.
    return null;
  }
}

export function setStoredCardRef(ref: StoredCardRef) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ref));
  } catch {
    // If storage isn't available, the purchase itself already succeeded —
    // the only consequence is the next purchase will ask for a card again.
  }
}

export function clearStoredCardRef() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — see note above.
  }
}
