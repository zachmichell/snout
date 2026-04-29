import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { parseFile } from "./lib/parseFile";
import { autoMap } from "./lib/templates";
import { SNOUT_FIELDS } from "./lib/snoutFields";
import type { ColumnMapping, DataType, ParsedFile, SourceSystem } from "./lib/types";

export default function StepUploadMap({
  dataType,
  source,
  parsed,
  mapping,
  onParsed,
  onMappingChange,
  onBack,
  onNext,
}: {
  dataType: DataType;
  source: SourceSystem;
  parsed: ParsedFile | null;
  mapping: ColumnMapping;
  onParsed: (p: ParsedFile, m: ColumnMapping) => void;
  onMappingChange: (m: ColumnMapping) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setParsing(true);
      try {
        const p = await parseFile(file);
        if (p.rows.length === 0) {
          toast({ title: "Empty file", description: "No data rows found.", variant: "destructive" });
          return;
        }
        const auto = autoMap(source, dataType, p.headers);
        onParsed(p, auto);
        toast({ title: "File parsed", description: `${p.rows.length} rows, ${p.headers.length} columns` });
      } catch (e: any) {
        toast({ title: "Parse failed", description: e.message, variant: "destructive" });
      } finally {
        setParsing(false);
      }
    },
    [source, dataType, onParsed],
  );

  const fields = SNOUT_FIELDS[dataType];
  const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);
  const allRequiredMapped = requiredKeys.every((k) => mapping[k]);

  return (
    <div className="space-y-6">
      {!parsed ? (
        <Card
          className={`border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${
            dragOver ? "border-accent bg-accent-light" : "border-border"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="h-10 w-10 mx-auto mb-3 text-text-secondary" />
          <div className="font-medium">{parsing ? "Parsing…" : "Drop your CSV or XLSX file here"}</div>
          <div className="text-sm text-text-secondary mt-1">or click to browse</div>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </Card>
      ) : (
        <>
          <Card className="p-4 flex items-center gap-3">
            <FileText className="h-5 w-5 text-accent" />
            <div className="flex-1">
              <div className="font-medium text-sm">{parsed.fileName}</div>
              <div className="text-xs text-text-secondary">
                {parsed.rows.length} rows · {parsed.headers.length} columns
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
              Replace
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </Card>

          <div>
            <h3 className="font-display text-base mb-3">Map columns</h3>
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Snout Field</th>
                    <th className="text-left px-4 py-2 font-medium">Your CSV Column</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.key} className="border-t border-border">
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{f.label}</span>
                          {f.required && (
                            <Badge variant="outline" className="text-[10px]">
                              required
                            </Badge>
                          )}
                        </div>
                        {f.hint && <div className="text-xs text-text-secondary mt-0.5">{f.hint}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={mapping[f.key] ?? "__none__"}
                          onValueChange={(v) => {
                            const next = { ...mapping };
                            if (v === "__none__") delete next[f.key];
                            else next[f.key] = v;
                            onMappingChange(next);
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="— skip —" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— skip —</SelectItem>
                            {parsed.headers.map((h) => (
                              <SelectItem key={h} value={h}>
                                {h}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <div>
            <h3 className="font-display text-base mb-3">Preview (first 3 rows)</h3>
            <Card className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    {fields.map((f) => (
                      <th key={f.key} className="text-left px-3 py-2 font-medium whitespace-nowrap">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 3).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {fields.map((f) => {
                        const csvCol = mapping[f.key];
                        const val = csvCol ? r[csvCol] : "";
                        return (
                          <td key={f.key} className={`px-3 py-2 ${csvCol ? "bg-accent-light/40" : ""}`}>
                            {val || <span className="text-text-secondary">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext} disabled={!parsed || !allRequiredMapped}>
          Next
        </Button>
      </div>
    </div>
  );
}
