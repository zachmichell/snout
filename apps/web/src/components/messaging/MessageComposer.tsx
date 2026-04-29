import { FormEvent, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onSend: (body: string) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
};

export default function MessageComposer({ onSend, disabled, placeholder }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending || disabled) return;
    setSending(true);
    try {
      await onSend(body);
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-border bg-card p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit(e as unknown as FormEvent);
          }
        }}
        placeholder={placeholder ?? "Type a message…"}
        rows={1}
        disabled={disabled || sending}
        className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
        style={{ minHeight: 40, maxHeight: 140 }}
      />
      <Button type="submit" size="icon" disabled={!text.trim() || sending || disabled} className="h-10 w-10 shrink-0">
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}
