export function formatDate(value: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString(undefined, opts ?? { year: "numeric", month: "short", day: "numeric" });
}

export function calcAge(dob: string | null | undefined) {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months--;
  if (months < 0) {
    years--;
    months += 12;
  }
  if (years <= 0) return `${months} month${months === 1 ? "" : "s"}`;
  if (months === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years} year${years === 1 ? "" : "s"} ${months} month${months === 1 ? "" : "s"}`;
}

export function kgToLbs(kg: number | null | undefined) {
  if (kg == null) return null;
  return (Number(kg) * 2.20462).toFixed(1);
}

export function speciesIcon(species: string | null | undefined) {
  if (species === "dog") return "🐕";
  if (species === "cat") return "🐈";
  return "🐾";
}

export function formatVaccineType(t: string) {
  const map: Record<string, string> = {
    rabies: "Rabies",
    dapp: "DAPP",
    dhpp: "DHPP",
    bordetella: "Bordetella",
    lepto: "Lepto",
    lyme: "Lyme",
    influenza: "Influenza",
    fvrcp: "FVRCP",
    other: "Other",
  };
  return map[t] ?? t;
}

export function isExpired(date: string | null | undefined) {
  if (!date) return false;
  return new Date(date) < new Date();
}

export function isExpiringSoon(date: string | null | undefined, days = 30) {
  if (!date) return false;
  const exp = new Date(date);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  return exp >= new Date() && exp <= cutoff;
}
