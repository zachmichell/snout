// Lightweight CSV parser/serializer (RFC 4180-ish). No deps.

export type CsvRow = Record<string, string>;

export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  // Strip BOM
  const src = text.replace(/^\uFEFF/, "");
  const out: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { cur.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { cur.push(field); out.push(cur); cur = []; field = ""; i++; continue; }
    field += c; i++;
  }
  // flush
  if (field.length > 0 || cur.length > 0) { cur.push(field); out.push(cur); }
  if (out.length === 0) return { headers: [], rows: [] };
  const headers = out[0].map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let r = 1; r < out.length; r++) {
    const line = out[r];
    if (line.length === 1 && line[0] === "") continue; // skip empty line
    const obj: CsvRow = {};
    headers.forEach((h, idx) => { obj[h] = (line[idx] ?? "").trim(); });
    rows.push(obj);
  }
  return { headers, rows };
}

export function toCsv(rows: Array<Record<string, unknown>>, headers?: string[]): string {
  if (rows.length === 0) return (headers ?? []).join(",") + "\n";
  const cols = headers ?? Array.from(
    rows.reduce<Set<string>>((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set()),
  );
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => escape(r[c])).join(","));
  return lines.join("\n") + "\n";
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
