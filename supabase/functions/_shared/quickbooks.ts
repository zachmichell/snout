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
  | { ok: false; status: number; error: string; code?: string };

// Intuit error codes the integration handles specifically. Numeric
// strings; we keep them as strings since Intuit returns them that way.
export const QBO_ERROR_DUPLICATE_NAME = "6240";

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
    const message = fault?.Message
      ? fault?.Detail
        ? `${fault.Message}: ${fault.Detail}`
        : fault.Message
      : fault?.Detail ?? parsed?.Fault?.type ?? `QBO returned ${res.status}`;
    const code = fault?.code != null ? String(fault.code) : undefined;
    return { ok: false, status: res.status, error: String(message), code };
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

// ----- Invoice ----------------------------------------------------------

export type QboInvoiceLine =
  | {
      // Line that references a QBO Item (mapped from a Snout service).
      // Amount is the line total in major-unit currency.
      DetailType: "SalesItemLineDetail";
      Amount: number;
      Description?: string;
      SalesItemLineDetail: {
        ItemRef: { value: string; name?: string };
        Qty?: number;
        UnitPrice?: number;
        TaxCodeRef?: { value: string };
      };
    }
  | {
      // Description-only line: used for surcharges, discounts, tips,
      // and any other Snout invoice_lines that don't have a matching
      // Snout service to map to a QBO Item. QBO accepts these without
      // requiring an item ref. Negative Amount is allowed for
      // discounts.
      DetailType: "DescriptionOnly";
      Amount?: number;
      Description: string;
    };

export type QboInvoiceInput = {
  CustomerRef: { value: string; name?: string };
  Line: QboInvoiceLine[];
  DocNumber?: string;
  TxnDate?: string; // YYYY-MM-DD
  DueDate?: string;
  PrivateNote?: string;
  CurrencyRef?: { value: "CAD" | "USD" };
  // Tax handling: TaxExcluded means lines are pre-tax and we set the
  // total tax explicitly via TxnTaxDetail. NotApplicable disables QBO's
  // automated sales tax entirely (used when the company file hasn't
  // configured AST).
  GlobalTaxCalculation?: "TaxExcluded" | "TaxInclusive" | "NotApplicable";
  TxnTaxDetail?: {
    TotalTax?: number;
    TxnTaxCodeRef?: { value: string };
  };
};

export type QboInvoice = QboInvoiceInput & {
  Id: string;
  SyncToken: string;
  TotalAmt?: number;
};

export function createInvoice(ctx: QboTokenContext, input: QboInvoiceInput) {
  return qboRequest<{ Invoice: QboInvoice }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/invoice?minorversion=70`,
    body: input,
  });
}

export function updateInvoice(
  ctx: QboTokenContext,
  current: { Id: string; SyncToken: string },
  patch: QboInvoiceInput,
) {
  // Invoice updates with sparse=true preserve fields we don't include.
  // We send the full Line[] every time because Intuit replaces lines
  // wholesale on update (sparse semantics don't apply at the line level).
  const body = { ...patch, Id: current.Id, SyncToken: current.SyncToken, sparse: true };
  return qboRequest<{ Invoice: QboInvoice }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/invoice?minorversion=70`,
    body,
  });
}

/**
 * Find an Invoice by DocNumber. Used for duplicate-adoption when we
 * detect a prior sync wrote an invoice with the same number. Less
 * common than the customer/item duplicate case; included for
 * symmetry and future-proofing.
 */
