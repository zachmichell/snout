import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePetMedications } from "@/hooks/usePetMedications";
import { usePetFeeding } from "@/hooks/usePetFeeding";
import { LOG_TYPE_LABELS, LogType } from "@/lib/care";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  petId: string;
  petName: string;
  reservationId: string | null;
  initialType: LogType;
};

const POTTY_OPTIONS = [
  { value: "Normal", label: "Normal" },
  { value: "Loose", label: "Loose" },
  { value: "Diarrhea", label: "Diarrhea" },
  { value: "No activity", label: "No activity" },
];

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
}

export default function QuickLogSheet({ open, onOpenChange, petId, petName, reservationId, initialType }: Props) {
  const { user, membership } = useAuth();
  const qc = useQueryClient();
  const [logType, setLogType] = useState<LogType>(initialType);
  const [refId, setRefId] = useState<string>("custom");
  const [pottyResult, setPottyResult] = useState("Normal");
  const [notes, setNotes] = useState("");
  const [loggedAt, setLoggedAt] = useState(nowLocal());
  const [busy, setBusy] = useState(false);

  const { data: meds } = usePetMedications(logType === "medication" ? petId : undefined);
  const { data: feeds } = usePetFeeding(logType === "feeding" ? petId : undefined);

  useEffect(() => {
    if (open) {
      setLogType(initialType);
      setRefId("custom");
      setPottyResult("Normal");
      setNotes("");
      setLoggedAt(nowLocal());
    }
  }, [open, initialType]);

  const submit = async () => {
    if (!membership?.organization_id) return toast.error("Missing organization");
    setBusy(true);
    let finalNotes = notes.trim();
    if (logType === "potty") {
      finalNotes = finalNotes ? `${pottyResult} — ${finalNotes}` : pottyResult;
    }
    const payload = {
      organization_id: membership.organization_id,
      pet_id: petId,
      reservation_id: reservationId,
      log_type: logType,
      reference_id: refId !== "custom" ? refId : null,
      notes: finalNotes || null,
      logged_at: new Date(loggedAt).toISOString(),
      logged_by: user?.id ?? null,
    };
    const { error } = await supabase.from("pet_care_logs").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Logged ${LOG_TYPE_LABELS[logType].toLowerCase()} for ${petName}`);
    qc.invalidateQueries({ queryKey: ["org-care-logs"] });
    qc.invalidateQueries({ queryKey: ["reservation-care-logs", reservationId] });
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            Log {LOG_TYPE_LABELS[logType]} · <span className="font-display">{petName}</span>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={logType} onValueChange={(v) => setLogType(v as LogType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(LOG_TYPE_LABELS) as LogType[]).map((k) => (
                  <SelectItem key={k} value={k}>{LOG_TYPE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="logged-at">Time</Label>
            <Input id="logged-at" type="datetime-local" value={loggedAt} onChange={(e) => setLoggedAt(e.target.value)} />
          </div>

          {logType === "feeding" && (
            <div className="space-y-1.5">
              <Label>Food</Label>
              <Select value={refId} onValueChange={setRefId}>
                <SelectTrigger><SelectValue placeholder="Select food" /></SelectTrigger>
                <SelectContent>
                  {(feeds ?? []).map((f: any) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.food_type}{f.amount ? ` · ${f.amount}` : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom (specify in notes)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {logType === "medication" && (
            <div className="space-y-1.5">
              <Label>Medication</Label>
              <Select value={refId} onValueChange={setRefId}>
                <SelectTrigger><SelectValue placeholder="Select medication" /></SelectTrigger>
                <SelectContent>
                  {(meds ?? []).map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}{m.dosage ? ` · ${m.dosage}` : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom (specify in notes)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {logType === "potty" && (
            <div className="space-y-1.5">
              <Label>Result</Label>
              <RadioGroup value={pottyResult} onValueChange={setPottyResult} className="grid grid-cols-2 gap-2">
                {POTTY_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 rounded-md border border-border p-2 cursor-pointer hover:bg-background">
                    <RadioGroupItem value={opt.value} />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="log-notes">Notes</Label>
            <Textarea
              id="log-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                logType === "feeding" ? "e.g., Ate everything enthusiastically" :
                logType === "medication" ? "e.g., Took with treat" :
                logType === "play" ? "e.g., Played fetch for 20 min with Cooper" :
                logType === "rest" ? "e.g., Napped in cot 3" :
                "Add details"
              }
            />
          </div>
        </div>

        <SheetFooter className="mt-6">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Logging…" : "Save log"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
