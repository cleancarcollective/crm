/**
 * Smoke test for the LLM vehicle-size classifier. Hits OpenRouter for
 * each test case and prints what size + confidence Claude returns.
 *
 * Run: npx tsx scripts/test-llm-size.ts
 */

import fs from "node:fs";
import path from "node:path";

function loadEnv(file: string) {
  const envPath = path.join(process.cwd(), file);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv(".env.local");
loadEnv(".env.vercel.local");

import { classifyVehicleViaLlm } from "@/lib/autorespond/llmVehicleSize";

const CASES: Array<[string, string, string | null, string]> = [
  // [make, model, year, expectedSize]
  ["Porsche", "911 Turbo S", "2008", "Medium"],
  ["Porsche", "Cayenne", "2020", "Large"],
  ["Tesla", "Model 3", "2022", "Medium"],
  ["Tesla", "Model Y", "2023", "Large"],
  ["Tesla", "Model X", "2024", "XL"],
  ["Tesla", "Model S", "2021", "Large"],
  ["Lexus", "RX350", "2020", "Large"],
  ["Lexus", "IS300h", "2019", "Medium"],
  ["Lexus", "LX570", "2018", "XL"],
  ["Land Rover", "Discovery", "2019", "Large"],
  ["Land Rover", "Range Rover Sport", "2021", "XL"],
  ["Range Rover", "Evoque", "2020", "Medium"],
  ["Volvo", "XC60", "2022", "Large"],
  ["Volvo", "XC90", "2023", "XL"],
  ["Volvo", "V40", "2018", "Medium"],
  ["Suzuki", "Swift", "2021", "Small"],
  ["Suzuki", "Jimny", "2022", "Small"],
  ["Suzuki", "Vitara", "2020", "Medium"],
  ["Isuzu", "D-Max", "2021", "XL"],
  ["Mini", "Cooper", "2019", "Small"],
  ["Mini", "Countryman", "2020", "Medium"],
  ["Holden", "Commodore", "2017", "Medium"],
  ["Holden", "Colorado", "2019", "XL"],
  ["Ferrari", "458 Italia", "2012", "Medium"],
  ["Aston Martin", "Vantage", "2020", "Medium"],
  ["Maserati", "Levante", "2021", "Large"],
  // Tricky / typo cases
  ["porsche", "carrera 4s", "2015", "Medium"],
  ["BMW", "X4", "2022", "Large"],
  ["BMW", "M3", "2023", "Medium"],
  ["", "Atara S", "2013", "?"], // missing make
  ["Random", "MadeUp", "2024", "?"], // gibberish
];

function emoji(actual: string, expected: string) {
  if (expected === "?") return "?";
  return actual === expected ? "✓" : "✗";
}

async function main() {
  let agreement = 0;
  let testable = 0;
  for (const [make, model, year, expected] of CASES) {
    process.stdout.write(`${(make + "/" + model).padEnd(40)} ${(year ?? "—").padEnd(6)} `);
    const r = await classifyVehicleViaLlm(make, model, year);
    if (!r) {
      console.log("(null — LLM failed or below threshold)");
      continue;
    }
    const flag = emoji(r.size, expected);
    if (expected !== "?") { testable++; if (r.size === expected) agreement++; }
    console.log(`${flag}  ${r.size.padEnd(7)} ${(r.confidence * 100).toFixed(0).padStart(3)}%   ${r.rationale}`);
  }
  console.log(`\n${agreement}/${testable} matched expected sizes.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
