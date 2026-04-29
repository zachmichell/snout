// Thin wrapper around the QuickBooks Online REST API and OAuth flow.
//
// Intuit's API has two environments (sandbox and production) at
// different base URLs but otherwise identical surfaces. The OAuth
// authorization URL is the same for both; the token endpoint is the
// same for both; only the data API base differs.
//
// Authentication: bearer access token. Access tokens last ~60 minutes.
// Refresh tokens last 100 days and rotate on every refresh per Intuit's
// implementation of OAuth 2.0 best practice. Both are stored in Vault
// via the set_quickbooks_tokens / update_quickbooks_tokens SQL helpers.

export type QboEnvironment = "sandbox" | "production";

const INTUIT_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const INTUIT_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

function dataBase(env: QboEnvironment) {
  return env === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

export type QboTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
};

export type QboResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

function basicAuth(clientId: string, clientSecret: string): string {
  return "Basic " + btoa(`${clientId}:${clientSecret}`);
}

/**
 * Build the user-facing authorization URL. The caller must persist
 * `state` server-side before redirecting; the callback verifies it.
 */
export function buildAuthorizationUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  const url = new URL(INTUIT_AUTH_URL);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    (args.scopes ?? ["com.intuit.quickbooks.accounting"]).join(" "),
  );
  url.searchParams.set("state", args.state);
  return url.toString();
}

/**
 * Exchange an authorization code for access + refresh tokens. Called
 * by the callback edge function after Intuit redirects back.
 */
export async function exchangeAuthorizationCode(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<QboResult<QboTokenResponse>> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
  });

  let res: Response;
  try {
    res = await fetch(INTUIT_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuth(args.clientId, args.clientSecret),
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error_description: text };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error:
        parsed?.error_description ??
        parsed?.error ??
        `Intuit token exchange returned ${res.status}`,
    };
  }
  return { ok: true, status: res.status, data: parsed as QboTokenResponse };
}

/**
 * Refresh an access token using the stored refresh token. Intuit
 * rotates the refresh token on every call; callers must persist the
 * new one returned in the response.
 */
export async function refreshAccessToken(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<QboResult<QboTokenResponse>> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
  });

  let res: Response;
  try {
    res = await fetch(INTUIT_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuth(args.clientId, args.clientSecret),
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error_description: text };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error:
        parsed?.error_description ??
        parsed?.error ??
        `Intuit token refresh returned ${res.status}`,
    };
  }
  return { ok: true, status: res.status, data: parsed as QboTokenResponse };
}

/**
 * Revoke a token at the Intuit endpoint. Best-effort; if Intuit is
 * unavailable we still soft-delete locally and stop using the token.
 */
export async function revokeToken(args: {
  clientId: string;
  clientSecret: string;
  token: string;
}): Promise<QboResult<{ ok: boolean }>> {
  let res: Response;
  try {
    res = await fetch(INTUIT_REVOKE_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuth(args.clientId, args.clientSecret),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: args.token }),
    });
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: text || `Intuit revoke returned ${res.status}`,
    };
  }
  return { ok: true, status: res.status, data: { ok: true } };
}

/**
 * Fetch the company info (display name, country, currency, etc.) for
 * an authorized realm. Used after a fresh connect to populate
 * quickbooks_accounts.company_name.
 */
export async function fetchCompanyInfo(args: {
  accessToken: string;
  realmId: string;
  environment: QboEnvironment;
}): Promise<QboResult<{ CompanyName: string; LegalName?: string; Country?: string; SupportedLanguages?: string }>> {
  const url = `${dataBase(args.environment)}/v3/company/${args.realmId}/companyinfo/${args.realmId}?minorversion=70`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { Fault: { Error: [{ Message: text }] } };
  }
  if (!res.ok) {
    const message =
      parsed?.Fault?.Error?.[0]?.Message ??
      parsed?.Fault?.Error?.[0]?.Detail ??
      `QBO returned ${res.status}`;
    return { ok: false, status: res.status, error: String(message) };
  }
  return { ok: true, status: res.status, data: parsed?.CompanyInfo ?? {} };
}

/**
 * Generate a cryptographically random state token for the OAuth
 * dance. Long enough to be infeasible to guess.
 */
export function generateOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
