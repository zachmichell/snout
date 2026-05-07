// 6.4.5b: Reusable tax-code picker. Reads from the per-org QBO tax-code
// cache (qbo_tax_codes_for_org RPC) and renders a Select. Used by the
// service editor (ServiceForm) and the retail-products dialog
// (PosProducts).
//
// "None" is a valid choice and means the entity is non-taxable. Distinct
// from QBO's "NON" code, which is also non-taxable but explicitly named
// in the operator's QBO tax setup. Both surfaces fall through to no tax
// on invoices; the QBO sync sends "TaxCodeRef = NON" only when the
// operator explicitly picked it.
//
// If the org has no cached tax codes yet (QBO not connected, or
// quickbooks-refresh-tax-codes hasn't been called), the select is
// disabled with an inline hint pointing the operator at the settings tab.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuickBooksTaxCodes } from "@/hooks/useQuickBooksSync";

const NONE_VALUE = "__none__";

export function TaxCodeSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const { data: taxCodes, isLoading } = useQuickBooksTaxCodes();
  const codes = taxCodes ?? [];
  const hasCodes = codes.length > 0;

  return (
    <div>
      <Select
        value={value ?? NONE_VALUE}
        onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
        disabled={disabled || isLoading || !hasCodes}
      >
        <SelectTrigger>
          <SelectValue
            placeholder={
              isLoading
                ? "Loading…"
                : hasCodes
                ? "Select a tax code"
                : "No tax codes imported yet"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>
            <span className="text-text-tertiary">None (non-taxable)</span>
          </SelectItem>
          {codes.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <span className="font-medium">{c.name}</span>
              {c.taxable && c.combined_rate_basis_points > 0 && (
                <span className="ml-2 text-text-tertiary">
                  ({(c.combined_rate_basis_points / 100).toFixed(2)}%)
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!isLoading && !hasCodes && (
        <p className="mt-1 text-xs text-text-tertiary">
          Connect QuickBooks and import tax codes from the QuickBooks
          settings tab to enable per-service tax handling.
        </p>
      )}
      {hasCodes && value && (
        <TaxCodeSummary codeId={value} />
      )}
    </div>
  );
}

function TaxCodeSummary({ codeId }: { codeId: string }) {
  const { data: taxCodes } = useQuickBooksTaxCodes();
  const code = (taxCodes ?? []).find((c) => c.id === codeId);
  if (!code) return null;
  if (!code.taxable) {
    return <p className="mt-1 text-xs text-text-tertiary">Non-taxable.</p>;
  }
  if (!code.rate_summary) {
    return (
      <p className="mt-1 text-xs text-text-tertiary">
        This QBO tax code has no rates linked. Refresh tax codes after
        adding rates in QuickBooks.
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-text-tertiary">
      Resolves to {code.rate_summary} ({(code.combined_rate_basis_points / 100).toFixed(2)}%
      total).
    </p>
  );
}
