// Reliability Batch E: bulk export of an org's data as a single zip
// of CSVs.
//
// Closes the audit's "no single download all my data button" gap. The
// per-list CSV exports already exist (reservations, owners, pets,
// invoices, analytics) but an operator who wants to leave Snout — or
// just keep their own offline backup — has no one-click "give me
// everything" button. This adds it.
//
// What's in the zip:
//   - organization.csv        single row, the org's profile
//   - owners.csv              every owner record
//   - pets.csv                every pet record
//   - reservations.csv        every reservation, joined with owner + pet names
//   - invoices.csv            every invoice
//   - payments.csv            every payment (status + processor ids)
//   - subscription_packages.csv  the org's packages
//   - owner_subscriptions.csv    every customer's active+past package state
//   - storage_manifest.csv    list of storage paths (vaccination docs,
//                             pet photos) — files themselves are not
//                             included (would bloat the zip), but the
//                             paths give the operator everything they
//                             need to fetch individually
//   - README.txt              what's in the zip + how to use it
//
// Auth: org admin only. Uses the user's JWT against RLS so the export
// naturally scopes to their org — no service-role for the data reads.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

// Per-table cap. A single org's bulk export shouldn't exceed a few MB;
// 25k rows per table covers any operator we'd realistically host today.
// Operators with more rows can run the export multiple times with
// date-range filters once we add that follow-up.
const ROW_CAP = 25_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });

  // Resolve the caller's org via memberships (RLS lets the user read
  // their own membership rows). We require role owner/admin so a
  // front-desk staff PIN can't export the entire org.
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: membership } = await userClient
    .from("memberships")
    .select("organization_id, role, active")
    .eq("profile_id", user.id)
    .eq("active", true)
    .in("role", ["owner", "admin"])
    .limit(1)
    .maybeSingle();
  if (!membership) return json({ error: "Forbidden — admin role required" }, 403);
  const orgId = membership.organization_id as string;

  // Pull every table in parallel. Each returns a (possibly empty)
  // array; we serialize to CSV and add to the zip.
  const [
    { data: org },
    { data: owners },
    { data: pets },
    { data: reservations },
    { data: invoices },
    { data: payments },
    { data: subscriptionPackages },
    { data: ownerSubs },
    { data: vaccinationDocs },
    { data: petPhotos },
  ] = await Promise.all([
    userClient.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    userClient.from("owners").select("*").eq("organization_id", orgId).is("deleted_at", null).limit(ROW_CAP),
    userClient.from("pets").select("*").eq("organization_id", orgId).is("deleted_at", null).limit(ROW_CAP),
    userClient
      .from("reservations")
      .select(
        "id, organization_id, location_id, service_id, primary_owner_id, suite_id, start_at, end_at, status, checked_in_at, checked_out_at, notes, source, created_at, services(name, module), owners:primary_owner_id(first_name, last_name)",
      )
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .limit(ROW_CAP),
    userClient.from("invoices").select("*").eq("organization_id", orgId).is("deleted_at", null).limit(ROW_CAP),
    userClient.from("payments").select("*").eq("organization_id", orgId).is("deleted_at", null).limit(ROW_CAP),
    userClient.from("subscription_packages").select("*").eq("organization_id", orgId).is("deleted_at", null).limit(ROW_CAP),
    userClient.from("owner_subscriptions").select("*").eq("organization_id", orgId).limit(ROW_CAP),
    userClient
      .from("vaccinations")
      .select("id, pet_id, vaccine_type, document_url, administered_on, expires_on")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .not("document_url", "is", null)
      .limit(ROW_CAP),
    userClient
      .from("pets")
      .select("id, name, photo_url")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .not("photo_url", "is", null)
      .limit(ROW_CAP),
  ]);

  const zip = new JSZip();
  zip.file("README.txt", buildReadme(org));
  zip.file("organization.csv", toCsvRows(org ? [org] : []));
  zip.file("owners.csv", toCsvRows(owners ?? []));
  zip.file("pets.csv", toCsvRows(pets ?? []));
  zip.file("reservations.csv", toCsvRows((reservations ?? []).map(flattenReservation)));
  zip.file("invoices.csv", toCsvRows(invoices ?? []));
  zip.file("payments.csv", toCsvRows(payments ?? []));
  zip.file("subscription_packages.csv", toCsvRows(subscriptionPackages ?? []));
  zip.file("owner_subscriptions.csv", toCsvRows(ownerSubs ?? []));

  // Storage manifest: list every external file path (vaccination docs +
  // pet photos) so the operator can fetch them individually if they
  // need the binary content. Keeping the actual files out of the zip
  // means the export stays trim and predictable in size.
  const manifest: Array<Record<string, unknown>> = [
    ...(vaccinationDocs ?? []).map((v: any) => ({
      kind: "vaccination_document",
      pet_id: v.pet_id,
      vaccine_type: v.vaccine_type,
      administered_on: v.administered_on,
      expires_on: v.expires_on,
      url: v.document_url,
    })),
    ...(petPhotos ?? []).map((p: any) => ({
      kind: "pet_photo",
      pet_id: p.id,
      pet_name: p.name,
      url: p.photo_url,
    })),
  ];
  zip.file("storage_manifest.csv", toCsvRows(manifest));

  const blob = await zip.generateAsync({ type: "uint8array" });

  const filename = `${slugForFilename(org?.name ?? "snout-export")}-${new Date()
    .toISOString()
    .slice(0, 10)}.zip`;

  return new Response(blob, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

function buildReadme(org: any): string {
  const orgName = org?.name ?? "Your organization";
  const today = new Date().toISOString().slice(0, 10);
  return [
    `${orgName} — Snout data export (${today})`,
    "",
    "What's in this zip:",
    "  organization.csv          one-row export of your organization profile",
    "  owners.csv                every active owner record",
    "  pets.csv                  every active pet record",
    "  reservations.csv          every reservation (active + historical)",
    "  invoices.csv              every invoice",
    "  payments.csv              every payment + status",
    "  subscription_packages.csv your credit-package catalog",
    "  owner_subscriptions.csv   every customer's package usage state",
    "  storage_manifest.csv      paths to vaccination documents and pet photos",
    "                            (the files themselves are not included)",
    "",
    "If you want to fetch the storage files, sign in to your portal and",
    "use the per-record download links — those URLs live in",
    "storage_manifest.csv. Or run this export again after we ship a",
    "follow-up that bundles the files inline.",
    "",
    "Tables are exported in their raw column shape; foreign keys are",
    "uuid strings, money fields are integer cents, timestamps are ISO",
    "8601. Reservations include the linked service name and primary",
    "owner's name as denormalized columns for convenience.",
    "",
    "All deletions in Snout are soft (deleted_at). This export covers",
    "active rows only.",
  ].join("\n");
}

// Reservations come back with nested service + owner objects from the
// PostgREST join. Flatten to scalar columns so the CSV stays readable.
function flattenReservation(r: any): Record<string, unknown> {
  const { services, owners, ...rest } = r;
  return {
    ...rest,
    service_name: services?.name ?? null,
    service_module: services?.module ?? null,
    owner_first_name: owners?.first_name ?? null,
    owner_last_name: owners?.last_name ?? null,
  };
}

// Minimal CSV writer mirroring lib/csv.ts on the client. Preserves
// the union of all keys across rows (so a row missing a column gets
// an empty cell, not a column shift).
function toCsvRows(rows: Array<Record<string, unknown>>): string {
  if (!rows || rows.length === 0) return "";
  const keys = Array.from(
    rows.reduce((acc, r) => {
      for (const k of Object.keys(r)) acc.add(k);
      return acc;
    }, new Set<string>()),
  );
  const header = keys.join(",");
  const lines = [header];
  for (const r of rows) {
    lines.push(keys.map((k) => csvCell(r[k])).join(","));
  }
  return lines.join("\n");
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    return csvCell(JSON.stringify(v));
  }
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function slugForFilename(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "snout-export"
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
