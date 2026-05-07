import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Profile = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
};

type Membership = {
  id: string;
  organization_id: string;
  role: string;
  active: boolean;
};

type AuthCtx = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  membership: Membership | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUserData = async (uid: string) => {
    const [{ data: prof }, { data: mem }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("memberships").select("*").eq("profile_id", uid).eq("active", true).maybeSingle(),
    ]);
    setProfile(prof as Profile | null);
    setMembership(mem as Membership | null);
  };

  const refresh = async () => {
    if (user?.id) await loadUserData(user.id);
  };

  useEffect(() => {
    // Set up listener FIRST.
    //
    // Race fix: on a fresh sign-in, user becomes truthy synchronously
    // here while membership fetch is async. Without flipping loading
    // back to true, route guards (RoleRoute, RequirePermission)
    // would briefly observe `loading=false, user=set, membership=null`
    // and redirect to /onboarding or render "Not authorized" before
    // membership has had a chance to resolve. Keep loading=true while
    // the post-auth membership load is in flight so guards block on
    // the spinner instead.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setLoading(true);
        // Defer Supabase calls (Supabase auth docs warn about calling
        // supabase.from() inside the listener synchronously — schedule
        // it as its own task to avoid the deadlock).
        setTimeout(() => {
          loadUserData(sess.user!.id).finally(() => setLoading(false));
        }, 0);
      } else {
        setProfile(null);
        setMembership(null);
        setLoading(false);
      }
    });

    // Then check existing session
    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) loadUserData(sess.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setMembership(null);
  };

  return (
    <Ctx.Provider value={{ session, user, profile, membership, loading, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