export async function findInvoiceByDocNumber(
  ctx: QboTokenContext,
  docNumber: string,
): Promise<QboResult<QboInvoice | null>> {
  const escaped = docNumber.replace(/'/g, "''");
  const query = `select Id, SyncToken, DocNumber from Invoice where DocNumber = '${escaped}' MAXRESULTS 1`;
  const path = `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
  const res = await qboRequest<{ QueryResponse: { Invoice?: QboInvoice[] } }>({
    ctx,
    method: "GET",
    path,
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: res.data?.QueryResponse?.Invoice?.[0] ?? null };
}

// ----- Payment ----------------------------------------------------------

export type QboPaymentLine = {
  // Each line links the payment to one or more invoices. For Snout
  // we always have a 1:1 invoice<->payment relationship.
  Amount: number;
  LinkedTxn: Array<{
    TxnId: string; // QBO Invoice Id
    TxnType: "Invoice";
  }>;
};

export type QboPaymentInput = {
  CustomerRef: { value: string; name?: string };
  TotalAmt: number; // major units
  Line?: QboPaymentLine[];
  TxnDate?: string; // YYYY-MM-DD
  PrivateNote?: string;
  PaymentRefNum?: string; // e.g. Stripe payment_intent id, Helcim transaction id
  CurrencyRef?: { value: "CAD" | "USD" };
  // Where the money lands. Required when QBO has multiple bank /
  // undeposited-funds accounts; we auto-pick on first sync.
  DepositToAccountRef?: { value: string; name?: string };
};

export type QboPayment = QboPaymentInput & {
  Id: string;
  SyncToken: string;
};

export function createPayment(ctx: QboTokenContext, input: QboPaymentInput) {
  return qboRequest<{ Payment: QboPayment }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/payment?minorversion=70`,
    body: input,
  });
}

export function updatePayment(
  ctx: QboTokenContext,
  current: { Id: string; SyncToken: string },
  patch: QboPaymentInput,
) {
  const body = { ...patch, Id: current.Id, SyncToken: current.SyncToken, sparse: true };
  return qboRequest<{ Payment: QboPayment }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/payment?minorversion=70`,
    body,
  });
}

/**
 * Find a Payment by PaymentRefNum (the processor's transaction id).
 * Used for adopt-on-duplicate when the operator has previously
 * imported payments by hand. Less common than customer/item dups but
 * the path costs nothing to provide.
 */
export async function findPaymentByRefNum(
  ctx: QboTokenContext,
  refNum: string,
): Promise<QboResult<QboPayment | null>> {
  const escaped = refNum.replace(/'/g, "''");
  const query = `select Id, SyncToken, PaymentRefNum from Payment where PaymentRefNum = '${escaped}' MAXRESULTS 1`;
  const path = `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
  const res = await qboRequest<{ QueryResponse: { Payment?: QboPayment[] } }>({
    ctx,
    method: "GET",
    path,
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: res.data?.QueryResponse?.Payment?.[0] ?? null };
}

// ----- JournalEntry (6.6a) -----------------------------------------------
//
// We post processor payouts as Journal Entries rather than Deposits.
// QBO's Deposit endpoint rejects validation on Canadian sandboxes
// with multicurrency enabled even with otherwise-valid payloads
// (code 6000 + empty element field — "Select a bank account for
// this deposit"), and we couldn't find a body shape it accepts.
// Journal Entries achieve the identical net GL effect:
//   Debit  Bank          (net = gross - fee)
//   Debit  Fee Expense   (fee)
//   Credit Source        (gross — usually Undeposited Funds)
// They appear correctly in the bank register, P&L, and bank
// reconciliation tools.

export type QboJournalEntryLine = {
  DetailType: "JournalEntryLineDetail";
  Amount: number;
  Description?: string;
  JournalEntryLineDetail: {
    PostingType: "Debit" | "Credit";
    AccountRef: { value: string; name?: string };
    Entity?: { value: string; type: "Customer" | "Vendor" | "Employee" };
  };
};

export type QboJournalEntryInput = {
  Line: QboJournalEntryLine[];
  TxnDate?: string;
  PrivateNote?: string;
  CurrencyRef?: { value: "CAD" | "USD" };
  ExchangeRate?: number;
  DocNumber?: string;
};

export type QboJournalEntry = QboJournalEntryInput & {
  Id: string;
  SyncToken: string;
  TotalAmt?: number;
};

export function createJournalEntry(ctx: QboTokenContext, input: QboJournalEntryInput) {
  return qboRequest<{ JournalEntry: QboJournalEntry }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/journalentry?minorversion=70`,
    body: input,
  });
}

export function updateJournalEntry(
  ctx: QboTokenContext,
  current: { Id: string; SyncToken: string },
  patch: QboJournalEntryInput,
) {
  const body = { ...patch, Id: current.Id, SyncToken: current.SyncToken, sparse: true };
  return qboRequest<{ JournalEntry: QboJournalEntry }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/journalentry?minorversion=70`,
    body,
  });
}

