// Form for the operator to report an issue. Two paths:
//
//   * Non-critical (info / minor / question): opens a mailto: to the
//     SUPPORT_EMAIL configured in env. We do not need a server hop for
//     low-severity reports — the operator's email client already has
//     attachments and threading better than we'd build.
//
//   * Critical: posts to the report-critical-issue edge function which
//     forwards to whatever escalation backend ops has wired up
//     (Slack/PagerDuty/Plain). Captures user, org, current path, and
//     the form fields so the responder has a starting point.
//
// The endpoint is expected to be configured via env. If neither
// VITE_SUPPORT_EMAIL nor a critical webhook is set, the dialog still
// renders but submission errors clearly. We intentionally do not gate
// the button on env presence — surfacing the error is more useful than
// silently hiding the affordance.
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useReportCriticalIssue } from "@/hooks/useReportCriticalIssue";

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL ?? "support@snout.app";

type Severity = "question" | "minor" | "major" | "critical";

export default function ReportIssueDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [severity, setSeverity] = useState<Severity>("question");
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState("");
  const critical = useReportCriticalIssue();

  const reset = () => {
    setSeverity("question");
    setSummary("");
    setSteps("");
  };

  const handleSubmit = async () => {
    if (summary.trim().length < 10) {
      toast.error("Add at least a sentence describing the problem");
      return;
    }

    if (severity === "critical") {
      try {
        await critical.mutateAsync({ summary, steps });
        toast.success("Critical report sent. Someone will be in touch shortly.");
        reset();
        onOpenChange(false);
      } catch (e: any) {
        const message = e?.context?.error ?? e?.message ?? "Could not send report";
        toast.error(message);
      }
      return;
    }

    // Non-critical: mailto handoff. Pre-fills subject and body so the
    // operator's email client opens with everything already typed.
    const subject = encodeURIComponent(`[Snout ${severity}] ${summary.slice(0, 80)}`);
    const body = encodeURIComponent(
      `Severity: ${severity}\n\nWhat happened:\n${summary}\n\n` +
        (steps ? `Steps to reproduce:\n${steps}\n\n` : "") +
        `Page: ${typeof window !== "undefined" ? window.location.href : "n/a"}`,
    );
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>
            For non-urgent questions and minor bugs, this opens an email so you can
            attach screenshots. For critical issues, we route directly to the on-call
            team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Severity</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="question">Question or how-to</SelectItem>
                <SelectItem value="minor">Minor bug or annoyance</SelectItem>
                <SelectItem value="major">Major bug, blocks one workflow</SelectItem>
                <SelectItem value="critical">Critical: site is down or charges are misfiring</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {severity === "critical" && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-light p-3 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Use this for genuine outages or money-affecting bugs only. Critical
              reports page on-call immediately.
            </div>
          )}

          <div>
            <Label className="text-xs">What happened?</Label>
            <Textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Describe the problem in your own words"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs">Steps to reproduce (optional)</Label>
            <Textarea
              rows={3}
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              placeholder="What were you doing when this happened?"
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={critical.isPending || summary.trim().length < 10}
            className={severity === "critical" ? "bg-destructive hover:bg-destructive/90" : ""}
          >
            {critical.isPending
              ? "Sending..."
              : severity === "critical"
                ? "Send critical report"
                : "Open email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
