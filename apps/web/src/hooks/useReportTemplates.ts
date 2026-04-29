import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

export type ReportConfig = {
  dimensions: string[]; // e.g. ['date','service','owner','pet','staff']
  metrics: string[]; // e.g. ['count','revenue','duration']
  filters: { field: string; op: string; value: string }[];
  source: "reservations" | "invoices" | "grooming";
};

export type ReportTemplate = {
  id: string;
  organization_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  config: ReportConfig;
  created_at: string;
  updated_at: string;
};

export function useReportTemplates() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  return useQuery<ReportTemplate[]>({
    enabled: !!orgId,
    queryKey: ["report-templates", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_templates")
        .select("*")
        .eq("organization_id", orgId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ReportTemplate[];
    },
  });
}

export function useSaveReportTemplate() {
  const { membership, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; config: ReportConfig; id?: string }) => {
      if (!membership?.organization_id) throw new Error("no org");
      if (input.id) {
        const { error } = await supabase
          .from("report_templates")
          .update({
            name: input.name,
            description: input.description ?? null,
            config: input.config as never,
          })
          .eq("id", input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await supabase
        .from("report_templates")
        .insert({
          organization_id: membership.organization_id,
          created_by: user?.id ?? null,
          name: input.name,
          description: input.description ?? null,
          config: input.config as never,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-templates"] });
      toast.success("Report saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Could not save"),
  });
}

export function useDeleteReportTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("report_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-templates"] });
      toast.success("Template deleted");
    },
    onError: (e: any) => toast.error(e.message ?? "Could not delete"),
  });
}
