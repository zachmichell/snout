const TZ = "America/Edmonton";

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  // Same week (< 7 days): "Yesterday 3:42 PM" or weekday + time
  const days = Math.floor(diffMs / 86400000);
  const time = then.toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  });
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) {
    const weekday = then.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long" });
    return `${weekday} ${time}`;
  }
  // Older: "April 15, 3:30 PM"
  const date = then.toLocaleDateString("en-US", {
    timeZone: TZ,
    month: "long",
    day: "numeric",
  });
  return `${date}, ${time}`;
}

export function truncatePreview(text: string, max = 50): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function petListLabel(names: string[], max = 2): string {
  if (!names.length) return "";
  if (names.length <= max) return names.join(", ");
  const shown = names.slice(0, max).join(", ");
  return `${shown} and ${names.length - max} more`;
}
