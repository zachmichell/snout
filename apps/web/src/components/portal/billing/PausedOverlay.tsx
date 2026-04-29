import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Lock } from "lucide-react";

export default function PausedOverlay() {
  const [loading, setLoading] = useState(false);

  const handleAddBilling = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-billing-checkout", {
        body: { module_selections: { daycare: true, boarding: true } },
      });
      if (error) throw error;
      if (data?.checkout_url) window.location.href = data.checkout_url;
    } catch (e: any) {
      toast.error(e.message ?? "Could not start checkout");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/60 backdrop-blur-sm p-6">
      <div className="max-w-md rounded-2xl bg-card border border-border p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Lock className="h-7 w-7 text-primary" />
        </div>
        <h2 className="font-display text-2xl font-bold text-foreground mb-2">
          Your trial has ended
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          Add a payment method to continue using Snout and keep your data safe.
        </p>
        <Button
          onClick={handleAddBilling}
          disabled={loading}
          size="lg"
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {loading ? "Loading..." : "Add Billing"}
        </Button>
      </div>
    </div>
  );
}
