import * as XLSX from "xlsx";

const files = process.argv.slice(2);
for (const file of files) {
  console.log("\n=== ", file, " ===");
  const wb = XLSX.readFile(file);
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]!;
    const json = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
    console.log(`\nSheet: ${sheetName}  (${json.length} rows)`);
    if (json.length > 0) {
      console.log("Columns:");
      for (const k of Object.keys(json[0]!)) console.log(`  - ${k}`);
      console.log("\nFirst 3 rows:");
      for (const row of json.slice(0, 3)) {
        console.log(JSON.stringify(row, null, 2));
      }
    }
  }
}
