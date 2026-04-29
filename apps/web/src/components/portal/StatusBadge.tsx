import { cn } from "@/lib/utils";

type Tone = "primary" | "teal" | "plum" | "success" | "warning" | "danger" | "muted";

const tones: Record<Tone, string> = {
  primary: "bg-primary-light text-primary border-primary/20",
  teal: "bg-teal-light text-teal border-teal/20",
  plum: "bg-plum-light text-plum border-plum/20",
  success: "bg-success-light text-success border-success/20",
  warning: "bg-warning-light text-warning border-warning/20",
  danger: "bg-destructive-light text-destructive border-destructive/20",
  muted: "bg-muted text-muted-foreground border-border",
};

export default function StatusBadge({
  tone = "muted",
  children,
  dot = true,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

export function intakeTone(status: string): Tone {
  switch (status) {
    case "approved":
      return "success";
    case "pending_review":
      return "warning";
    case "restricted":
      return "plum";
    case "banned":
      return "danger";
    default:
      return "muted";
  }
}

export function relationshipTone(rel: string): Tone {
  if (rel === "primary") return "primary";
  if (rel === "secondary") return "teal";
  return "plum";
}

export function commPrefTone(p: string): Tone {
  if (p === "email") return "teal";
  if (p === "sms") return "plum";
  return "primary";
}