// ----- Deposit (6.6a) ----------------------------------------------------
//
// QBO's Deposit entity records money landing in a bank account from
// one or more sources. For processor-fee accounting we use it like:
//   - Cash In: the gross processor payout (linked to the Payment(s)
//     that fed it via DepositLineDetail.LinkedTxn[]) OR a single
//     summary line referencing Undeposited Funds for that amount.
//   - Cash Out: a NEGATIVE line on the operator's chosen Fee
//     expense account, sized to the processor fees for that payout.
// Net effect: bank account credited by (gross - fee), Undeposited
// Funds debited by gross, Fee Expense debited by fee.

export type QboDepositLine =
  | {
      // Summary line backed by an account (used for the fee line —
      // negative Amount on an Expense / COGS account).
      DetailType: "DepositLineDetail";
      Amount: number;
      Description?: string;
      DepositLineDetail: {
        AccountRef: { value: string; name?: string };
        Entity?: { value: string; type: string };
      };
    }
  | {
      // Linked-transaction line: a payment that previously hit
      // Undeposited Funds gets pulled into the Deposit.
      DetailType: "DepositLineDetail";
      Amount: number;
      Description?: string;
      LinkedTxn: Array<{ TxnId: string; TxnType: "Payment" }>;
      DepositLineDetail: { Entity?: { value: string; type: string } };
    };

export type QboDepositInput = {
  // The bank / current-asset account the money lands in.
  DepositToAccountRef: { value: string; name?: string };
  Line: QboDepositLine[];
  TxnDate?: string;
  PrivateNote?: string;
  CurrencyRef?: { value: "CAD" | "USD" };
};

export type QboDeposit = QboDepositInput & {
  Id: string;
  SyncToken: string;
  TotalAmt?: number;
};

export function createDeposit(ctx: QboTokenContext, input: QboDepositInput) {
  return qboRequest<{ Deposit: QboDeposit }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/deposit?minorversion=70`,
    body: input,
  });
}

export function updateDeposit(
  ctx: QboTokenContext,
  current: { Id: string; SyncToken: string },
  patch: QboDepositInput,
) {
  const body = { ...patch, Id: current.Id, SyncToken: current.SyncToken, sparse: true };
  return qboRequest<{ Deposit: QboDeposit }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/deposit?minorversion=70`,
    body,
  });
}

/**
 * List the operator's liability accounts (Other Current Liability +
 * Long Term Liability) so the QBO settings UI can show a dropdown
 * for Tips Payable / Deferred Revenue choices.
 */
export async function listLiabilityAccounts(ctx: QboTokenContext): Promise<QboResult<QboAccount[]>> {
  // Two queries because QBO query language doesn't accept parenthesized
  // OR. Same pattern as listDepositAccounts / listExpenseAccounts.
  const ocl = `select Id, Name, AccountType, AccountSubType, Active from Account where AccountType = 'Other Current Liability' and Active = true MAXRESULTS 200`;
  const ltl = `select Id, Name, AccountType, AccountSubType, Active from Account where AccountType = 'Long Term Liability' and Active = true MAXRESULTS 200`;
  const [oclRes, ltlRes] = await Promise.all([
    qboRequest<{ QueryResponse: { Account?: QboAccount[] } }>({
      ctx,
      method: "GET",
      path: `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(ocl)}&minorversion=70`,
    }),
    qboRequest<{ QueryResponse: { Account?: QboAccount[] } }>({
      ctx,
      method: "GET",
      path: `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(ltl)}&minorversion=70`,
    }),
  ]);
  if (!oclRes.ok) return oclRes;
  if (!ltlRes.ok) return ltlRes;
  return {
    ok: true,
    status: 200,
    data: [
      ...(oclRes.data?.QueryResponse?.Account ?? []),
      ...(ltlRes.data?.QueryResponse?.Account ?? []),
    ].sort((a, b) => a.Name.localeCompare(b.Name)),
  };
}

/**
 * List the operator's expense accounts so the QBO settings UI can
 * show a dropdown for the fee account choice.
 */
