import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Broadcast (announcement) to every enrolled owner of a class instance or a
 * whole series. Each owner receives it in their own private thread; replies
 * come back to staff only — owners don't see each other.
 */
export default function BroadcastMessageDialog({
  open,
  onOpenChange,
  classInstanceId,
  seriesId,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  classInstanceId?: string;
  seriesId?: string;
  title?: string;
}) {
  const [body, setBody] = useState("");
  useEffect(() => {
    if (open) setBody("");
  }, [open]);

  const send = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("broadcast_class_message", {
        p_body: body,
        ...(seriesId ? { p_series_id: seriesId } : { p_class_instance_id: classInstanceId }),
      });
      if (error) throw error;
      return (data ?? 0) as number;
    },
    onSuccess: (count) => {
      toast.success(
        count > 0
          ? `Message sent to ${count} ${count === 1 ? "owner" : "owners"}`
          : "No enrolled owners to message",
      );
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to send message"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            Message participants{title ? ` — ${title}` : ""}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-text-secondary">
          Sends a private message to each enrolled owner. They each receive it in their own
          thread and replies come back to you — owners don't see each other.
        </p>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="e.g. Reminder: please bring your pup's vaccination records to the next class."
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => send.mutate()} disabled={send.isPending || !body.trim()}>
            {send.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
