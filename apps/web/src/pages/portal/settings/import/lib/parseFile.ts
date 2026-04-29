import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedFile } from "./types";

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "csv" || file.type === "text/csv") {
    return parseCSV(file);
  }
  if (ext === "xlsx" || ext === "xls") {
    return parseXLSX(file);
  }
  throw new Error("Unsupported file type. Please upload a .csv or .xlsx file.");
}

function parseCSV(file: File): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const headers = results.meta.fields ?? [];
        const rows = results.data.filter((r) =>
          Object.values(r).some((v) => v != null && String(v).trim() !== ""),
        );
        resolve({ fileName: file.name, headers, rows });
      },
      error: (err) => reject(err),
    });
  });
}

async function parseXLSX(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
  const headers = json.length > 0 ? Object.keys(json[0]).map((h) => h.trim()) : [];
  const rows = json
    .map((r) => {
      const out: Record<string, string> = {};
      for (const k of Object.keys(r)) out[k.trim()] = r[k] == null ? "" : String(r[k]);
      return out;
    })
    .filter((r) => Object.values(r).some((v) => v.trim() !== ""));
  return { fileName: file.name, headers, rows };
}