export async function listExpenseAccounts(ctx: QboTokenContext): Promise<QboResult<QboAccount[]>> {
  // Two queries because QBO doesn't accept parenthesized OR.
  const expenseQuery = `select Id, Name, AccountType, AccountSubType, Active from Account where AccountType = 'Expense' and Active = true MAXRESULTS 200`;
  const cogsQuery = `select Id, Name, AccountType, AccountSubType, Active from Account where AccountType = 'Cost of Goods Sold' and Active = true MAXRESULTS 200`;
  const [expRes, cogsRes] = await Promise.all([
    qboRequest<{ QueryResponse: { Account?: QboAccount[] } }>({
      ctx,
      method: "GET",
      path: `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(expenseQuery)}&minorversion=70`,
    }),
    qboRequest<{ QueryResponse: { Account?: QboAccount[] } }>({
      ctx,
      method: "GET",
      path: `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(cogsQuery)}&minorversion=70`,
    }),
  ]);
  if (!expRes.ok) return expRes;
  if (!cogsRes.ok) return cogsRes;
  return {
    ok: true,
    status: 200,
    data: [
      ...(expRes.data?.QueryResponse?.Account ?? []),
      ...(cogsRes.data?.QueryResponse?.Account ?? []),
    ].sort((a, b) => a.Name.localeCompare(b.Name)),
  };
}

// ----- RefundReceipt (6.4b) ----------------------------------------------
//
// QBO's RefundReceipt records money returned to a customer. Unlike
// Payment, it does NOT link back to the original Invoice with LinkedTxn
// — the original Payment stays untouched and the Invoice stays "Paid".
// The RefundReceipt is its own transaction that posts a contra-revenue
// line and a deposit account credit.
//
// Two shapes:
//   - Full refund (refund_amount == original payment amount): mirror
//     the original invoice's lines so each line reverses against the
//     same income account it credited.
//   - Partial refund (refund_amount < original payment amount): a
//     single description-only line for refund_amount. Per-line
//     proration would require operator-side categorization beyond
//     what we currently have on file.

export type QboRefundReceiptLine =
  | {
      DetailType: "SalesItemLineDetail";
      Amount: number;
      Description?: string;
      SalesItemLineDetail: {
        ItemRef: { value: string; name?: string };
        Qty?: number;
        UnitPrice?: number;
        TaxCodeRef?: { value: string };
      };
    }
  | {
      DetailType: "DescriptionOnly";
      Amount?: number;
      Description: string;
    };

export type QboRefundReceiptInput = {
  CustomerRef: { value: string; name?: string };
  TotalAmt?: number; // QBO computes from lines but we send for clarity
  Line: QboRefundReceiptLine[];
  TxnDate?: string;
  PrivateNote?: string;
  PaymentRefNum?: string; // processor's refund txn id, for dedup
  CurrencyRef?: { value: "CAD" | "USD" };
  // Where the refund money comes FROM. Default: same account that
  // received the original Payment, typically Undeposited Funds.
  DepositToAccountRef?: { value: string; name?: string };
  // Tax handling mirrors invoices: TaxExcluded keeps line totals
  // pre-tax and lets QBO compute from per-line TaxCodeRef. NotApplicable
  // disables AST.
  GlobalTaxCalculation?: "TaxExcluded" | "TaxInclusive" | "NotApplicable";
  TxnTaxDetail?: {
    TotalTax?: number;
    TxnTaxCodeRef?: { value: string };
  };
};

export type QboRefundReceipt = QboRefundReceiptInput & {
  Id: string;
  SyncToken: string;
};

