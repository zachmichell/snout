import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useOwnerRecord } from "./useOwnerRecord";

export type WaiverStatus = "signed" | "outdated" | "unsigned";

export type WaiverWithStatus = {
  id: string;
  title: string;
  body: string;
  version: number;
  status: WaiverStatus;
  signed_at: string | null;
  signed_version: number | null;
  signature_data: string | null;
};

export function useOwnerWaivers() {
  const { membership } = useAuth();
  const { data: owner } = useOwnerRecord();
  return useQuery({
    queryKey: ["owner-waivers-list", owner?.id, membership?.organization_id],
    enabled: !!owner?.id && !!membership?.organization_id,
    queryFn: async (): Promise<WaiverWithStatus[]> => {
      const [{ data: waivers, error: wErr }, { data: sigs, error: sErr }] = await Promise.all([
        supabase
          .from("waivers")
          .select("id, title, body, version")
          .eq("organization_id", membership!.organization_id)
          .eq("active", true)
          .is("deleted_at", null)
          .order("title", { ascending: true }),
        supabase
          .from("waiver_signatures")
          .select("waiver_id, waiver_version, signed_at, signature_data")
          .eq("owner_id", owner!.id)
          .order("signed_at", { ascending: false }),
      ]);
      if (wErr) throw wErr;
      if (sErr) throw sErr;
      // Latest signature per waiver_id
      const latestByWaiver = new Map<string, any>();
      for (const s of sigs ?? []) {
        if (!latestByWaiver.has(s.waiver_id)) latestByWaiver.set(s.waiver_id, s);
      }
      return (waivers ?? []).map((w: any) => {
        const sig = latestByWaiver.get(w.id);
        let status: WaiverStatus = "unsigned";
        if (sig) status = sig.waiver_version >= w.version ? "signed" : "outdated";
        return {
          id: w.id,
          title: w.title,
          body: w.body,
          version: w.version,
          status,
          signed_at: sig?.signed_at ?? null,
          signed_version: sig?.waiver_version ?? null,
          signature_data: sig?.signature_data ?? null,
        };
      });
    },
  });
}

export function useOwnerWaiver(id: string | undefined) {
  const { membership } = useAuth();
  const { data: owner } = useOwnerRecord();
  return useQuery({
    queryKey: ["owner-waiver", id, owner?.id],
    enabled: !!id && !!owner?.id && !!membership?.organization_id,
    queryFn: async () => {
      const { data: waiver, error } = await supabase
        .from("waivers")
        .select("id, title, body, version, organization_id")
        .eq("id", id!)
        .eq("organization_id", membership!.organization_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!waiver) return null;
      const { data: sigs, error: sErr } = await supabase
        .from("waiver_signatures")
        .select("waiver_version, signed_at, signature_data")
        .eq("waiver_id", waiver.id)
        .eq("owner_id", owner!.id)
        .order("signed_at", { ascending: false })
        .limit(1);
      if (sErr) throw sErr;
      const sig = sigs?.[0] ?? null;
      const status: WaiverStatus = !sig
        ? "unsigned"
        : sig.waiver_version >= waiver.version
          ? "signed"
          : "outdated";
      return {
        ...waiver,
        status,
        signed_at: sig?.signed_at ?? null,
        signed_version: sig?.waiver_version ?? null,
        signature_data: sig?.signature_data ?? null,
      };
    },
    retry: false,
  });
}
