import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Check } from "lucide-react";
import Logo from "@/components/portal/Logo";
import { CURRENCY_BY_COUNTRY, TIMEZONE_BY_COUNTRY, TIMEZONE_OPTIONS, slugify } from "@/lib/timezones";

type Country = "CA" | "US";

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, membership, loading: authLoading, refresh } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [country, setCountry] = useState<Country>("CA");
  const [timezone, setTimezone] = useState("America/Regina");

  // Created entities
  const [orgId, setOrgId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);

  // Step 2
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateProvince, setStateProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
    if (membership) navigate("/dashboard");
  }, [user, membership, authLoading, navigate]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  useEffect(() => {
    setTimezone(TIMEZONE_BY_COUNTRY[country] ?? "America/Regina");
  }, [country]);

  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    const currency = CURRENCY_BY_COUNTRY[country];
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Atomic org + owner-membership creation in a single transaction.
    // Avoids the INSERT-RETURNING + SELECT-policy issue and closes the
    // race between org creation and membership assignment.
    const { data: newOrgId, error: orgErr } = await supabase.rpc(
      "create_organization_with_owner",
      { _name: name, _slug: slug, _country: country, _currency: currency, _timezone: timezone },
    );
    if (orgErr || !newOrgId) {
      setSubmitting(false);
      return toast.error(orgErr?.message ?? "Failed to create organization");
    }

    const { data: loc, error: locErr } = await supabase
      .from("locations")
      .insert({
        organization_id: newOrgId,
        name: name,
        country,
        timezone,
        active: true,
      })
      .select()
      .single();
    if (locErr || !loc) {
      setSubmitting(false);
      return toast.error(locErr?.message ?? "Failed to create location");
    }

    const { error: subErr } = await supabase.from("subscriptions").insert({
      organization_id: newOrgId,
      status: "trialing",
      trial_ends_at: trialEndsAt,
    });
    if (subErr) {
      setSubmitting(false);
      return toast.error(subErr.message);
    }

    setOrgId(newOrgId);
    setLocationId(loc.id);
    setEmail(user.email ?? "");
    await refresh();
    setSubmitting(false);
    setStep(2);
  };

  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationId) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("locations")
      .update({
        street_address: street,
        city,
        state_province: stateProvince,
        postal_code: postalCode,
        phone,
        email,
      })
      .eq("id", locationId);
    setSubmitting(false);
    if (error) return toast.error(error.message);
    setStep(3);
  };

  const stepTitles = ["Create organization", "Location details", "All set"];

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-10">
      <div className="mb-8"><Logo /></div>

      <div className="w-full max-w-[560px]">
        {/* Progress */}
        <div className="mb-8 flex items-center justify-between">
          {[1, 2, 3].map((n, i) => (
            <div key={n} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    step > n
                      ? "bg-primary text-primary-foreground"
                      : step === n
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-text-tertiary"
                  }`}
                >
                  {step > n ? <Check className="h-4 w-4" /> : n}
                </div>
                <span className={`text-[11px] font-medium ${step >= n ? "text-foreground" : "text-text-tertiary"}`}>
                  {stepTitles[i]}
                </span>
              </div>
              {i < 2 && <div className={`mx-2 h-px flex-1 ${step > n ? "bg-primary" : "bg-border"}`} />}
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-surface p-8 shadow-card animate-fade-in">
          {step === 1 && (
            <form onSubmit={handleStep1} className="space-y-5">
              <div>
                <h1 className="font-display text-2xl">Create your organization</h1>
                <p className="mt-1 text-sm text-text-secondary">Tell us about your business.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="name">Business name</Label>
                <Input
                  id="name"
                  name="organization"
                  autoComplete="organization"
                  autoCapitalize="words"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sunny Paws Daycare"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="slug">Subdomain</Label>
                <div className="flex items-center rounded-md border border-input bg-background overflow-hidden">
                  <Input
                    id="slug"
                    required
                    value={slug}
                    onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
                    className="border-0 focus-visible:ring-0"
                  />
                  <span className="px-3 text-sm text-text-tertiary border-l border-input">.snout.app</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Country</Label>
                  <Select value={country} onValueChange={(v) => setCountry(v as Country)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CA">Canada</SelectItem>
                      <SelectItem value="US">United States</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Timezone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Creating…" : "Continue"}
              </Button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleStep2} className="space-y-5">
              <div>
                <h1 className="font-display text-2xl">Location details</h1>
                <p className="mt-1 text-sm text-text-secondary">Where is {name}?</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="street">Street address</Label>
                <Input
                  id="street"
                  name="street-address"
                  autoComplete="street-address"
                  autoCapitalize="words"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    name="city"
                    autoComplete="address-level2"
                    autoCapitalize="words"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="state">{country === "CA" ? "Province" : "State"}</Label>
                  <Input
                    id="state"
                    name="state"
                    autoComplete="address-level1"
                    autoCapitalize="words"
                    value={stateProvince}
                    onChange={(e) => setStateProvince(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="postal">{country === "CA" ? "Postal code" : "ZIP code"}</Label>
                  <Input
                    id="postal"
                    name="postal-code"
                    autoComplete="postal-code"
                    autoCapitalize="characters"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loc-email">Location email</Label>
                <Input
                  id="loc-email"
                  name="location-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(1)}>Back</Button>
                <Button type="submit" className="flex-1" disabled={submitting}>
                  {submitting ? "Saving…" : "Continue"}
                </Button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="space-y-5 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-light">
                <Check className="h-7 w-7 text-success" />
              </div>
              <div>
                <h1 className="font-display text-2xl">You're all set</h1>
                <p className="mt-2 text-sm text-text-secondary">
                  Your 30-day free trial of Snout has started. No credit card required.
                </p>
              </div>
              <Button className="w-full" onClick={() => navigate("/dashboard")}>Go to dashboard</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