export function createRefundReceipt(ctx: QboTokenContext, input: QboRefundReceiptInput) {
  return qboRequest<{ RefundReceipt: QboRefundReceipt }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/refundreceipt?minorversion=70`,
    body: input,
  });
}

export function updateRefundReceipt(
  ctx: QboTokenContext,
  current: { Id: string; SyncToken: string },
  patch: QboRefundReceiptInput,
) {
  const body = { ...patch, Id: current.Id, SyncToken: current.SyncToken, sparse: true };
  return qboRequest<{ RefundReceipt: QboRefundReceipt }>({
    ctx,
    method: "POST",
    path: `/v3/company/${ctx.realmId}/refundreceipt?minorversion=70`,
    body,
  });
}

/**
 * Find a RefundReceipt by PaymentRefNum. Adopt-on-duplicate path —
 * if the operator has manually entered a refund with the same
 * processor txn id, we adopt rather than fail.
 */
export async function findRefundReceiptByRefNum(
  ctx: QboTokenContext,
  refNum: string,
): Promise<QboResult<QboRefundReceipt | null>> {
  const escaped = refNum.replace(/'/g, "''");
  const query = `select Id, SyncToken, PaymentRefNum from RefundReceipt where PaymentRefNum = '${escaped}' MAXRESULTS 1`;
  const path = `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
  const res = await qboRequest<{ QueryResponse: { RefundReceipt?: QboRefundReceipt[] } }>({
    ctx,
    method: "GET",
    path,
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: res.data?.QueryResponse?.RefundReceipt?.[0] ?? null };
}

/**
 * List candidate deposit accounts. Preference order, in callers:
 *   1. Other Current Asset > Undeposited Funds (the "holding" account
 *      QBO uses by default for payments before deposit)
 *   2. Any active Bank account
 *
 * QBO requires DepositToAccountRef when the company has more than
 * one viable account; we pick once and persist on
 * quickbooks_accounts.default_deposit_account_id.
 */
export async function listDepositAccounts(ctx: QboTokenContext): Promise<QboResult<QboAccount[]>> {
  // QBO's query language does NOT support parenthesized OR clauses
  // in WHERE — anything fancier than `field = 'x' AND field = 'y'` is
  // a parse error. Split into two queries and merge in JS so we can
  // still cover both Bank and Undeposited Funds candidates.
  const bankQuery = `select Id, Name, AccountType, AccountSubType, Active from Account where AccountType = 'Bank' and Active = true MAXRESULTS 100`;
  const undepositedQuery = `select Id, Name, AccountType, AccountSubType, Active from Account where AccountSubType = 'UndepositedFunds' and Active = true MAXRESULTS 100`;

  const [bankRes, undepRes] = await Promise.all([
    qboRequest<{ QueryResponse: { Account?: QboAccount[] } }>({
      ctx,
      method: "GET",
      path: `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(bankQuery)}&minorversion=70`,
    }),
    qboRequest<{ QueryResponse: { Account?: QboAccount[] } }>({
      ctx,
      method: "GET",
      path: `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(undepositedQuery)}&minorversion=70`,
    }),
  ]);
  if (!bankRes.ok) return bankRes;
  if (!undepRes.ok) return undepRes;

  const merged: QboAccount[] = [
    ...(bankRes.data?.QueryResponse?.Account ?? []),
    ...(undepRes.data?.QueryResponse?.Account ?? []),
  ];
  // Dedupe by id in case a single account matches both filters somehow.
  const seen = new Set<string>();
  const unique = merged.filter((a) => {
    if (seen.has(a.Id)) return false;
    seen.add(a.Id);
    return true;
  });
  return { ok: true, status: 200, data: unique };
}

// ----- Lookup-by-name (for duplicate adoption) -------------------------

/**
 * Find a Customer in QBO by exact DisplayName. Used when CREATE fails
 * with code 6240 (Duplicate Name Exists Error) so the worker can
 * adopt the existing QBO record into a Snout mapping rather than
 * permanently failing the sync.
 */
export async function findCustomerByDisplayName(
  ctx: QboTokenContext,
  displayName: string,
): Promise<QboResult<QboCustomer | null>> {
  // QBO's query language uses single-quoted string literals; double
  // any embedded apostrophes to escape. The query is run against the
  // company file, so it scans active and inactive customers alike.
  const escaped = displayName.replace(/'/g, "''");
  const query = `select Id, SyncToken, DisplayName, GivenName, FamilyName from Customer where DisplayName = '${escaped}' MAXRESULTS 1`;
  const path = `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
  const res = await qboRequest<{ QueryResponse: { Customer?: QboCustomer[] } }>({
    ctx,
    method: "GET",
    path,
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: res.data?.QueryResponse?.Customer?.[0] ?? null };
}

/** Find an Item by exact Name. Same purpose as findCustomerByDisplayName. */
export async function findItemByName(
  ctx: QboTokenContext,
  name: string,
): Promise<QboResult<QboItem | null>> {
  const escaped = name.replace(/'/g, "''");
  const query = `select Id, SyncToken, Name from Item where Name = '${escaped}' MAXRESULTS 1`;
  const path = `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
  const res = await qboRequest<{ QueryResponse: { Item?: QboItem[] } }>({
    ctx,
    method: "GET",
    path,
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: res.data?.QueryResponse?.Item?.[0] ?? null };
}

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

// ----- TaxCode + TaxRate (6.4.5a) --------------------------------------
//
// QBO's tax model:
//   - TaxRate is the atomic rate (e.g. "GST 5%", "QST 9.975%"). Each
//     belongs to one tax agency.
//   - TaxCode is what gets attached to invoice lines. A TaxCode points
//     at one or more TaxRates via SalesTaxRateList / PurchaseTaxRateList.
//     Combined codes (e.g. "GST/QST") reference multiple rates so a
//     single per-line TaxCodeRef computes the full multi-tax total.
//
// We import both, then derive Snout's per-org cache from the join.

export type QboTaxRate = {
  Id: string;
  Name: string;
  Description?: string;
  Active?: boolean;
  RateValue: number; // Percentage as a decimal: 5 = 5%, 9.975 = 9.975%
  AgencyRef?: { value: string; name?: string };
  TaxReturnLineRef?: { value: string; name?: string };
  EffectiveTaxRate?: Array<{
    RateValue: number;
    EffectiveDate: string;
    EndDate?: string;
  }>;
};

export type QboTaxCode = {
  Id: string;
  Name: string;
  Description?: string;
  Active?: boolean;
  Taxable?: boolean;
  TaxGroup?: boolean;
  // Each list entry is a TaxRateDetail wrapping a TaxRateRef.
  SalesTaxRateList?: {
    TaxRateDetail?: Array<{
      TaxRateRef: { value: string; name?: string };
      TaxTypeApplicable?: string; // "TaxOnAmount" | "TaxOnTaxOnAmount" | etc.
      TaxOrder?: number;
    }>;
  };
  PurchaseTaxRateList?: {
    TaxRateDetail?: Array<{
      TaxRateRef: { value: string; name?: string };
      TaxTypeApplicable?: string;
      TaxOrder?: number;
    }>;
  };
};

/**
 * List every TaxRate visible to the connected QBO realm. We pull both
 * active and inactive (so existing invoices that reference an
 * inactivated rate can still resolve) but mark inactive ones in our
 * cache so the service-attribution UI can hide them.
 */
export async function listTaxRates(ctx: QboTokenContext): Promise<QboResult<QboTaxRate[]>> {
  const query = `select * from TaxRate MAXRESULTS 1000`;
  const path = `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
  const res = await qboRequest<{ QueryResponse: { TaxRate?: QboTaxRate[] } }>({
    ctx,
    method: "GET",
    path,
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: res.data?.QueryResponse?.TaxRate ?? [] };
}

/**
 * List every TaxCode visible to the connected QBO realm. Same active
 * inclusion logic as listTaxRates above.
 */
export async function listTaxCodes(ctx: QboTokenContext): Promise<QboResult<QboTaxCode[]>> {
  const query = `select * from TaxCode MAXRESULTS 1000`;
  const path = `/v3/company/${ctx.realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
  const res = await qboRequest<{ QueryResponse: { TaxCode?: QboTaxCode[] } }>({
    ctx,
    method: "GET",
    path,
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: res.data?.QueryResponse?.TaxCode ?? [] };
}

// =============================================================================
// 6.2.2: per-entity sync helpers used by both the manual batch sync edge
// functions and the auto-sync worker. Centralizes the
// create-vs-update-vs-skip decision, payload-hash check, mapping write, and
// QBO call so adding a new sync type (invoices in 6.3, payments in 6.4) is
// a matter of writing the input mapper and reusing this same control flow.
// =============================================================================

export type EntitySyncOutcome =
  | { ok: true; state: "created" | "updated" | "unchanged"; qboId: string }
  | { ok: false; error: string };

/**
 * Sync one Snout entity to QuickBooks. Idempotent: looks up the
 * existing mapping, computes a hash of the new payload, and decides
 * to create / update / skip based on what changed. Writes the mapping
 * row regardless of outcome so the Failed Syncs panel surfaces failures.
 */
export async function syncOneEntity<T extends { Id: string; SyncToken: string }>(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  orgId: string;
  snoutTable: string;
  snoutId: string;
  qboEntityType: string;
  payload: unknown;
  create: () => Promise<QboResult<{ [key: string]: T } | T>>;
  update: (current: { Id: string; SyncToken: string }) => Promise<QboResult<{ [key: string]: T } | T>>;
  extractIdSyncToken: (data: { [key: string]: T } | T) => { id: string; syncToken: string };
  // Optional: when CREATE fails with QBO_ERROR_DUPLICATE_NAME (6240),
  // call this to find the existing QBO entity by name. If it returns
  // a row, we adopt it (record the mapping, then UPDATE with our
  // payload so QBO ends up with Snout's authoritative data). Returns
  // null when no such entity exists, in which case the original
  // duplicate-name failure is reported to the caller.
  lookupExistingByName?: () => Promise<QboResult<{ Id: string; SyncToken: string } | null>>;
}): Promise<EntitySyncOutcome> {
  const hash = await payloadHash(args.payload);

  // 6.4b: scope mapping lookup by qbo_entity_type so a Snout payment
  // with both a Payment mapping AND a RefundReceipt mapping doesn't
  // collide. The unique index is on
  // (org, snout_table, snout_id, qbo_entity_type).
  const { data: existingRows } = await args.admin
    .from("quickbooks_entity_mappings")
    .select("id, qbo_id, sync_token, payload_hash, sync_state")
    .eq("organization_id", args.orgId)
    .eq("snout_table", args.snoutTable)
    .eq("snout_id", args.snoutId)
    .eq("qbo_entity_type", args.qboEntityType)
    .is("deleted_at", null)
    .maybeSingle();
  const existing = existingRows as
    | {
        id: string;
        qbo_id: string;
        sync_token: string | null;
        payload_hash: string | null;
        sync_state: string;
      }
    | null;

  if (existing && existing.sync_state === "synced" && existing.payload_hash === hash) {
    return { ok: true, state: "unchanged", qboId: existing.qbo_id };
  }

  if (existing && existing.qbo_id && existing.sync_token) {
    const result = await args.update({ Id: existing.qbo_id, SyncToken: existing.sync_token });
    if (!result.ok) {
      await args.admin
        .from("quickbooks_entity_mappings")
        .update({ sync_state: "failed", last_error: result.error })
        .eq("id", existing.id);
      return { ok: false, error: result.error };
    }
    const idTok = args.extractIdSyncToken(result.data);
    await args.admin
      .from("quickbooks_entity_mappings")
      .update({
        sync_token: idTok.syncToken,
        payload_hash: hash,
        sync_state: "synced",
        last_error: null,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return { ok: true, state: "updated", qboId: idTok.id };
  }

  let result = await args.create();

  // Lookup-and-adopt: if QBO rejects the create as a duplicate name
  // and the caller provided a lookup function, find the existing QBO
  // entity by name, mark our mapping with that QBO id+SyncToken, and
  // proceed to UPDATE with our payload. End state: Snout's data is
  // authoritative on the existing QBO record.
  if (!result.ok && result.code === QBO_ERROR_DUPLICATE_NAME && args.lookupExistingByName) {
    const found = await args.lookupExistingByName();
    if (found.ok && found.data) {
      // Conflict guard: another Snout entity might already own this
      // QBO id (two Snout entities with the same DisplayName both
      // resolve to the same QBO customer). Adopting blindly would
      // either silently fail on the partial unique index or, worse,
      // overwrite the existing mapping. Detect and fail with a clear
      // operator-facing message instead.
      const { data: conflict } = await args.admin
        .from("quickbooks_entity_mappings")
        .select("id, snout_id")
        .eq("organization_id", args.orgId)
        .eq("qbo_entity_type", args.qboEntityType)
        .eq("qbo_id", found.data.Id)
        .is("deleted_at", null)
        .neq("snout_id", args.snoutId)
        .maybeSingle();

      if (conflict) {
        const conflictError = `Conflict: another Snout ${args.snoutTable} record (id=${conflict.snout_id}) is already linked to QBO ${args.qboEntityType} ${found.data.Id}. Rename or merge one of the Snout records before retrying.`;
        if (existing) {
          const { error: updErr } = await args.admin
            .from("quickbooks_entity_mappings")
            .update({ sync_state: "failed", last_error: conflictError, payload_hash: hash })
            .eq("id", existing.id);
          if (updErr) console.error("conflict-update mapping failed:", updErr);
        } else {
          const { error: insErr } = await args.admin.from("quickbooks_entity_mappings").insert({
            organization_id: args.orgId,
            snout_table: args.snoutTable,
            snout_id: args.snoutId,
            qbo_entity_type: args.qboEntityType,
            qbo_id: "",
            payload_hash: hash,
            sync_state: "failed",
            last_error: conflictError,
          });
          if (insErr) console.error("conflict-insert mapping failed:", insErr);
        }
        return { ok: false, error: conflictError };
      }

      const updateResult = await args.update({
        Id: found.data.Id,
        SyncToken: found.data.SyncToken,
      });
      if (updateResult.ok) {
        const idTok = args.extractIdSyncToken(updateResult.data);
        if (existing) {
          const { error: mapErr } = await args.admin
            .from("quickbooks_entity_mappings")
            .update({
              qbo_id: idTok.id,
              sync_token: idTok.syncToken,
              payload_hash: hash,
              sync_state: "synced",
              last_error: null,
              last_synced_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          if (mapErr) {
            console.error("adopt-update mapping failed:", mapErr);
            return { ok: false, error: `Mapping update failed: ${mapErr.message}` };
          }
        } else {
          const { error: mapErr } = await args.admin.from("quickbooks_entity_mappings").insert({
            organization_id: args.orgId,
            snout_table: args.snoutTable,
            snout_id: args.snoutId,
            qbo_entity_type: args.qboEntityType,
            qbo_id: idTok.id,
            sync_token: idTok.syncToken,
            payload_hash: hash,
            sync_state: "synced",
            last_synced_at: new Date().toISOString(),
          });
          if (mapErr) {
            console.error("adopt-insert mapping failed:", mapErr);
            return { ok: false, error: `Mapping insert failed: ${mapErr.message}` };
          }
        }
        return { ok: true, state: "updated", qboId: idTok.id };
      }
      // Update after lookup also failed; fall through to record the
      // most recent error (the update's, which is more actionable
      // than the original duplicate-name).
      result = updateResult;
    }
  }

  if (!result.ok) {
    if (existing) {
      await args.admin
        .from("quickbooks_entity_mappings")
        .update({ sync_state: "failed", last_error: result.error, payload_hash: hash })
        .eq("id", existing.id);
    } else {
      await args.admin.from("quickbooks_entity_mappings").insert({
        organization_id: args.orgId,
        snout_table: args.snoutTable,
        snout_id: args.snoutId,
        qbo_entity_type: args.qboEntityType,
        qbo_id: "",
        payload_hash: hash,
        sync_state: "failed",
        last_error: result.error,
      });
    }
    return { ok: false, error: result.error };
  }
  const idTok = args.extractIdSyncToken(result.data);
  if (existing) {
    const { error: mapErr } = await args.admin
      .from("quickbooks_entity_mappings")
      .update({
        qbo_id: idTok.id,
        sync_token: idTok.syncToken,
        payload_hash: hash,
        sync_state: "synced",
        last_error: null,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (mapErr) {
      console.error("create-update mapping failed:", mapErr);
      return { ok: false, error: `Mapping update failed: ${mapErr.message}` };
    }
  } else {
    const { error: mapErr } = await args.admin.from("quickbooks_entity_mappings").insert({
      organization_id: args.orgId,
      snout_table: args.snoutTable,
      snout_id: args.snoutId,
      qbo_entity_type: args.qboEntityType,
      qbo_id: idTok.id,
      sync_token: idTok.syncToken,
      payload_hash: hash,
      sync_state: "synced",
      last_synced_at: new Date().toISOString(),
    });
    if (mapErr) {
      console.error("create-insert mapping failed:", mapErr);
      return { ok: false, error: `Mapping insert failed: ${mapErr.message}` };
    }
  }
  return { ok: true, state: "created", qboId: idTok.id };
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
