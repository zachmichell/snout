import { useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import StepSelectSource from "./StepSelectSource";
import StepUploadMap from "./StepUploadMap";
import StepValidate from "./StepValidate";
import StepImport from "./StepImport";
import type { ColumnMapping, DataType, DuplicateMode, ParsedFile, SourceSystem, ValidatedRow } from "./lib/types";

const STEPS = ["Select", "Upload", "Validate", "Import"];

export default function ImportWizard() {
  const { membership } = useAuth();
  const [step, setStep] = useState(0);
  const [dataType, setDataType] = useState<DataType | null>(null);
  const [source, setSource] = useState<SourceSystem | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [validated, setValidated] = useState<ValidatedRow[]>([]);
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("skip");

  const orgId = membership?.organization_id;

  function reset() {
    setStep(0);
    setDataType(null);
    setSource(null);
    setParsed(null);
    setMapping({});
    setValidated([]);
    setDuplicateMode("skip");
  }

  if (!orgId) {
    return <p className="text-sm text-text-secondary">No organization context.</p>;
  }

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
              <div
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium border",
                  i < step && "bg-success/20 border-success text-success",
                  i === step && "bg-accent text-white border-accent",
                  i > step && "bg-muted border-border text-text-secondary",
                )}
              >
                {i + 1}
              </div>
              <div className={cn("text-sm", i === step ? "font-medium" : "text-text-secondary")}>{label}</div>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border mx-2" />}
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        {step === 0 && (
          <StepSelectSource
            dataType={dataType}
            source={source}
            onChange={(dt, src) => {
              setDataType(dt);
              setSource(src);
            }}
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && dataType && source && (
          <StepUploadMap
            dataType={dataType}
            source={source}
            parsed={parsed}
            mapping={mapping}
            onParsed={(p, m) => {
              setParsed(p);
              setMapping(m);
              setValidated([]);
            }}
            onMappingChange={(m) => {
              setMapping(m);
              setValidated([]);
            }}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && dataType && parsed && (
          <StepValidate
            dataType={dataType}
            parsed={parsed}
            mapping={mapping}
            organizationId={orgId}
            rows={validated}
            onRowsChange={setValidated}
            duplicateMode={duplicateMode}
            onDuplicateModeChange={setDuplicateMode}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && dataType && (
          <StepImport
            dataType={dataType}
            rows={validated}
            organizationId={orgId}
            sourceSystem={source ?? "other"}
            duplicateMode={duplicateMode}
            onReset={reset}
          />
        )}
      </Card>
    </div>
  );
}
