/**
 * Parses CSV or XLSX upload into an array of row objects.
 * Uses the first row as headers.
 */

export async function parseImportFile(buffer: Buffer, filename: string): Promise<Record<string, string>[]> {
  const ext = filename.toLowerCase().split(".").pop();

  if (ext === "csv") {
    return parseCsv(buffer.toString("utf-8"));
  }

  if (ext === "xlsx" || ext === "xls") {
    return parseXlsx(buffer);
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.every((v) => !v.trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseXlsx(buffer: Buffer): Record<string, string>[] {
  // Minimal XLSX parser — reads first sheet, first row as headers
  // We use a basic approach without external deps by parsing the XML inside the zip

  try {
    // Try to use xlsx if available (installed in project)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx") as typeof import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
    return json.map((row) =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [String(k).trim(), String(v ?? "").trim()]))
    );
  } catch {
    throw new Error("XLSX parsing requires the xlsx package. Please upload a CSV file instead.");
  }
}
