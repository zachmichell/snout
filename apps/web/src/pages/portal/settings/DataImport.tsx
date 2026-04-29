import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Upload, Download, Check, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import PortalLayout from "@/components/portal/PortalLayout";
import PageHeader from "@/components/portal/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { parseCsv, downloadCsv, toCsv, type CsvRow } from "@/lib/csv";
import { logActivity } from "@/lib/activity";

type DataType = "owners" | "pets" | "reservations";

type FieldDef = {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
};

const FIELDS: Record<DataType, FieldDef[]> = {
  owners: [
    { key: "first_name", label: "First Name", required: true },
    { key: "last_name", label: "Last Name", required: true },
    { key: "email", label: "Email", hint: "Used to detect duplicates" },
    { key: "phone", label: "Phone" },
    { key: "street_address", label: "Street Address" },
    { key: "city", label: "City" },
    { key: "state_province", label: "State/Province" },
    { key: "postal_code", label: "Postal Code" },
    { key: "notes", label: "Notes" },
  ],
  pets: [
    { key: "name", label: "Pet Name", required: true },
    { key: "species", label: "Species", hint: "dog | cat | other (default: dog)" },
    { key: "breed", label: "Breed" },
    { key: "color", label: "Color" },
    { key: "sex", label: "Sex", hint: "M | F | U" },
    { key: "date_of_birth", label: "Date of Birth", hint: "YYYY-MM-DD" },
    { key: "weight_kg", label: "Weight (kg)" },
    { key: "microchip_id", label: "Microchip ID" },
    { key: "owner_email", label: "Owner Email", hint: "Links to existing owner by email" },
  ],
  reservations: [
    { key: "owner_email", label: "Owner Email", required: true },
    { key: "pet_name", label: "Pet Name", required: true, hint: "Must already exist for this owner" },
    { key: "service_name", label: "Service Name", required: true, hint: "Must match an existing service" },
    { key: "start_at", label: "Start (ISO)", required: true, hint: "e.g. 2026-05-01T09:00:00Z" },
    { key: "end_at", label: "End (ISO)", required: true },
    { key: "notes", label: "Notes" },
  ],
};

const SAMPLE: Record<DataType, string> = {
  owners: `first_name,last_name,email,phone,street_address,city,state_province,postal_code,notes
Jane,Doe,jane@example.com,3065551234,123 Main St,Saskatoon,SK,S7K1A1,VIP customer
John,Smith,john@example.com,3065555678,,,,,
`,
  pets: `name,species,breed,color,sex,date_of_birth,weight_kg,microchip_id,owner_email
Rex,dog,Labrador,Black,M,2020-03-15,28.5,985112000123456,jane@example.com
Whiskers,cat,Domestic Shorthair,Tabby,F,2019-08-01,4.1,,john@example.com
`,
  reservations: `owner_email,pet_name,service_name,start_at,end_at,notes
jane@example.com,Rex,Daycare,2026-05-01T09:00:00Z,2026-05-01T17:00:00Z,Half-day
john@example.com,Whiskers,Boarding,2026-05-03T10:00:00Z,2026-05-06T11:00:00Z,
`,
};

