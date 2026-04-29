import { supabase } from "@/integrations/supabase/client";
import type { DataType, DuplicateMode, ImportResult, SourceSystem, ValidatedRow } from "./types";

type Progress = (done: number, total: number) => void;

const OWNER_BATCH_SIZE = 200;

export async function executeImport(
  dataType: DataType,
  rows: ValidatedRow[],
  organizationId: string,
  onProgress: Progress,
  sourceSystem: SourceSystem = "other",
  duplicateMode: DuplicateMode = "skip",
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errored: 0, errorRows: [] };

  // Apply duplicate mode filtering
  const allIncluded = rows.filter((r) => r.include);
  let toImport = allIncluded;
  if (duplicateMode === "skip") {
    const before = toImport.length;
    toImport = toImport.filter((r) => !r.isDuplicate);
    result.skipped += before - toImport.length;
  }
  result.skipped += rows.length - allIncluded.length;
  const total = toImport.length;

  // Pre-load services for reservations
  const serviceMap = new Map<string, string>();
  if (dataType === "reservations") {
    const { data: services } = await supabase
      .from("services")
      .select("id, name")
      .eq("organization_id", organizationId)
      .is("deleted_at", null);
    for (const s of services ?? []) serviceMap.set(s.name.toLowerCase(), s.id);
  }

  // ===== OWNERS: batched inserts (skip & new) or per-row update (overwrite) =====
  if (dataType === "owners") {
    if (duplicateMode === "overwrite") {
      // Per-row: insert new, update existing duplicates
      for (let i = 0; i < toImport.length; i++) {
        const row = toImport[i];
        try {
          const payload = ownerPayload(row, organizationId, sourceSystem);
          if (row.isDuplicate && row.duplicateOfId) {
            const { error } = await supabase
              .from("owners")
              .update(payload)
              .eq("id", row.duplicateOfId);
            if (error) throw error;
          } else {
            const { error } = await supabase.from("owners").insert(payload);
            if (error) throw error;
          }
          result.imported++;
        } catch (err: any) {
          result.errored++;
          result.errorRows.push({
            row: row.index + 2,
            reason: err.message ?? String(err),
            data: row.raw,
          });
        }
        onProgress(i + 1, total);
      }
      return result;
    }

    for (let start = 0; start < toImport.length; start += OWNER_BATCH_SIZE) {
      const batch = toImport.slice(start, start + OWNER_BATCH_SIZE);
      const payload = batch.map((row) => ownerPayload(row, organizationId, sourceSystem));

      const { error, count } = await supabase
        .from("owners")
        .insert(payload, { count: "exact" });

      if (error) {
        for (const row of batch) {
          try {
            const { error: rowErr } = await supabase
              .from("owners")
              .insert(ownerPayload(row, organizationId, sourceSystem));
            if (rowErr) throw rowErr;
            result.imported++;
          } catch (err: any) {
            result.errored++;
            result.errorRows.push({
              row: row.index + 2,
              reason: err.message ?? String(err),
              data: row.raw,
            });
          }
        }
      } else {
        result.imported += count ?? batch.length;
      }
      onProgress(Math.min(start + batch.length, total), total);
    }
    return result;
  }

  // ===== Other types: per-row =====
  for (let i = 0; i < toImport.length; i++) {
    const row = toImport[i];
    try {
      if (dataType === "pets") {
        let petId: string | null = null;

        if (duplicateMode === "overwrite" && row.isDuplicate && row.duplicateOfId) {
          // Update existing pet
          const { error } = await supabase
            .from("pets")
            .update(petPayload(row, organizationId, sourceSystem, false) as any)
            .eq("id", row.duplicateOfId);
          if (error) throw error;
          petId = row.duplicateOfId;
        } else {
          const { data: pet, error } = await supabase
            .from("pets")
            .insert(petPayload(row, organizationId, sourceSystem, true) as any)
            .select("id")
            .single();
          if (error) throw error;
          petId = pet?.id ?? null;
        }

        // Link to owner if newly created and we have one
        if (petId && row.mapped._owner_id && !(duplicateMode === "overwrite" && row.isDuplicate)) {
          const { error: linkErr } = await supabase.from("pet_owners").insert({
            organization_id: organizationId,
            pet_id: petId,
            owner_id: row.mapped._owner_id,
            relationship: "primary",
          });
          if (linkErr) throw linkErr;
        }
      } else if (dataType === "vaccinations") {
        const { error } = await supabase.from("vaccinations").insert({
          organization_id: organizationId,
          pet_id: row.mapped._pet_id,
          vaccine_type: row.mapped.vaccine_type,
          administered_on: row.mapped.administered_on,
          expires_on: row.mapped.expires_on,
          vet_name: row.mapped.vet_name,
          vet_clinic: row.mapped.vet_clinic,
          verified: false,
        });
        if (error) throw error;
      } else if (dataType === "reservations") {
        const serviceId = row.mapped.service_name
          ? serviceMap.get(row.mapped.service_name.toLowerCase())
          : null;
        const { data: res, error } = await supabase
          .from("reservations")
          .insert({
            organization_id: organizationId,
            primary_owner_id: row.mapped._owner_id,
            service_id: serviceId,
            start_at: row.mapped.start_at,
            end_at: row.mapped.end_at,
            status: "checked_out",
            source: "staff_created",
            notes: row.mapped.notes,
          })
          .select("id")
          .single();
        if (error) throw error;
        if (res) {
          const { error: rpErr } = await supabase.from("reservation_pets").insert({
            organization_id: organizationId,
            reservation_id: res.id,
            pet_id: row.mapped._pet_id,
          });
          if (rpErr) throw rpErr;
        }
      }
      result.imported++;
    } catch (err: any) {
      result.errored++;
      result.errorRows.push({
        row: row.index + 2,
        reason: err.message ?? String(err),
        data: row.raw,
      });
    }
    onProgress(i + 1, total);
  }

  return result;
}

function ownerPayload(row: ValidatedRow, organizationId: string, sourceSystem: SourceSystem) {
  return {
    organization_id: organizationId,
    first_name: row.mapped.first_name || null,
    last_name: row.mapped.last_name || null,
    email: row.mapped.email || null,
    phone: row.mapped.phone || null,
    street_address: row.mapped.street_address || null,
    city: row.mapped.city || null,
    state_province: row.mapped.state_province || null,
    postal_code: row.mapped.postal_code || null,
    notes: row.mapped.notes || null,
    external_id: row.mapped.external_id || null,
    external_source: row.mapped.external_id ? sourceSystem : null,
  };
}

function petPayload(
  row: ValidatedRow,
  organizationId: string,
  sourceSystem: SourceSystem,
  includeOrg: boolean,
) {
  const base: Record<string, any> = {
    name: row.mapped.name,
    species: row.mapped.species,
    breed: row.mapped.breed || null,
    sex: row.mapped.sex,
    date_of_birth: row.mapped.date_of_birth || null,
    weight_kg: row.mapped.weight_kg ?? null,
    color: row.mapped.color || null,
    microchip_id: row.mapped.microchip_id || null,
    spayed_neutered: row.mapped.spayed_neutered ?? null,
    behavioral_notes: row.mapped.behavioral_notes || null,
    external_id: row.mapped.external_id || null,
    external_source: row.mapped.external_id ? sourceSystem : null,
  };
  if (includeOrg) base.organization_id = organizationId;
  return base;
}
