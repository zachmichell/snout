import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import Logo from "@/components/portal/Logo";
import { useAuth } from "@/hooks/useAuth";

const STAFF_ROLES = ["owner", "admin", "manager", "staff"];

export default function Login() {
  const navigate = useNavigate();
  const { user, membership, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Role-based redirect: customer -> /portal/dashboard, staff -> /dashboard.
  // Driven by the auth context so we wait for membership to load instead
  // of guessing /dashboard and getting "Not authorized" when the user is
  // a customer. Fires either after a fresh sign-in (submitted=true) or
  // when the user is already authenticated and lands on /login (e.g.,
  // returning from a magic link).
  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    if (!membership) return;
    if (!submitted && !user) return; // belt-and-suspenders
    const target = STAFF_ROLES.includes(membership.role)
      ? "/dashboard"
      : "/portal/dashboard";
    navigate(target, { replace: true });
  }, [authLoading, user, membership, submitted, navigate]);

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    setSubmitted(true);
    // Navigation handled by the effect above once membership resolves.
  };

  const handleMagic = async () => {
    if (!email) return toast.error("Enter your email first");
    setMagicLoading(true);
    // Magic link sends users back to /login; the effect above will then
    // route them to the right portal based on their role.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    setMagicLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Check your email for a magic link.");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <div className="rounded-lg border border-border bg-surface p-8 shadow-card">
          <h1 className="font-display text-2xl">Welcome back</h1>
          <p className="mt-1 text-sm text-text-secondary">Sign in to your Snout account.</p>

          <form onSubmit={handlePassword} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="off"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] uppercase tracking-wider text-text-tertiary">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={handleMagic} disabled={magicLoading}>
            {magicLoading ? "Sending…" : "Email me a magic link"}
          </Button>

          <p className="mt-6 text-center text-sm text-text-secondary">
            Don't have an account?{" "}
            <Link to="/signup" className="font-medium text-primary hover:text-primary-hover">Sign up</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