export default function DataImport() {
  const { membership, user } = useAuth();
  const orgId = membership?.organization_id;
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [type, setType] = useState<DataType>("owners");
  const [csvText, setCsvText] = useState<string>("");
  const [parsed, setParsed] = useState<{ headers: string[]; rows: CsvRow[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({}); // field key -> csv column
  const [validation, setValidation] = useState<{ valid: CsvRow[]; errors: Array<{ row: number; reason: string; data: CsvRow }> } | null>(null);
  const [importResult, setImportResult] = useState<{ inserted: number; failed: number } | null>(null);
  const [working, setWorking] = useState(false);

  const fields = FIELDS[type];

  const handleFile = async (f: File | null) => {
    if (!f) return;
    const text = await f.text();
    setCsvText(text);
    const p = parseCsv(text);
    setParsed(p);
    // auto-map by exact header match
    const auto: Record<string, string> = {};
    fields.forEach((fd) => {
      const match = p.headers.find((h) => h.trim().toLowerCase() === fd.key.toLowerCase() || h.trim().toLowerCase() === fd.label.toLowerCase());
      if (match) auto[fd.key] = match;
    });
    setMapping(auto);
    setStep(3);
  };

  const downloadTemplate = () => downloadCsv(`snout-${type}-template.csv`, SAMPLE[type]);

  const mappedRows = useMemo<CsvRow[]>(() => {
    if (!parsed) return [];
    return parsed.rows.map((r) => {
      const out: CsvRow = {};
      fields.forEach((fd) => {
        const col = mapping[fd.key];
        out[fd.key] = col ? (r[col] ?? "") : "";
      });
      return out;
    });
  }, [parsed, mapping, fields]);

  const validate = async () => {
    setWorking(true);
    try {
      const errors: Array<{ row: number; reason: string; data: CsvRow }> = [];
      const valid: CsvRow[] = [];

      // Required fields check
      mappedRows.forEach((r, i) => {
        for (const fd of fields) {
          if (fd.required && !r[fd.key]?.trim()) {
            errors.push({ row: i + 2, reason: `Missing required field: ${fd.label}`, data: r });
            return;
          }
        }
        valid.push(r);
      });

      // Type-specific checks against DB
      if (type === "owners" && orgId) {
        const emails = valid.map((r) => r.email?.trim().toLowerCase()).filter(Boolean) as string[];
        if (emails.length) {
          const { data } = await supabase
            .from("owners").select("email")
            .eq("organization_id", orgId).is("deleted_at", null)
            .in("email", emails);
          const existing = new Set((data ?? []).map((d: any) => d.email?.toLowerCase()));
          const remaining: CsvRow[] = [];
          valid.forEach((r, idx) => {
            const e = r.email?.trim().toLowerCase();
            if (e && existing.has(e)) {
              errors.push({ row: idx + 2, reason: `Duplicate email already in database: ${r.email}`, data: r });
            } else {
              remaining.push(r);
            }
          });
          valid.length = 0; valid.push(...remaining);
        }
      }

      if (type === "pets" && orgId) {
        // Validate optional owner_email actually exists
        const emails = Array.from(new Set(valid.map((r) => r.owner_email?.trim().toLowerCase()).filter(Boolean))) as string[];
        let known = new Set<string>();
        if (emails.length) {
          const { data } = await supabase.from("owners").select("email").eq("organization_id", orgId).is("deleted_at", null).in("email", emails);
          known = new Set((data ?? []).map((d: any) => d.email?.toLowerCase()));
        }
        const remaining: CsvRow[] = [];
        valid.forEach((r, idx) => {
          const e = r.owner_email?.trim().toLowerCase();
          if (e && !known.has(e)) {
            errors.push({ row: idx + 2, reason: `Owner not found for email: ${r.owner_email}`, data: r });
          } else {
            remaining.push(r);
          }
        });
        valid.length = 0; valid.push(...remaining);
      }

      if (type === "reservations" && orgId) {
        // Validate owner exists, pet exists for owner, service exists, dates valid
        const remaining: CsvRow[] = [];
        // Cache lookups
        const ownerByEmail = new Map<string, string>();
        const services = await supabase.from("services").select("id, name").eq("organization_id", orgId);
        const serviceByName = new Map<string, string>();
        (services.data ?? []).forEach((s: any) => serviceByName.set(s.name.toLowerCase(), s.id));

        for (let idx = 0; idx < valid.length; idx++) {
          const r = valid[idx];
          const email = r.owner_email?.trim().toLowerCase();
          const petName = r.pet_name?.trim();
          const svcName = r.service_name?.trim().toLowerCase();
          const startAt = r.start_at?.trim();
          const endAt = r.end_at?.trim();

          if (!startAt || isNaN(Date.parse(startAt))) {
            errors.push({ row: idx + 2, reason: `Invalid start date: ${startAt}`, data: r }); continue;
          }
          if (!endAt || isNaN(Date.parse(endAt))) {
            errors.push({ row: idx + 2, reason: `Invalid end date: ${endAt}`, data: r }); continue;
          }
          if (Date.parse(endAt) <= Date.parse(startAt)) {
            errors.push({ row: idx + 2, reason: `End must be after start`, data: r }); continue;
          }
          if (!svcName || !serviceByName.has(svcName)) {
            errors.push({ row: idx + 2, reason: `Service not found: ${r.service_name}`, data: r }); continue;
          }

          let ownerId = email ? ownerByEmail.get(email) : undefined;
          if (!ownerId && email) {
            const { data: o } = await supabase.from("owners").select("id").eq("organization_id", orgId).is("deleted_at", null).eq("email", email).maybeSingle();
            if (o) { ownerId = o.id; ownerByEmail.set(email, o.id); }
          }
          if (!ownerId) {
            errors.push({ row: idx + 2, reason: `Owner not found: ${r.owner_email}`, data: r }); continue;
          }

          const { data: pet } = await supabase
            .from("pets")
            .select("id, pet_owners!inner(owner_id)")
            .eq("organization_id", orgId).is("deleted_at", null)
            .ilike("name", petName)
            .eq("pet_owners.owner_id", ownerId)
            .maybeSingle();
          if (!pet) {
            errors.push({ row: idx + 2, reason: `Pet "${petName}" not found for owner`, data: r }); continue;
          }

          (r as any).__resolved = { ownerId, petId: pet.id, serviceId: serviceByName.get(svcName) };
          remaining.push(r);
        }
        valid.length = 0; valid.push(...remaining);
      }

      setValidation({ valid, errors });
      setStep(4);
    } finally {
      setWorking(false);
    }
  };

  const runImport = async () => {
    if (!validation || !orgId) return;
    setWorking(true);
    let inserted = 0;
    let failed = 0;
    try {
      if (type === "owners") {
        for (const r of validation.valid) {
          const { error } = await supabase.from("owners").insert({
            organization_id: orgId,
            first_name: r.first_name,
            last_name: r.last_name,
            email: r.email || null,
            phone: r.phone || null,
            street_address: r.street_address || null,
            city: r.city || null,
            state_province: r.state_province || null,
            postal_code: r.postal_code || null,
            notes: r.notes || null,
            communication_preference: "email",
          });
          if (error) failed++; else inserted++;
        }
      } else if (type === "pets") {
        // Pre-resolve owner_email -> owner_id
        const emailToId = new Map<string, string>();
        const emails = Array.from(new Set(validation.valid.map((r) => r.owner_email?.trim().toLowerCase()).filter(Boolean))) as string[];
        if (emails.length) {
          const { data } = await supabase.from("owners").select("id, email").eq("organization_id", orgId).is("deleted_at", null).in("email", emails);
          (data ?? []).forEach((o: any) => emailToId.set(o.email.toLowerCase(), o.id));
        }
        for (const r of validation.valid) {
          const species = (r.species?.trim().toLowerCase() || "dog") as "dog" | "cat" | "other";
          const sex = (r.sex?.trim().toUpperCase() || "U") as "M" | "F" | "U";
          const weight = r.weight_kg ? Number(r.weight_kg) : null;
          const dob = r.date_of_birth || null;
          const { data: pet, error } = await supabase.from("pets").insert({
            organization_id: orgId,
            name: r.name,
            species: ["dog", "cat", "other"].includes(species) ? species : "dog",
            breed: r.breed || null,
            color: r.color || null,
            sex: ["M", "F", "U"].includes(sex) ? sex : "U",
            date_of_birth: dob,
            weight_kg: weight && !isNaN(weight) ? weight : null,
            microchip_id: r.microchip_id || null,
          }).select("id").single();
          if (error || !pet) { failed++; continue; }
          inserted++;
          const ownerId = emailToId.get(r.owner_email?.trim().toLowerCase() ?? "");
          if (ownerId) {
            await supabase.from("pet_owners").insert({
              organization_id: orgId, pet_id: pet.id, owner_id: ownerId, relationship: "primary",
            });
          }
        }
      } else if (type === "reservations") {
        for (const r of validation.valid) {
          const resolved = (r as any).__resolved as { ownerId: string; petId: string; serviceId: string };
          const { data: res, error } = await supabase.from("reservations").insert({
            organization_id: orgId,
            primary_owner_id: resolved.ownerId,
            service_id: resolved.serviceId,
            start_at: new Date(r.start_at).toISOString(),
            end_at: new Date(r.end_at).toISOString(),
            notes: r.notes || null,
            source: "staff_created",
            status: "confirmed",
            created_by: user?.id ?? null,
          }).select("id").single();
          if (error || !res) { failed++; continue; }
          inserted++;
          await supabase.from("reservation_pets").insert({
            organization_id: orgId, reservation_id: res.id, pet_id: resolved.petId,
          });
        }
      }

      await logActivity({
        organization_id: orgId,
        action: "imported",
        entity_type: "import",
        metadata: { type, inserted, failed, skipped: validation.errors.length },
      });

      setImportResult({ inserted, failed });
      setStep(5);
      toast.success(`Imported ${inserted} ${type}${failed ? ` (${failed} failed)` : ""}`);
    } finally {
      setWorking(false);
    }
  };

  const reset = () => {
    setStep(1); setCsvText(""); setParsed(null); setMapping({}); setValidation(null); setImportResult(null);
  };

  const downloadErrors = () => {
    if (!validation?.errors.length) return;
    const csv = toCsv(
      validation.errors.map((e) => ({ row: e.row, reason: e.reason, ...e.data })),
    );
    downloadCsv(`import-errors-${type}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <PortalLayout>
      <div className="px-8 py-6">
        <PageHeader
          title="Data Import"
          description="Bring existing customer, pet, and booking data into Snout from a CSV file."
        />

        <Stepper step={step} />

        <div className="mt-6 rounded-lg border border-border bg-surface p-6 shadow-card">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <Label>What do you want to import?</Label>
                <Select value={type} onValueChange={(v) => { setType(v as DataType); setMapping({}); }}>
                  <SelectTrigger className="mt-2 max-w-sm bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owners">Owners</SelectItem>
                    <SelectItem value="pets">Pets</SelectItem>
                    <SelectItem value="reservations">Reservations</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-md border border-border-subtle bg-background p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FileSpreadsheet className="h-4 w-4 text-primary" /> Sample CSV template
                </div>
                <p className="text-xs text-text-secondary">Download a template, fill it in with your data, then upload it on the next step.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={downloadTemplate}>
                  <Download className="h-4 w-4" /> Download {type} template
                </Button>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setStep(2)}>Next: Upload CSV</Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <Label>Upload your CSV</Label>
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  className="mt-2 max-w-md bg-background"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
                <p className="mt-2 text-xs text-text-tertiary">First row should contain column headers.</p>
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              </div>
            </div>
          )}

          {step === 3 && parsed && (
            <div className="space-y-5">
              <div>
                <h3 className="font-display text-base font-semibold text-foreground">Map columns</h3>
                <p className="text-sm text-text-secondary">Match each Snout field to a column in your CSV. Required fields are marked.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {fields.map((fd) => (
                  <div key={fd.key} className="rounded-md border border-border-subtle bg-background p-3">
                    <Label className="text-xs">
                      {fd.label} {fd.required && <span className="text-destructive">*</span>}
                    </Label>
                    {fd.hint && <p className="text-[11px] text-text-tertiary">{fd.hint}</p>}
                    <Select
                      value={mapping[fd.key] ?? "__none"}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [fd.key]: v === "__none" ? "" : v }))}
                    >
                      <SelectTrigger className="mt-2 bg-surface"><SelectValue placeholder="Select column…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">— skip —</SelectItem>
                        {parsed.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                <div className="flex gap-2">
                  <span className="self-center text-xs text-text-secondary">{parsed.rows.length} rows detected</span>
                  <Button onClick={() => setStep(4)} disabled={fields.some((f) => f.required && !mapping[f.key])}>
                    Preview
                  </Button>
                </div>
              </div>
            </div>
          )}

          {step === 4 && parsed && (
            <div className="space-y-5">
              <div>
                <h3 className="font-display text-base font-semibold text-foreground">Preview & validate</h3>
                <p className="text-sm text-text-secondary">First 5 mapped rows. Click Validate to check the full file.</p>
              </div>
              <div className="overflow-auto rounded-md border border-border-subtle">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-background text-left">
                      {fields.map((f) => <th key={f.key} className="px-3 py-2 label-eyebrow">{f.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {mappedRows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-border-subtle">
                        {fields.map((f) => <td key={f.key} className="px-3 py-2 text-text-secondary">{r[f.key] || "—"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!validation && (
                <div className="flex items-center justify-between">
                  <Button variant="outline" onClick={() => setStep(3)}>Back to mapping</Button>
                  <Button onClick={validate} disabled={working}>
                    {working ? "Validating…" : "Validate"}
                  </Button>
                </div>
              )}

              {validation && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md border border-border-subtle bg-background p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-success-foreground">
                        <Check className="h-4 w-4" /> Ready to import
                      </div>
                      <div className="mt-1 text-2xl font-display font-bold">{validation.valid.length}</div>
                    </div>
                    <div className="rounded-md border border-border-subtle bg-background p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-warning-foreground">
                        <AlertTriangle className="h-4 w-4" /> Skipped (errors)
                      </div>
                      <div className="mt-1 text-2xl font-display font-bold">{validation.errors.length}</div>
                      {validation.errors.length > 0 && (
                        <Button variant="outline" size="sm" className="mt-2" onClick={downloadErrors}>
                          <Download className="h-4 w-4" /> Download error report
                        </Button>
                      )}
                    </div>
                  </div>

                  {validation.errors.length > 0 && (
                    <div className="max-h-48 overflow-auto rounded-md border border-border-subtle bg-background p-3 text-xs">
                      <div className="mb-2 font-semibold text-foreground">First 10 errors:</div>
                      <ul className="space-y-1 text-text-secondary">
                        {validation.errors.slice(0, 10).map((e, i) => (
                          <li key={i}>Row {e.row}: {e.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <Button variant="outline" onClick={() => setValidation(null)}>Re-validate</Button>
                    <Button onClick={runImport} disabled={working || validation.valid.length === 0}>
                      {working ? "Importing…" : `Import ${validation.valid.length} valid rows`}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 5 && importResult && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-light">
                <Check className="h-6 w-6 text-success-foreground" />
              </div>
              <h3 className="font-display text-xl font-semibold text-foreground">Import complete</h3>
              <p className="text-sm text-text-secondary">
                {importResult.inserted} {type} imported.
                {importResult.failed > 0 && ` ${importResult.failed} failed during write.`}
                {validation && validation.errors.length > 0 && ` ${validation.errors.length} skipped during validation.`}
              </p>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={reset}>Import another file</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}

function Stepper({ step }: { step: number }) {
  const labels = ["Type", "Upload", "Map", "Validate", "Done"];
  return (
    <div className="mt-4 flex items-center gap-2">
      {labels.map((l, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={l} className="flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
              active ? "bg-primary text-primary-foreground" : done ? "bg-success-light text-success-foreground" : "bg-background text-text-tertiary"
            }`}>{done ? <Check className="h-3.5 w-3.5" /> : n}</div>
            <span className={`text-xs ${active ? "font-semibold text-foreground" : "text-text-secondary"}`}>{l}</span>
            {i < labels.length - 1 && <span className="mx-1 text-text-tertiary">→</span>}
          </div>
        );
      })}
    </div>
  );
}
