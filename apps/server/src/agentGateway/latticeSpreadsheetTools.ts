import { Buffer } from "node:buffer";

import { Effect } from "effect";

import {
  LatticeSpreadsheetBroker,
  LatticeSpreadsheetBrokerError,
} from "./Services/LatticeSpreadsheetBroker.ts";
import { mcpToolResultError, mcpToolResultJson } from "./protocol.ts";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  WRITE_TOOL_ANNOTATIONS,
  type ToolContext,
  type ToolEntry,
} from "./toolRuntime.ts";

const MAX_ARGUMENT_BYTES = 256 * 1024;
const MAX_PATH_LENGTH = 1_024;
const MAX_SHEET_LENGTH = 128;
const MAX_CELL_STRING_LENGTH = 32_768;
const MAX_FORMULA_LENGTH = 8_192;
const MAX_OPERATIONS = 100;
const MAX_MATRIX_CELLS = 10_000;
const MAX_READ_CELLS = 10_000;
const MAX_RANGE_CELLS = 100_000;
const MAX_ROW = 1_048_576;
const MAX_COLUMN = 16_384;
const MAX_INSERT_DELETE_COUNT = 1_000;

const spreadsheetPathSchema = {
  type: "string",
  minLength: 1,
  maxLength: MAX_PATH_LENGTH,
  pattern: String.raw`^(?!/)(?![A-Za-z]:)(?!.*(?:^|/)\.\.?/)(?!.*\\).*\.lattice-sheet$`,
  description: "Workspace-relative path to a .lattice-sheet document.",
} as const;

const sheetSchema = {
  type: "string",
  minLength: 1,
  maxLength: MAX_SHEET_LENGTH,
  description: "Sheet name or stable sheet id. Omit only when the workbook default is intended.",
} as const;

const rangeSchema = {
  type: "string",
  minLength: 2,
  maxLength: 32,
  pattern: String.raw`^\$?[A-Za-z]{1,3}\$?[1-9][0-9]*(?::\$?[A-Za-z]{1,3}\$?[1-9][0-9]*)?$`,
  description: "A cell or rectangular A1 range such as A1 or B2:D20.",
} as const;

const includeSchema = {
  type: "array",
  minItems: 1,
  maxItems: 3,
  uniqueItems: true,
  items: { type: "string", enum: ["values", "formulas", "formats"] },
} as const;

const cellValueSchema = {
  anyOf: [
    { type: "string", maxLength: MAX_CELL_STRING_LENGTH },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
  ],
} as const;

const valuesMatrixSchema = {
  type: "array",
  minItems: 1,
  maxItems: MAX_MATRIX_CELLS,
  items: {
    type: "array",
    minItems: 1,
    maxItems: MAX_MATRIX_CELLS,
    items: cellValueSchema,
  },
} as const;

const formulasMatrixSchema = {
  type: "array",
  minItems: 1,
  maxItems: MAX_MATRIX_CELLS,
  items: {
    type: "array",
    minItems: 1,
    maxItems: MAX_MATRIX_CELLS,
    items: {
      type: "string",
      minLength: 2,
      maxLength: MAX_FORMULA_LENGTH,
      pattern: "^=",
    },
  },
} as const;

const formatSchema = {
  type: "object",
  minProperties: 1,
  properties: {
    bold: { type: "boolean" },
    italic: { type: "boolean" },
    underline: { type: "boolean" },
    strikethrough: { type: "boolean" },
    fontFamily: { type: "string", minLength: 1, maxLength: 100 },
    fontSize: { type: "number", minimum: 1, maximum: 200 },
    textColor: { type: "string", minLength: 1, maxLength: 64 },
    backgroundColor: { type: "string", minLength: 1, maxLength: 64 },
    horizontalAlignment: { type: "string", enum: ["left", "center", "right"] },
    verticalAlignment: { type: "string", enum: ["top", "middle", "bottom"] },
    wrap: { type: "boolean" },
    numberFormat: { type: "string", minLength: 1, maxLength: 128 },
  },
  additionalProperties: false,
} as const;

const rangeOperationProperties = {
  sheet: sheetSchema,
  range: rangeSchema,
} as const;

