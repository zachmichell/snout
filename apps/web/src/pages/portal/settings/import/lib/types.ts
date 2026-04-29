export type DataType = "owners" | "pets" | "vaccinations" | "reservations";
export type SourceSystem = "gingr" | "petexec" | "daysmart" | "other";

export type ParsedFile = {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
};

export type ColumnMapping = Record<string, string>; // snoutField -> csvHeader

export type RowIssue = {
  severity: "error" | "warning";
  field: string;
  message: string;
};

export type MatchMethod = "exact" | "external_id" | "last_name" | "email" | "none";

export type DuplicateMode = "skip" | "overwrite" | "new";

export type ValidatedRow = {
  index: number; // 0-based row index in original file
  raw: Record<string, string>;
  mapped: Record<string, any>;
  issues: RowIssue[];
  include: boolean;
  isDuplicate?: boolean;
  duplicateOfId?: string | null;
  matchMethod?: MatchMethod;
  matchSuggestion?: string | null;
};

export type MatchStats = {
  exact: number;
  external_id: number;
  last_name: number;
  email: number;
  unlinked: number;
};

export type ValidationResult = {
  rows: ValidatedRow[];
  matchStats?: MatchStats;
};

export type ImportResult = {
  imported: number;
  skipped: number;
  errored: number;
  errorRows: { row: number; reason: string; data: Record<string, string> }[];
};
