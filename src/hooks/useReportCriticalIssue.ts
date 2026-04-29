// Hook that posts to the report-critical-issue edge function. The
// non-critical paths use a mailto: opener, not this hook — those don't
// need a server round-trip.
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CriticalIssueInput = {
  summary: string;
  steps?: string;
};

export function useReportCriticalIssue() {
  return useMutation({
    mutationFn: async (input: CriticalIssueInput) => {
      const { data, error } = await supabase.functions.invoke("report-critical-issue", {
        body: {
          severity: "critical",
          summary: input.summary,
          steps: input.steps ?? "",
          current_path: typeof window !== "undefined" ? window.location.pathname : null,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        },
      });
      if (error) throw error;
      return data as { ok: boolean };
    },
  });
}
