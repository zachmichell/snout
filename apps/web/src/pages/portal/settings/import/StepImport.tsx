import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Download, AlertCircle } from "lucide-react";
import { executeImport } from "./lib/executors";
import type { DataType, DuplicateMode, ImportResult, SourceSystem, ValidatedRow } from "./lib/types";

export default function StepImport({
  dataType,
  rows,
  organizationId,
  sourceSystem,
  duplicateMode,
  onReset,
}: {
  dataType: DataType;
  rows: ValidatedRow[];
  organizationId: string;
  sourceSystem: SourceSystem;
  duplicateMode: DuplicateMode;
  onReset: () => void;
}) {
  const navigate = useNavigate();
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    let cancelled = false;
    executeImport(
      dataType,
      rows,
      organizationId,
      (done, total) => {
        if (!cancelled) setProgress({ done, total });
      },
      sourceSystem,
      duplicateMode,
    )
      .then((r) => !cancelled && setResult(r))
      .finally(() => !cancelled && setRunning(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function downloadErrors() {
    if (!result) return;
    const headers = ["row", "reason", ...Object.keys(result.errorRows[0]?.data ?? {})];
    const csv = [
      headers.join(","),
      ...result.errorRows.map((e) =>
        [e.row, JSON.stringify(e.reason), ...Object.keys(e.data).map((k) => JSON.stringify(e.data[k] ?? ""))].join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-errors-${dataType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const targetRoute: Record<DataType, string> = {
    owners: "/owners",
    pets: "/pets",
    vaccinations: "/pets",
    reservations: "/reservations",
  };

  return (
    <div className="space-y-6">
      {running && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium">Importing…</div>
            <div className="text-sm text-text-secondary font-mono">
              {progress.done} / {progress.total}
            </div>
          </div>
          <Progress value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} />
        </Card>
      )}

      {result && (
        <>
          <Card className="p-6 border-l-4 border-l-success bg-success/5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-success" />
              <div>
                <div className="font-display text-lg">
                  Successfully imported {result.imported} {dataType}
                </div>
                <div className="text-sm text-text-secondary">
                  {result.skipped} skipped · {result.errored} errors
                </div>
              </div>
            </div>
          </Card>

          {result.errorRows.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <div className="font-medium text-sm">Failed rows ({result.errorRows.length})</div>
                </div>
                <Button variant="outline" size="sm" onClick={downloadErrors}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download Error Report
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left">Row</th>
                      <th className="px-3 py-2 text-left">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errorRows.slice(0, 50).map((e, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 font-mono">{e.row}</td>
                        <td className="px-3 py-2 text-destructive">{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onReset}>
              Import More Data
            </Button>
            <Button onClick={() => navigate(targetRoute[dataType])}>
              Go to {dataType.charAt(0).toUpperCase() + dataType.slice(1)}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