const sheetOperationProperties = { sheet: sheetSchema } as const;

const operationsSchema = {
  type: "array",
  minItems: 1,
  maxItems: MAX_OPERATIONS,
  items: {
    oneOf: [
      {
        type: "object",
        properties: {
          type: { const: "set_values" },
          ...rangeOperationProperties,
          values: valuesMatrixSchema,
        },
        required: ["type", "range", "values"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "set_formulas" },
          ...rangeOperationProperties,
          formulas: formulasMatrixSchema,
        },
        required: ["type", "range", "formulas"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "clear" },
          ...rangeOperationProperties,
          include: {
            ...includeSchema,
            description: "Cell facets to clear. Defaults to values, formulas, and formats.",
          },
        },
        required: ["type", "range"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "format_range" },
          ...rangeOperationProperties,
          format: formatSchema,
        },
        required: ["type", "range", "format"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "insert_rows" },
          ...sheetOperationProperties,
          before: {
            type: "integer",
            minimum: 1,
            maximum: MAX_ROW,
            description: "One-based row number before which rows are inserted.",
          },
          count: { type: "integer", minimum: 1, maximum: MAX_INSERT_DELETE_COUNT },
        },
        required: ["type", "before", "count"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "delete_rows" },
          ...sheetOperationProperties,
          start: {
            type: "integer",
            minimum: 1,
            maximum: MAX_ROW,
            description: "One-based first row to delete.",
          },
          count: { type: "integer", minimum: 1, maximum: MAX_INSERT_DELETE_COUNT },
        },
        required: ["type", "start", "count"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "insert_columns" },
          ...sheetOperationProperties,
          before: {
            type: "string",
            pattern: "^[A-Za-z]{1,3}$",
            description: "A1 column label before which columns are inserted, such as C.",
          },
          count: { type: "integer", minimum: 1, maximum: MAX_INSERT_DELETE_COUNT },
        },
        required: ["type", "before", "count"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "delete_columns" },
          ...sheetOperationProperties,
          start: {
            type: "string",
            pattern: "^[A-Za-z]{1,3}$",
            description: "A1 label of the first column to delete, such as C.",
          },
          count: { type: "integer", minimum: 1, maximum: MAX_INSERT_DELETE_COUNT },
        },
        required: ["type", "start", "count"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "add_sheet" },
          name: { type: "string", minLength: 1, maxLength: MAX_SHEET_LENGTH },
          after: {
            ...sheetSchema,
            description: "Optional sheet name or stable id after which the new sheet is placed.",
          },
        },
        required: ["type", "name"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          type: { const: "rename_sheet" },
          sheet: sheetSchema,
          name: { type: "string", minLength: 1, maxLength: MAX_SHEET_LENGTH },
        },
        required: ["type", "sheet", "name"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { type: { const: "delete_sheet" }, sheet: sheetSchema },
        required: ["type", "sheet"],
        additionalProperties: false,
      },
    ],
  },
} as const;

class SpreadsheetInputError extends Error {}

function inputError(message: string): never {
  throw new SpreadsheetInputError(message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return inputError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlyArray<string>,
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpected) inputError(`${label} contains unsupported field "${unexpected}".`);
}

function readBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
  options?: { readonly trim?: boolean },
): string {
  if (typeof value !== "string") inputError(`${label} must be a string.`);
  const normalized = options?.trim === false ? value : value.trim();
  if (normalized.length === 0) inputError(`${label} must not be empty.`);
  if (normalized.length > maxLength) {
    inputError(`${label} must be at most ${String(maxLength)} characters.`);
  }
  if (/\p{Cc}/u.test(normalized)) inputError(`${label} must not contain control characters.`);
  return normalized;
}

function readPath(value: unknown): string {
  const path = readBoundedString(value, "path", MAX_PATH_LENGTH);
  if (
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    inputError("path must be a normalized workspace-relative path.");
  }
  if (!path.endsWith(".lattice-sheet")) {
    inputError("path must end with .lattice-sheet.");
  }
  return path;
}

function readSheet(value: unknown, label = "sheet"): string {
  return readBoundedString(value, label, MAX_SHEET_LENGTH);
}

