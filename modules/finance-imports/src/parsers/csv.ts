/**
 * RFC 4180 CSV reader, used by every statement plugin.
 *
 * Splitting on the delimiter is not an option. The C6 account export quotes 30
 * of its rows — for trailing whitespace, as it happens, not embedded commas —
 * and a split would leave literal `"` characters inside those descriptions. A
 * delimiter inside quotes is rarer but allowed by the format, and there the
 * damage is worse and silent: the row still has a plausible shape, so nothing
 * raises until a number lands in the wrong column.
 */

/** A field-count mismatch, named so the caller can say which line was bad. */
export class CsvError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "CsvError";
  }
}

/**
 * Parse `text` into rows of fields. Handles quoted fields, escaped quotes
 * (`""`), delimiters and newlines inside quotes, and both CRLF and LF.
 * Trailing whitespace inside a quoted field is preserved — the C6 export has
 * it, and trimming would silently rewrite the source.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && !started) {
      quoted = true;
      started = true;
      continue;
    }
    if (char === delimiter) {
      endField();
      started = false;
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      endRow();
      continue;
    }
    field += char;
    started = true;
  }

  // A file that does not end in a newline still has a last row.
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Rows as objects keyed by the header, with the field count checked per line.
 *
 * The count check is the guard the card export needs: it quotes nothing, so a
 * description containing the delimiter would produce an extra field. Failing
 * with the line number beats importing a row whose columns have all shifted by
 * one.
 */
export function parseCsvRecords(
  text: string,
  delimiter: string,
  options: {
    /**
     * Which row is the header. Needed for exports that open with prose: the C6
     * account statement's first non-blank line is its own title, and taking
     * that as the header makes every data row a field-count error. A plugin
     * that knows its columns says so.
     */
    isHeader?: (row: string[]) => boolean;
  } = {},
): Record<string, string>[] {
  const rows = parseCsv(text, delimiter);
  const looksLikeHeader =
    options.isHeader ??
    ((row: string[]) => row.some((cell) => cell.trim() !== ""));
  const headerIndex = rows.findIndex(looksLikeHeader);
  const headerRow = headerIndex === -1 ? undefined : rows[headerIndex];
  if (!headerRow) return [];
  const columns = headerRow.map((name) => name.trim());

  const records: Record<string, string>[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    // Blank lines are structure, not data — the C6 export has them.
    if (row.every((cell) => cell.trim() === "")) continue;
    if (row.length !== columns.length) {
      throw new CsvError(
        `expected ${columns.length} fields, found ${row.length}`,
        i + 1,
      );
    }
    const record: Record<string, string> = {};
    columns.forEach((name, index) => {
      record[name] = row[index] ?? "";
    });
    records.push(record);
  }
  return records;
}
