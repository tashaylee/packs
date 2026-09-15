import "server-only";
import { cookies } from "next/headers";
import { v4 as uuidv4 } from "uuid";

const USER_ID_COOKIE = "cf_user_id";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Every shopper (logged in or not) needs a stable id to send Coinflow as
 * x-user-id and to key their Coinflow customer profile (Venmo/PayPal
 * vaulting) to. In a real app this would be your actual authenticated user
 * id — swap this out once you have accounts/auth.
 *
 * Note: the Card/Apple Pay original-payment reference itself is NOT stored
 * here anymore — it lives in the browser's localStorage instead (see
 * lib/cardStorage.ts) and is sent explicitly by the client on each request.
 * This cookie only identifies *which* Coinflow customer profile to use.
 */
export function getOrCreateUserId(): string {
  const store = cookies();
  const existing = store.get(USER_ID_COOKIE)?.value;
  if (existing) return existing;

  const id = uuidv4();
  store.set(USER_ID_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
  return id;
}