function columnNumber(label: string): number {
  let result = 0;
  for (const character of label) result = result * 26 + character.charCodeAt(0) - 64;
  return result;
}

function readColumn(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z]{1,3}$/u.test(value)) {
    inputError(`${label} must be an A1 column label such as A or BC.`);
  }
  const normalized = value.toUpperCase();
  if (columnNumber(normalized) > MAX_COLUMN) {
    inputError(`${label} must not exceed XFD.`);
  }
  return normalized;
}

interface ParsedRange {
  readonly normalized: string;
  readonly rows: number;
  readonly columns: number;
}

function readRange(value: unknown, label: string, maxCells: number): ParsedRange {
  if (typeof value !== "string" || value.length > 32) {
    return inputError(`${label} must be a bounded A1 cell or rectangular range.`);
  }
  const match =
    /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]*)(?::\$?([A-Za-z]{1,3})\$?([1-9][0-9]*))?$/u.exec(value);
  if (!match) inputError(`${label} must use A1 notation such as A1 or B2:D20.`);
  const startColumnLabel = match[1]!.toUpperCase();
  const endColumnLabel = (match[3] ?? match[1])!.toUpperCase();
  const startColumn = columnNumber(startColumnLabel);
  const endColumn = columnNumber(endColumnLabel);
  const startRow = Number(match[2]);
  const endRow = Number(match[4] ?? match[2]);
  if (
    startColumn > MAX_COLUMN ||
    endColumn > MAX_COLUMN ||
    startRow > MAX_ROW ||
    endRow > MAX_ROW
  ) {
    inputError(`${label} exceeds spreadsheet row or column limits.`);
  }
  if (endColumn < startColumn || endRow < startRow) {
    inputError(`${label} must run from its top-left cell to its bottom-right cell.`);
  }
  const rows = endRow - startRow + 1;
  const columns = endColumn - startColumn + 1;
  if (rows * columns > maxCells) {
    inputError(`${label} may cover at most ${String(maxCells)} cells.`);
  }
  return {
    normalized:
      startColumnLabel === endColumnLabel && startRow === endRow
        ? `${startColumnLabel}${String(startRow)}`
        : `${startColumnLabel}${String(startRow)}:${endColumnLabel}${String(endRow)}`,
    rows,
    columns,
  };
}

type SpreadsheetInclude = "values" | "formulas" | "formats";

function readInclude(
  value: unknown,
  fallback: ReadonlyArray<SpreadsheetInclude>,
): SpreadsheetInclude[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
    inputError("include must contain one to three spreadsheet facets.");
  }
  const allowed = new Set<SpreadsheetInclude>(["values", "formulas", "formats"]);
  const result: SpreadsheetInclude[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item as SpreadsheetInclude)) {
      inputError("include may contain only values, formulas, and formats.");
    }
    if (result.includes(item as SpreadsheetInclude))
      inputError("include must not contain duplicates.");
    result.push(item as SpreadsheetInclude);
  }
  return result;
}

function readPositiveInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    inputError(`${label} must be an integer from 1 through ${String(maximum)}.`);
  }
  return value as number;
}

function readMatrix(
  value: unknown,
  label: "values" | "formulas",
  range: ParsedRange,
): ReadonlyArray<ReadonlyArray<string | number | boolean | null>> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MATRIX_CELLS) {
    inputError(`${label} must be a non-empty two-dimensional array.`);
  }
  const firstRow = value[0];
  if (!Array.isArray(firstRow) || firstRow.length === 0) {
    inputError(`${label} must contain non-empty rows.`);
  }
  if (value.length * firstRow.length > MAX_MATRIX_CELLS) {
    inputError(`${label} may contain at most ${String(MAX_MATRIX_CELLS)} cells.`);
  }
  if (value.length !== range.rows || firstRow.length !== range.columns) {
    inputError(`${label} dimensions must exactly match the target range.`);
  }
  return value.map((rawRow, rowIndex) => {
    if (!Array.isArray(rawRow) || rawRow.length !== firstRow.length) {
      inputError(`${label} row ${String(rowIndex + 1)} has inconsistent dimensions.`);
    }
    return rawRow.map((cell, columnIndex) => {
      const cellLabel = `${label}[${String(rowIndex)}][${String(columnIndex)}]`;
      if (label === "formulas") {
        if (typeof cell !== "string" || !cell.startsWith("=") || cell.length > MAX_FORMULA_LENGTH) {
          inputError(`${cellLabel} must be a formula beginning with =.`);
        }
        return cell;
      }
      if (cell === null || typeof cell === "boolean") return cell;
      if (typeof cell === "number" && Number.isFinite(cell)) return cell;
      if (typeof cell === "string" && cell.length <= MAX_CELL_STRING_LENGTH) return cell;
      inputError(`${cellLabel} must be a bounded string, finite number, boolean, or null.`);
    });
  });
}

