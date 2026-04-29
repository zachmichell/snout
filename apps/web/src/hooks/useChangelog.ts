// React Query hooks around the changelog feed. Three reads + two writes:
//   * useChangelogFeed   — published entries (global + org), most recent first
//   * useChangelogDrafts — admin-only drafts for the current org (settings UI)
//   * useChangelogUnreadCount — count of feed entries the current user has
//     not marked as read; powers the bell-icon badge
//   * useMarkChangelogRead — idempotent insert into changelog_reads
//   * useUpsertChangelogEntry / useDeleteChangelogEntry — settings UI mutations
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type ChangelogSeverity = "info" | "update" | "warning" | "critical";
export type ChangelogModule = "daycare" | "boarding" | "grooming" | "training" | "retail";

export type ChangelogEntry = {
  id: string;
  organization_id: string | null;
  title: string;
  body_md: string;
  affects_modules: ChangelogModule[] | null;
  severity: ChangelogSeverity;
  published_at: string | null;
  author_id: string | null;
  created_at: string;
};

const FEED_KEY = "changelog-feed";
const DRAFT_KEY = "changelog-drafts";
const UNREAD_KEY = "changelog-unread";

export function useChangelogFeed() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: [FEED_KEY, membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("changelog_entries")
        .select(
          "id, organization_id, title, body_md, affects_modules, severity, published_at, author_id, created_at",
        )
        .is("deleted_at", null)
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ChangelogEntry[];
    },
  });
}

export function useChangelogDrafts() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: [DRAFT_KEY, membership?.organization_id],
    enabled: !!membership?.organization_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("changelog_entries")
        .select(
          "id, organization_id, title, body_md, affects_modules, severity, published_at, author_id, created_at",
        )
        .eq("organization_id", membership!.organization_id)
        .is("deleted_at", null)
        .is("published_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChangelogEntry[];
    },
  });
}

export function useChangelogUnreadCount() {
  const { user, membership } = useAuth();
  return useQuery({
    queryKey: [UNREAD_KEY, user?.id, membership?.organization_id],
    enabled: !!user?.id && !!membership?.organization_id,
    // Refresh every minute so a freshly published entry shows the badge
    // without requiring a page reload.
    refetchInterval: 60_000,
    queryFn: async () => {
      // Pull the same set the feed query would return, then subtract
      // the user's read entries. This is server-friendly because both
      // queries hit the same partial feed index. We avoid a single
      // joined query because the not-exists pattern blows up under RLS
      // when changelog_reads has its own self-only policy.
      const [{ data: feed, error: fErr }, { data: reads, error: rErr }] =
        await Promise.all([
          supabase
            .from("changelog_entries")
            .select("id")
            .is("deleted_at", null)
            .not("published_at", "is", null)
            .order("published_at", { ascending: false })
            .limit(50),
          supabase
            .from("changelog_reads")
            .select("entry_id")
            .eq("profile_id", user!.id),
        ]);
      if (fErr) throw fErr;
      if (rErr) throw rErr;
      const readSet = new Set((reads ?? []).map((r) => r.entry_id as string));
      const unread = (feed ?? []).filter((e) => !readSet.has(e.id as string));
      return unread.length;
    },
  });
}

export function useMarkChangelogRead() {
  const qc = useQueryClient();
  const { user, membership } = useAuth();
  return useMutation({
    mutationFn: async (entryId: string) => {
      if (!user?.id) throw new Error("Not signed in");
      const { error } = await supabase
        .from("changelog_reads")
        .upsert(
          { profile_id: user.id, entry_id: entryId },
          { onConflict: "profile_id,entry_id", ignoreDuplicates: true },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [UNREAD_KEY, user?.id, membership?.organization_id] });
    },
  });
}

export function useMarkAllChangelogRead() {
  const qc = useQueryClient();
  const { user, membership } = useAuth();
  return useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not signed in");
      // Fetch the feed once and bulk insert read receipts for everything
      // not already marked. Done client-side so the SQL stays simple.
      const { data: feed, error: fErr } = await supabase
        .from("changelog_entries")
        .select("id")
        .is("deleted_at", null)
        .not("published_at", "is", null);
      if (fErr) throw fErr;

      const rows = (feed ?? []).map((e) => ({ profile_id: user.id, entry_id: e.id }));
      if (rows.length === 0) return;
      const { error: insErr } = await supabase
        .from("changelog_reads")
        .upsert(rows, {
          onConflict: "profile_id,entry_id",
          ignoreDuplicates: true,
        });
      if (insErr) throw insErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [UNREAD_KEY, user?.id, membership?.organization_id] });
    },
  });
}

export function useUpsertChangelogEntry() {
  const qc = useQueryClient();
  const { membership, user } = useAuth();
  return useMutation({
    mutationFn: async (vars: {
      id?: string;
      title: string;
      body_md: string;
      severity: ChangelogSeverity;
      affects_modules: ChangelogModule[] | null;
      publish: boolean;
    }) => {
      if (!membership?.organization_id) throw new Error("No organization");
      const payload = {
        organization_id: membership.organization_id,
        title: vars.title,
        body_md: vars.body_md,
        severity: vars.severity,
        affects_modules: vars.affects_modules,
        author_id: user?.id ?? null,
        published_at: vars.publish ? new Date().toISOString() : null,
      };
      if (vars.id) {
        const { error } = await supabase
          .from("changelog_entries")
          .update(payload)
          .eq("id", vars.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("changelog_entries").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [FEED_KEY, membership?.organization_id] });
      qc.invalidateQueries({ queryKey: [DRAFT_KEY, membership?.organization_id] });
      qc.invalidateQueries({ queryKey: [UNREAD_KEY] });
    },
  });
}

export function useDeleteChangelogEntry() {
  const qc = useQueryClient();
  const { membership } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("changelog_entries")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [FEED_KEY, membership?.organization_id] });
      qc.invalidateQueries({ queryKey: [DRAFT_KEY, membership?.organization_id] });
    },
  });
}
