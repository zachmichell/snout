import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserCircle2, LogOut } from "lucide-react";
import { useStaffCodes, useVerifyStaffPin } from "@/hooks/useStaffCodes";
import { useActiveStaff } from "@/contexts/StaffCodeContext";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export default function StaffCodeSwitcher({ compact = false }: { compact?: boolean }) {
  const { activeStaff, setActiveStaff, clearActiveStaff } = useActiveStaff();
  const { membership } = useAuth();
  const { data: codes = [] } = useStaffCodes();
  const verify = useVerifyStaffPin();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!membership?.organization_id) {
      setError("No organization");
      return;
    }
    try {
      const matchedId = await verify.mutateAsync({
        org_id: membership.organization_id,
        pin,
      });
      if (!matchedId) {
        setError("Invalid PIN");
        return;
      }
      const match = codes.find((c) => c.id === matchedId);
      if (!match) {
        setError("Code not found — try again");
        return;
      }
      setActiveStaff({
        id: match.id,
        display_name: match.display_name,
        role: match.role,
      });
      toast.success(`Welcome, ${match.display_name}`);
      setPin("");
      setOpen(false);
    } catch (e: any) {
      setError(e?.message ?? "PIN verification failed");
    }
  };

  const handleSignOut = () => {
    clearActiveStaff();
    setPin("");
    setOpen(false);
    toast.info("Staff session ended");
  };

  const label = activeStaff?.display_name ?? "Sign in with PIN";

  return (
    <>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-primary-foreground transition-colors"
              aria-label={label}
            >
              <UserCircle2 className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-3 py-2 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary-foreground"
          aria-label="Switch staff"
        >
          <UserCircle2 className="h-4 w-4 shrink-0 text-sidebar-foreground/70" />
          <span className="flex-1 truncate text-left">{label}</span>
        </button>
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setPin(""); setError(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {activeStaff ? "Switch staff" : "Enter your PIN"}
            </DialogTitle>
          </DialogHeader>

          {activeStaff && (
            <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <div className="text-xs text-text-secondary">Currently clocked in</div>
              <div className="font-medium text-foreground">
                {activeStaff.display_name}{" "}
                <span className="text-xs font-normal text-text-tertiary">
                  · {activeStaff.role}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-col items-center gap-3 py-4">
            <InputOTP
              maxLength={6}
              value={pin}
              onChange={(v) => setPin(v.replace(/\D/g, ""))}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            {error && <div className="text-xs text-destructive">{error}</div>}
            <p className="text-center text-xs text-text-secondary">
              Enter your 4-6 digit staff PIN
            </p>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            {activeStaff ? (
              <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2">
                <LogOut className="h-3.5 w-3.5" /> Clock out
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={pin.length < 4}>
                Sign in
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