function optionalSheet(operation: Record<string, unknown>): Record<string, string> {
  return operation.sheet === undefined ? {} : { sheet: readSheet(operation.sheet) };
}

function readFormat(value: unknown): Record<string, unknown> {
  const format = asRecord(value, "format");
  const booleanKeys = ["bold", "italic", "underline", "strikethrough", "wrap"] as const;
  const stringLimits = {
    fontFamily: 100,
    textColor: 64,
    backgroundColor: 64,
    numberFormat: 128,
  } as const;
  const allowedKeys = [
    ...booleanKeys,
    ...Object.keys(stringLimits),
    "fontSize",
    "horizontalAlignment",
    "verticalAlignment",
  ];
  assertOnlyKeys(format, allowedKeys, "format");
  if (Object.keys(format).length === 0) inputError("format must set at least one property.");
  const normalized: Record<string, unknown> = {};
  for (const key of booleanKeys) {
    if (format[key] === undefined) continue;
    if (typeof format[key] !== "boolean") inputError(`format.${key} must be a boolean.`);
    normalized[key] = format[key];
  }
  for (const [key, maximum] of Object.entries(stringLimits)) {
    if (format[key] === undefined) continue;
    normalized[key] = readBoundedString(format[key], `format.${key}`, maximum);
  }
  if (format.fontSize !== undefined) {
    if (
      typeof format.fontSize !== "number" ||
      !Number.isFinite(format.fontSize) ||
      format.fontSize < 1 ||
      format.fontSize > 200
    ) {
      inputError("format.fontSize must be a finite number from 1 through 200.");
    }
    normalized.fontSize = format.fontSize;
  }
  if (format.horizontalAlignment !== undefined) {
    if (!new Set(["left", "center", "right"]).has(String(format.horizontalAlignment))) {
      inputError("format.horizontalAlignment must be left, center, or right.");
    }
    normalized.horizontalAlignment = format.horizontalAlignment;
  }
  if (format.verticalAlignment !== undefined) {
    if (!new Set(["top", "middle", "bottom"]).has(String(format.verticalAlignment))) {
      inputError("format.verticalAlignment must be top, middle, or bottom.");
    }
    normalized.verticalAlignment = format.verticalAlignment;
  }
  return normalized;
}

