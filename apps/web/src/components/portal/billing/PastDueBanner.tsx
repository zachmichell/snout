import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";

export default function PastDueBanner() {
  const [loading, setLoading] = useState(false);

  const handleUpdate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-billing-portal");
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (e: any) {
      toast.error(e.message ?? "Could not open billing portal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-destructive/10 border-b border-destructive/30 px-6 py-3 flex items-center gap-3">
      <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
      <p className="text-sm text-foreground flex-1">
        Payment failed for your Snout subscription. Update your payment method.
      </p>
      <button
        onClick={handleUpdate}
        disabled={loading}
        className="text-sm font-semibold text-primary hover:underline disabled:opacity-50"
      >
        {loading ? "Loading..." : "Update Payment"}
      </button>
    </div>
  );
}
