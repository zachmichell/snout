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

// =============================================================================
// 6.2: Sync helpers used by the customer and item sync edge functions.
// =============================================================================

export type QboTokenContext = {
  accessToken: string;
  realmId: string;
  environment: QboEnvironment;
};

/**
 * Resolve a usable access token for the org, refreshing through Intuit
 * if the stored access token is at or near expiry. Persists the new
 * tokens via update_quickbooks_tokens before returning.
 *
 * Returns null if the org has no live QBO connection.
 */
export async function getTokenContext(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any; // SupabaseClient typed loosely so this file has no SDK dep
  orgId: string;
  clientId: string;
  clientSecret: string;
  refreshLeewaySeconds?: number;
}): Promise<QboTokenContext | null> {
  const { data, error } = await args.admin.rpc("get_quickbooks_tokens", {
    _org_id: args.orgId,
  });
  if (error) {
    console.error("get_quickbooks_tokens failed:", error);
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as {
    access_token: string;
    refresh_token: string;
    realm_id: string;
    environment: string;
    access_token_expires_at: string | null;
  };

  const leeway = (args.refreshLeewaySeconds ?? 120) * 1000;
  const expiresAt = row.access_token_expires_at
    ? new Date(row.access_token_expires_at).getTime()
    : 0;
  const env = row.environment as QboEnvironment;

  if (Date.now() < expiresAt - leeway) {
    return {
      accessToken: row.access_token,
      realmId: row.realm_id,
      environment: env,
    };
  }

  const refreshed = await refreshAccessToken({
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    refreshToken: row.refresh_token,
  });
  if (!refreshed.ok) {
    await args.admin
      .from("quickbooks_accounts")
      .update({
        status: "restricted",
        last_verification_error: refreshed.error,
      })
      .eq("organization_id", args.orgId);
    return null;
  }
  const newExpiresAt = new Date(
    Date.now() + refreshed.data.expires_in * 1000,
  ).toISOString();
  await args.admin.rpc("update_quickbooks_tokens", {
    _org_id: args.orgId,
    _access_token: refreshed.data.access_token,
    _refresh_token: refreshed.data.refresh_token,
    _access_expires_at: newExpiresAt,
  });
  return {
    accessToken: refreshed.data.access_token,
    realmId: row.realm_id,
    environment: env,
  };
}

/**
 * Generic authenticated request to a QBO data API endpoint. Returns
 * a structured QboResult so callers can branch on ok without
 * try/catching network errors.
 */
export async function qboRequest<T = unknown>(args: {
  ctx: QboTokenContext;
  method: "GET" | "POST";
  path: string; // e.g. "/v3/company/<realmId>/customer?minorversion=70"
  body?: unknown;
}): Promise<QboResult<T>> {
  const url = `${dataBase(args.ctx.environment)}${args.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.ctx.accessToken}`,
    Accept: "application/json",
  };
  if (args.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: args.method,
      headers,
      body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
    });
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
  const text = await res.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { Fault: { Error: [{ Message: text }] } };
    }
  }
  if (!res.ok) {
    const fault = parsed?.Fault?.Error?.[0];
    const message =
      fault?.Message ??
      fault?.Detail ??
      parsed?.Fault?.type ??
      `QBO returned ${res.status}`;
    return { ok: false, status: res.status, error: String(message) };
  }
  return { ok: true, status: res.status, data: parsed as T };
}

// ----- Customer ----------------------------------------------------------

export type QboCustomerInput = {
  DisplayName: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
    Country?: string;
  };
  Notes?: string;
};

export type QboCustomer = QboCustomerInput & {
  Id: string;
  SyncToken: string;
  Active?: boolean;
};

export function createCustomer(ctx: QboTokenContext, input: QboCustomerInput) {
  return qboRequest<{ Customer: QboCustomer }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/customer?minorversion=70`,
    body: input,
  });
}

export function updateCustomer(
  ctx: QboTokenContext,
  current: { Id: string; SyncToken: string },
  patch: QboCustomerInput,
) {
  // Intuit expects a sparse update with explicit "sparse: true" plus
  // Id and SyncToken. Without sparse, omitting a field deletes it.
  const body = { ...patch, Id: current.Id, SyncToken: current.SyncToken, sparse: true };
  return qboRequest<{ Customer: QboCustomer }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/customer?minorversion=70`,
    body,
  });
}

// ----- Item -------------------------------------------------------------

export type QboItemType = "Service" | "NonInventory" | "Inventory";

export type QboItemInput = {
  Name: string;
  Type: QboItemType;
  IncomeAccountRef: { value: string; name?: string };
  Description?: string;
  UnitPrice?: number; // QBO accepts decimal; cents-to-dollars conversion is the caller's job
  Active?: boolean;
};

export type QboItem = QboItemInput & {
  Id: string;
  SyncToken: string;
};

export function createItem(ctx: QboTokenContext, input: QboItemInput) {
  return qboRequest<{ Item: QboItem }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/item?minorversion=70`,
    body: input,
  });
}

export function updateItem(
  ctx: QboTokenContext,
  current: { Id: string; SyncToken: string },
  patch: Partial<QboItemInput>,
) {
  const body = { ...patch, Id: current.Id, SyncToken: current.SyncToken, sparse: true };
  return qboRequest<{ Item: QboItem }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/item?minorversion=70`,
    body,
  });
}

// ----- Account (read-only for picking IncomeAccountRef on items) --------

export type QboAccount = {
  Id: string;
  Name: string;
  AccountType: string; // "Income", "Expense", "Bank", etc.
  AccountSubType?: string;
  Active: boolean;
};

export async function listIncomeAccounts(ctx: QboTokenContext): Promise<QboResult<QboAccount[]>> {
  const query = `select Id, Name, AccountType, AccountSubType, Active from Account where AccountType = 'Income' and Active = true MAXRESULTS 100`;
  const path = `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
  const res = await qboRequest<{ QueryResponse: { Account?: QboAccount[] } }>({
    ctx,
    method: "GET",
    path,
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: res.data?.QueryResponse?.Account ?? [] };
}

// ----- Hashing ----------------------------------------------------------

/**
 * Stable hash of a payload object so we can skip re-pushing entities
 * whose Snout-side data has not changed since the last successful
 * sync. Order-insensitive at the top level via sorted-key serialization.
 */
export async function payloadHash(payload: unknown): Promise<string> {
  const canonical = canonicalize(payload);
  const buf = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