function readOperation(value: unknown, index: number): Record<string, unknown> {
  const operation = asRecord(value, `operations[${String(index)}]`);
  const label = `operations[${String(index)}]`;
  if (typeof operation.type !== "string") inputError(`${label}.type must be a string.`);
  switch (operation.type) {
    case "set_values":
    case "set_formulas": {
      const matrixKey = operation.type === "set_values" ? "values" : "formulas";
      assertOnlyKeys(operation, ["type", "sheet", "range", matrixKey], label);
      const range = readRange(operation.range, `${label}.range`, MAX_RANGE_CELLS);
      return {
        type: operation.type,
        ...optionalSheet(operation),
        range: range.normalized,
        [matrixKey]: readMatrix(operation[matrixKey], matrixKey, range),
      };
    }
    case "clear": {
      assertOnlyKeys(operation, ["type", "sheet", "range", "include"], label);
      const range = readRange(operation.range, `${label}.range`, MAX_RANGE_CELLS);
      return {
        type: operation.type,
        ...optionalSheet(operation),
        range: range.normalized,
        include: readInclude(operation.include, ["values", "formulas", "formats"]),
      };
    }
    case "format_range": {
      assertOnlyKeys(operation, ["type", "sheet", "range", "format"], label);
      const range = readRange(operation.range, `${label}.range`, MAX_RANGE_CELLS);
      return {
        type: operation.type,
        ...optionalSheet(operation),
        range: range.normalized,
        format: readFormat(operation.format),
      };
    }
    case "insert_rows": {
      assertOnlyKeys(operation, ["type", "sheet", "before", "count"], label);
      return {
        type: operation.type,
        ...optionalSheet(operation),
        before: readPositiveInteger(operation.before, `${label}.before`, MAX_ROW),
        count: readPositiveInteger(operation.count, `${label}.count`, MAX_INSERT_DELETE_COUNT),
      };
    }
    case "delete_rows": {
      assertOnlyKeys(operation, ["type", "sheet", "start", "count"], label);
      const start = readPositiveInteger(operation.start, `${label}.start`, MAX_ROW);
      const count = readPositiveInteger(operation.count, `${label}.count`, MAX_INSERT_DELETE_COUNT);
      if (start + count - 1 > MAX_ROW) inputError(`${label} exceeds the final spreadsheet row.`);
      return { type: operation.type, ...optionalSheet(operation), start, count };
    }
    case "insert_columns": {
      assertOnlyKeys(operation, ["type", "sheet", "before", "count"], label);
      return {
        type: operation.type,
        ...optionalSheet(operation),
        before: readColumn(operation.before, `${label}.before`),
        count: readPositiveInteger(operation.count, `${label}.count`, MAX_INSERT_DELETE_COUNT),
      };
    }
    case "delete_columns": {
      assertOnlyKeys(operation, ["type", "sheet", "start", "count"], label);
      const start = readColumn(operation.start, `${label}.start`);
      const count = readPositiveInteger(operation.count, `${label}.count`, MAX_INSERT_DELETE_COUNT);
      if (columnNumber(start) + count - 1 > MAX_COLUMN) {
        inputError(`${label} exceeds the final spreadsheet column.`);
      }
      return { type: operation.type, ...optionalSheet(operation), start, count };
    }
    case "add_sheet": {
      assertOnlyKeys(operation, ["type", "name", "after"], label);
      return {
        type: operation.type,
        name: readSheet(operation.name, `${label}.name`),
        ...(operation.after === undefined
          ? {}
          : { after: readSheet(operation.after, `${label}.after`) }),
      };
    }
    case "rename_sheet": {
      assertOnlyKeys(operation, ["type", "sheet", "name"], label);
      return {
        type: operation.type,
        sheet: readSheet(operation.sheet, `${label}.sheet`),
        name: readSheet(operation.name, `${label}.name`),
      };
    }
    case "delete_sheet": {
      assertOnlyKeys(operation, ["type", "sheet"], label);
      return {
        type: operation.type,
        sheet: readSheet(operation.sheet, `${label}.sheet`),
      };
    }
    default:
      return inputError(`${label}.type is not a supported spreadsheet operation.`);
  }
}

function assertArgumentSize(args: Record<string, unknown>): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(args);
  } catch {
    return inputError("Spreadsheet arguments must be JSON-serializable.");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARGUMENT_BYTES) {
    inputError(`Spreadsheet arguments may be at most ${String(MAX_ARGUMENT_BYTES)} bytes.`);
  }
}

export function parseSpreadsheetReadArgs(args: Record<string, unknown>): Record<string, unknown> {
  assertArgumentSize(args);
  assertOnlyKeys(args, ["path", "sheet", "range", "include"], "spreadsheet_read");
  return {
    path: readPath(args.path),
    ...(args.sheet === undefined ? {} : { sheet: readSheet(args.sheet) }),
    range: readRange(args.range, "range", MAX_READ_CELLS).normalized,
    include: readInclude(args.include, ["values", "formulas"]),
  };
}

export function parseSpreadsheetBatchUpdateArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  assertArgumentSize(args);
  assertOnlyKeys(args, ["version", "path", "operations"], "spreadsheet_batch_update");
  if (args.version !== undefined && args.version !== 1) {
    inputError("spreadsheet_batch_update.version must be 1.");
  }
  if (
    !Array.isArray(args.operations) ||
    args.operations.length === 0 ||
    args.operations.length > MAX_OPERATIONS
  ) {
    inputError(`operations must contain 1 through ${String(MAX_OPERATIONS)} entries.`);
  }
  return {
    version: 1,
    path: readPath(args.path),
    operations: args.operations.map(readOperation),
  };
}

function errorResult(error: unknown) {
  const code =
    error instanceof SpreadsheetInputError
      ? "spreadsheet_invalid_input"
      : error instanceof LatticeSpreadsheetBrokerError
        ? error.code
        : "spreadsheet_tool_failed";
  const message = error instanceof Error ? error.message : "The spreadsheet tool failed.";
  return mcpToolResultError(JSON.stringify({ error: { code, message } }));
}

export const makeLatticeSpreadsheetTools = (options: {
  readonly resolveWorkspaceRoot: (context: ToolContext) => Effect.Effect<string | null>;
}) =>
  Effect.gen(function* () {
    const broker = yield* LatticeSpreadsheetBroker;
    const invoke = (
      action: "read" | "batch_update",
      parse: (args: Record<string, unknown>) => Record<string, unknown>,
      args: Record<string, unknown>,
      context: ToolContext,
    ) =>
      Effect.gen(function* () {
        const parsed = yield* Effect.try({
          try: () => parse(args),
          catch: (error) =>
            error instanceof SpreadsheetInputError
              ? error
              : new SpreadsheetInputError("Spreadsheet arguments are invalid."),
        });
        const workspaceRoot = yield* options.resolveWorkspaceRoot(context);
        if (!workspaceRoot) {
          return yield* Effect.fail(
            new LatticeSpreadsheetBrokerError(
              "spreadsheet_workspace_unavailable",
              "The caller thread has no Lattice workspace.",
            ),
          );
        }
        return yield* broker.invoke(workspaceRoot, action, parsed);
      }).pipe(
        Effect.map(mcpToolResultJson),
        Effect.catch((error) => Effect.succeed(errorResult(error))),
      );

    const read: ToolEntry = {
      requiredCapability: "thread:read",
      definition: {
        name: "spreadsheet_read",
        description:
          "Read a bounded A1 range from a workspace-relative .lattice-sheet document. Read the relevant range before editing it. Values and formulas are returned by default; request formats only when needed.",
        inputSchema: {
          type: "object",
          properties: {
            path: spreadsheetPathSchema,
            sheet: sheetSchema,
            range: rangeSchema,
            include: {
              ...includeSchema,
              default: ["values", "formulas"],
              description: "Cell facets to return. Defaults to values and formulas.",
            },
          },
          required: ["path", "range"],
          additionalProperties: false,
        },
        annotations: { title: "Read spreadsheet range", ...READ_ONLY_TOOL_ANNOTATIONS },
      },
      handler: (args, context) => invoke("read", parseSpreadsheetReadArgs, args, context),
    };

    const batchUpdate: ToolEntry = {
      requiredCapability: "thread:write",
      requiresActiveTurn: true,
      definition: {
        name: "spreadsheet_batch_update",
        description:
          "Atomically apply up to 100 bounded semantic edits to a workspace-relative .lattice-sheet document. Read the affected A1 ranges first, batch related edits together, and call spreadsheet_read afterward to verify the changed range. This versioned schema never accepts Univer command ids.",
        inputSchema: {
          type: "object",
          properties: {
            version: {
              type: "integer",
              const: 1,
              default: 1,
              description: "Semantic spreadsheet operation schema version. Defaults to 1.",
            },
            path: spreadsheetPathSchema,
            operations: operationsSchema,
          },
          required: ["path", "operations"],
          additionalProperties: false,
        },
        annotations: { title: "Update spreadsheet", ...WRITE_TOOL_ANNOTATIONS },
      },
      handler: (args, context) =>
        invoke("batch_update", parseSpreadsheetBatchUpdateArgs, args, context),
    };

    return [read, batchUpdate] satisfies ReadonlyArray<ToolEntry>;
  });
