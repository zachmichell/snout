// Thin wrapper around the Helcim REST API. All calls go to the v2
// production base; sandbox/test mode is keyed off the operator's token,
// not the URL. The verify endpoint costs nothing on Helcim's side and
// returns 200 + a small JSON envelope on a working token.
//
// Helcim authenticates with a static "api-token" header (not Bearer).
// Failures are returned as { ok: false, status, error } so callers can
// log and respond without throwing.

const HELCIM_BASE = "https://api.helcim.com/v2";

export type HelcimResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

async function call<T>(
  path: string,
  apiToken: string,
  init: RequestInit = {},
): Promise<HelcimResult<T>> {
  const headers = new Headers(init.headers ?? {});
  headers.set("api-token", apiToken);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(`${HELCIM_BASE}${path}`, { ...init, headers });
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }

  const text = await res.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Helcim sometimes returns plain text on errors; preserve verbatim.
      parsed = { message: text };
    }
  }

  if (!res.ok) {
    const message =
      parsed?.errors?.[0]?.message ??
      parsed?.message ??
      parsed?.error ??
      `Helcim returned ${res.status}`;
    return { ok: false, status: res.status, error: String(message) };
  }
  return { ok: true, status: res.status, data: parsed as T };
}

// Cheapest endpoint that actually exercises the auth path. Returns
// { message: 'Connected Successfully' } on a working token.
export function helcimVerifyToken(apiToken: string) {
  return call<{ message: string }>("/connect-test", apiToken, { method: "GET" });
}

// Initialize a HelcimPay.js checkout session. Returns a checkoutToken
// and secretToken that are passed to the front-end widget.
export type HelcimInitializePayload = {
  paymentType: "purchase" | "preauth" | "verify";
  amount: number;
  currency: "CAD" | "USD";
  invoiceNumber?: string;
  customerCode?: string;
  customerRequest?: "always" | "if_required" | "never";
  test?: boolean;
};

export type HelcimInitializeResponse = {
  checkoutToken: string;
  secretToken: string;
};

export function helcimInitializeCheckout(
  apiToken: string,
  payload: HelcimInitializePayload,
) {
  return call<HelcimInitializeResponse>("/helcim-pay/initialize", apiToken, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Verify a webhook signature. Helcim signs with HMAC-SHA256 over the raw
// request body using the verifier token from the merchant's Helcim
// dashboard. The signature is delivered in `webhook-signature` and the
// timestamp in `webhook-timestamp` (per Standard Webhooks spec).
export async function verifyHelcimWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestamp: string | null,
  verifierToken: string,
): Promise<boolean> {
  if (!signatureHeader || !timestamp || !verifierToken) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(verifierToken),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${timestamp}.${rawBody}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));

  // Helcim's header may carry multiple signature versions: "v1,sig1 v1,sig2".
  // Accept a match on any space-separated entry whose payload equals expected.
  const parts = signatureHeader.split(" ");
  for (const p of parts) {
    const [, sig] = p.split(",");
    if (sig && timingSafeEqual(sig, expected)) return true;
  }
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
