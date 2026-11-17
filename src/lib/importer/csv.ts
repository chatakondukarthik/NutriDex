/**
 * Generic CSV importer.
 *
 * Reads a CSV (with header row) and yields rows as objects keyed by header.
 * Implements the parts of RFC 4180 that matter for food composition tables:
 * quoted fields, escaped quotes (`""`), and newlines inside a quoted field.
 *
 * The previous version split on newlines first, so a quoted field containing
 * a line break became two broken rows, and it had no row cap — a 20 MB paste
 * could allocate millions of objects before the importer ever ran.
 */

/** Far above a real food table, low enough to bound memory. */
const MAX_CSV_ROWS = 50_000;

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records = parseRecords(text);
  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0].map((h) => h.trim());
  if (records.length - 1 > MAX_CSV_ROWS) {
    throw new Error(`That CSV has more than ${MAX_CSV_ROWS} rows — import it in smaller batches.`);
  }
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    // Headers come from the file, so keys like "__proto__" or
    // "constructor" are attacker-controlled: a null-prototype row has no
    // inherited properties to shadow or pollute.
    const row: Record<string, string> = Object.create(null);
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

/**
 * Split the whole document into records.
 *
 * A record ends at an unquoted newline. `\r\n` and a bare `\r` both count.
 * Blank lines are skipped. Empty records from a trailing newline are
 * dropped so a normal file does not gain a phantom row.
 */
function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  const pushField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };

  const pushRecord = () => {
    pushField();
    // Ignore a blank line (a single empty field, never quoted).
    if (!(record.length === 1 && record[0] === "")) {
      records.push(record);
      // Abort during the scan instead of parsing the whole document and
      // checking afterwards: the point of the cap is to avoid allocating
      // millions of rows. The header is one record, so allow cap + 1.
      if (records.length > MAX_CSV_ROWS + 1) {
        throw new Error(
          `That CSV has more than ${MAX_CSV_ROWS} rows — import it in smaller batches.`,
        );
      }
    }
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRecord();
    } else if (ch === "\r") {
      // Consume the `\n` of a `\r\n` pair in the same record break.
      if (text[i + 1] === "\n") i++;
      pushRecord();
    } else {
      field += ch;
      fieldStarted = true;
    }
  }

  // A quote opened but never closed swallowed the rest of the file into one
  // field. That is a broken file, not a valid row — say so.
  if (inQuotes) {
    throw new Error("That CSV has an unterminated quoted field.");
  }

  // A file that does not end in a newline still has one final record.
  if (fieldStarted || field !== "" || record.length > 0) pushRecord();

  return records;
}
