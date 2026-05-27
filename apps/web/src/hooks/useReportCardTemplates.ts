import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";
import { parseSections, type RCSection } from "@/lib/reportCardTemplates";

export interface ReportCardTemplate {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  sections: RCSection[];
  is_default: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** List active (non-deleted) report-card templates for the current org. */
export function useReportCardTemplates() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  return useQuery<ReportCardTemplate[]>({
    enabled: !!orgId,
    queryKey: ["report-card-templates", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_card_templates")
        .select("*")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((t: any) => ({
        id: t.id,
        organization_id: t.organization_id,
        name: t.name,
        description: t.description,
        sections: parseSections(t.sections),
        is_default: !!t.is_default,
        active: !!t.active,
        created_at: t.created_at,
        updated_at: t.updated_at,
      }));
    },
  });
}

type UpsertInput = {
  id?: string;
  name: string;
  description: string | null;
  sections: RCSection[];
  is_default: boolean;
};

export function useUpsertReportCardTemplate() {
  const { membership, user } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpsertInput) => {
      if (!orgId) throw new Error("Missing organization");
      if (!input.name.trim()) throw new Error("Template name is required");

      // Only one default at a time — clear others when this one is default.
      if (input.is_default) {
        await supabase
          .from("report_card_templates")
          .update({ is_default: false })
          .eq("organization_id", orgId)
          .neq("id", input.id ?? "00000000-0000-0000-0000-000000000000");
      }

      const payload = {
        organization_id: orgId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        sections: input.sections as any,
        is_default: input.is_default,
        updated_at: new Date().toISOString(),
      };

      if (input.id) {
        const { error } = await supabase
          .from("report_card_templates")
          .update(payload)
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("report_card_templates")
          .insert({ ...payload, created_by: user?.id ?? null });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-card-templates", orgId] });
      toast.success("Template saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save template"),
  });
}

export function useDeleteReportCardTemplate() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Soft delete — keeps any historical references intact.
      const { error } = await supabase
        .from("report_card_templates")
        .update({ deleted_at: new Date().toISOString(), active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-card-templates", orgId] });
      toast.success("Template deleted");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete template"),
  });
}
