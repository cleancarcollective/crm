/**
 * Vehicle sizing for auto-respond estimates.
 * Classifies a vehicle make/model into Small / Medium / Large / XL
 * for pricing purposes.
 *
 * Resolution order:
 *  1. Exact match in MODEL_DB
 *  2. Fuzzy bigram match in MODEL_DB
 *  3. Returns null (caller decides: needs_approval)
 */

export type VehicleSize = "Small" | "Medium" | "Large" | "XL";
export type ConfidenceLevel = "high" | "medium" | "low";

export type VehicleSizingResult = {
  size: VehicleSize;
  confidence: ConfidenceLevel;
  confNumeric: number;
  reasonCode: string;
  canonicalKey: string;
};

// ── Normalisation helpers ──────────────────────────────────────────────────

function normalizeText(s: string): string {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\- ]/g, "");
}

const MAKE_ALIASES: Record<string, string> = {
  vw: "volkswagen",
  volkeswagon: "volkswagen",
  volkwagen: "volkswagen",
  merc: "mercedes-benz",
  mercedes: "mercedes-benz",
  "mercedes benz": "mercedes-benz",
  "land rover": "land-rover",
  landrover: "land-rover",
  alfa: "alfa romeo",
  "alfa romeo": "alfa romeo",
};

export function normalizeMake(makeRaw: string): string {
  const m = normalizeText(makeRaw);
  return MAKE_ALIASES[m] || m;
}

export function normalizeModel(modelRaw: string): string {
  let m = normalizeText(modelRaw);
  // common NZ quirks
  m = m
    .replace(/\bcx[\s-]?(\d)\b/g, "cx-$1")
    .replace(/\bx[\s-]?trail\b/g, "x-trail")
    .replace(/\brav[\s-]?4\b/g, "rav4")
    .replace(/\bhi[\s-]?ace\b/g, "hiace")
    .replace(/\be[\s-]?pace\b/g, "e-pace")
    .replace(/\bf[\s-]?pace\b/g, "f-pace")
    .replace(/\bi[\s-]?pace\b/g, "i-pace")
    .replace(/\bq[\s-]?3\b/g, "q3")
    .replace(/\bq[\s-]?5\b/g, "q5")
    .replace(/\bq[\s-]?7\b/g, "q7");

  // strip noise
  m = m
    .replace(/\b(5 door|3 door|2 door)\b/g, "")
    .replace(/\b(hatch|hatchback|wagon|estate|sedan|saloon|coupe|convertible|ute|van|station)\b/g, "")
    .replace(/\b(limited|sport|touring|luxury|gt|gti|r-line|rs|st|sr|sr5|xlt|wildtrak)\b/g, "")
    .replace(/\b(auto|automatic|manual|petrol|diesel|hybrid|awd|fwd|rwd|4wd|4x4)\b/g, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\b(white|black|silver|grey|gray|blue|red|green|gold|beige|orange|yellow)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // typo corrections
  const typos: Record<string, string> = {
    alexa: "axela",
    xtrail: "x-trail",
    corrola: "corolla",
    corrolla: "corolla",
  };
  if (typos[m]) m = typos[m];

  return m;
}

type ModelDbEntry = {
  defaultSize: VehicleSize;
  confidenceBase: "high" | "low";
};

// ── Model database ─────────────────────────────────────────────────────────
// Format: "make|model" -> { defaultSize, confidenceBase }
const MODEL_DB: Record<string, ModelDbEntry> = {
  // Toyota
  "toyota|yaris": { defaultSize: "Small", confidenceBase: "high" },
  "toyota|corolla": { defaultSize: "Medium", confidenceBase: "high" },
  "toyota|axela": { defaultSize: "Medium", confidenceBase: "high" },
  "toyota|camry": { defaultSize: "Medium", confidenceBase: "high" },
  "toyota|prius": { defaultSize: "Medium", confidenceBase: "high" },
  "toyota|chr": { defaultSize: "Medium", confidenceBase: "high" },
  "toyota|c-hr": { defaultSize: "Medium", confidenceBase: "high" },
  "toyota|rav4": { defaultSize: "Large", confidenceBase: "high" },
  "toyota|kluger": { defaultSize: "Large", confidenceBase: "high" },
  "toyota|fortuner": { defaultSize: "Large", confidenceBase: "high" },
  "toyota|hilux": { defaultSize: "XL", confidenceBase: "high" },
  "toyota|hiace": { defaultSize: "XL", confidenceBase: "high" },
  "toyota|land cruiser": { defaultSize: "XL", confidenceBase: "high" },
  "toyota|landcruiser": { defaultSize: "XL", confidenceBase: "high" },
  "toyota|prado": { defaultSize: "Large", confidenceBase: "high" },
  "toyota|86": { defaultSize: "Small", confidenceBase: "high" },
  "toyota|gr86": { defaultSize: "Small", confidenceBase: "high" },
  "toyota|vitz": { defaultSize: "Small", confidenceBase: "high" },
  "toyota|wish": { defaultSize: "Medium", confidenceBase: "high" },
  "toyota|noah": { defaultSize: "Large", confidenceBase: "high" },
  "toyota|alphard": { defaultSize: "XL", confidenceBase: "high" },
  "toyota|tarago": { defaultSize: "XL", confidenceBase: "high" },
  "toyota|estima": { defaultSize: "XL", confidenceBase: "high" },
  // Honda
  "honda|jazz": { defaultSize: "Small", confidenceBase: "high" },
  "honda|fit": { defaultSize: "Small", confidenceBase: "high" },
  "honda|civic": { defaultSize: "Medium", confidenceBase: "high" },
  "honda|accord": { defaultSize: "Medium", confidenceBase: "high" },
  "honda|hr-v": { defaultSize: "Medium", confidenceBase: "high" },
  "honda|hrv": { defaultSize: "Medium", confidenceBase: "high" },
  "honda|cr-v": { defaultSize: "Large", confidenceBase: "high" },
  "honda|crv": { defaultSize: "Large", confidenceBase: "high" },
  "honda|pilot": { defaultSize: "Large", confidenceBase: "high" },
  "honda|odyssey": { defaultSize: "XL", confidenceBase: "high" },
  // Mazda
  "mazda|mazda2": { defaultSize: "Small", confidenceBase: "high" },
  "mazda|2": { defaultSize: "Small", confidenceBase: "high" },
  "mazda|mazda3": { defaultSize: "Medium", confidenceBase: "high" },
  "mazda|3": { defaultSize: "Medium", confidenceBase: "high" },
  "mazda|mazda6": { defaultSize: "Medium", confidenceBase: "high" },
  "mazda|6": { defaultSize: "Medium", confidenceBase: "high" },
  "mazda|cx-3": { defaultSize: "Medium", confidenceBase: "high" },
  "mazda|cx3": { defaultSize: "Medium", confidenceBase: "high" },
  "mazda|cx-5": { defaultSize: "Large", confidenceBase: "high" },
  "mazda|cx5": { defaultSize: "Large", confidenceBase: "high" },
  "mazda|cx-8": { defaultSize: "Large", confidenceBase: "high" },
  "mazda|cx8": { defaultSize: "Large", confidenceBase: "high" },
  "mazda|cx-9": { defaultSize: "Large", confidenceBase: "high" },
  "mazda|cx9": { defaultSize: "Large", confidenceBase: "high" },
  "mazda|bt-50": { defaultSize: "XL", confidenceBase: "high" },
  "mazda|bt50": { defaultSize: "XL", confidenceBase: "high" },
  // Subaru
  "subaru|impreza": { defaultSize: "Medium", confidenceBase: "high" },
  "subaru|wrx": { defaultSize: "Medium", confidenceBase: "high" },
  "subaru|sti": { defaultSize: "Medium", confidenceBase: "high" },
  "subaru|levorg": { defaultSize: "Medium", confidenceBase: "high" },
  "subaru|legacy": { defaultSize: "Medium", confidenceBase: "high" },
  "subaru|xv": { defaultSize: "Medium", confidenceBase: "high" },
  "subaru|forester": { defaultSize: "Large", confidenceBase: "high" },
  "subaru|outback": { defaultSize: "Large", confidenceBase: "high" },
  // Nissan
  "nissan|micra": { defaultSize: "Small", confidenceBase: "high" },
  "nissan|note": { defaultSize: "Small", confidenceBase: "high" },
  "nissan|march": { defaultSize: "Small", confidenceBase: "high" },
  "nissan|tiida": { defaultSize: "Medium", confidenceBase: "high" },
  "nissan|leaf": { defaultSize: "Medium", confidenceBase: "high" },
  "nissan|sentra": { defaultSize: "Medium", confidenceBase: "high" },
  "nissan|qashqai": { defaultSize: "Medium", confidenceBase: "high" },
  "nissan|juke": { defaultSize: "Medium", confidenceBase: "high" },
  "nissan|x-trail": { defaultSize: "Large", confidenceBase: "high" },
  "nissan|xtrail": { defaultSize: "Large", confidenceBase: "high" },
  "nissan|murano": { defaultSize: "Large", confidenceBase: "high" },
  "nissan|pathfinder": { defaultSize: "Large", confidenceBase: "high" },
  "nissan|navara": { defaultSize: "XL", confidenceBase: "high" },
  "nissan|patrol": { defaultSize: "XL", confidenceBase: "high" },
  "nissan|elgrand": { defaultSize: "XL", confidenceBase: "high" },
  // Hyundai
  "hyundai|i20": { defaultSize: "Small", confidenceBase: "high" },
  "hyundai|i30": { defaultSize: "Medium", confidenceBase: "high" },
  "hyundai|elantra": { defaultSize: "Medium", confidenceBase: "high" },
  "hyundai|kona": { defaultSize: "Medium", confidenceBase: "high" },
  "hyundai|ioniq": { defaultSize: "Medium", confidenceBase: "high" },
  "hyundai|tucson": { defaultSize: "Large", confidenceBase: "high" },
  "hyundai|santa fe": { defaultSize: "Large", confidenceBase: "high" },
  "hyundai|palisade": { defaultSize: "Large", confidenceBase: "high" },
  "hyundai|staria": { defaultSize: "XL", confidenceBase: "high" },
  // Kia
  "kia|picanto": { defaultSize: "Small", confidenceBase: "high" },
  "kia|rio": { defaultSize: "Small", confidenceBase: "high" },
  "kia|cerato": { defaultSize: "Medium", confidenceBase: "high" },
  "kia|forte": { defaultSize: "Medium", confidenceBase: "high" },
  "kia|stinger": { defaultSize: "Medium", confidenceBase: "high" },
  "kia|seltos": { defaultSize: "Medium", confidenceBase: "high" },
  "kia|niro": { defaultSize: "Medium", confidenceBase: "high" },
  "kia|sportage": { defaultSize: "Large", confidenceBase: "high" },
  "kia|sorento": { defaultSize: "Large", confidenceBase: "high" },
  "kia|carnival": { defaultSize: "XL", confidenceBase: "high" },
  // Ford
  "ford|fiesta": { defaultSize: "Small", confidenceBase: "high" },
  "ford|focus": { defaultSize: "Medium", confidenceBase: "high" },
  "ford|mustang": { defaultSize: "Medium", confidenceBase: "high" },
  "ford|escape": { defaultSize: "Large", confidenceBase: "high" },
  "ford|kuga": { defaultSize: "Large", confidenceBase: "high" },
  "ford|everest": { defaultSize: "Large", confidenceBase: "high" },
  "ford|explorer": { defaultSize: "Large", confidenceBase: "high" },
  "ford|ranger": { defaultSize: "XL", confidenceBase: "high" },
  "ford|transit": { defaultSize: "XL", confidenceBase: "high" },
  // Mitsubishi
  "mitsubishi|mirage": { defaultSize: "Small", confidenceBase: "high" },
  "mitsubishi|asx": { defaultSize: "Medium", confidenceBase: "high" },
  "mitsubishi|eclipse cross": { defaultSize: "Medium", confidenceBase: "high" },
  "mitsubishi|outlander": { defaultSize: "Large", confidenceBase: "high" },
  "mitsubishi|pajero": { defaultSize: "Large", confidenceBase: "high" },
  "mitsubishi|triton": { defaultSize: "XL", confidenceBase: "high" },
  // Volkswagen
  "volkswagen|polo": { defaultSize: "Small", confidenceBase: "high" },
  "volkswagen|golf": { defaultSize: "Medium", confidenceBase: "high" },
  "volkswagen|jetta": { defaultSize: "Medium", confidenceBase: "high" },
  "volkswagen|passat": { defaultSize: "Medium", confidenceBase: "high" },
  "volkswagen|tiguan": { defaultSize: "Large", confidenceBase: "high" },
  "volkswagen|touareg": { defaultSize: "Large", confidenceBase: "high" },
  "volkswagen|transporter": { defaultSize: "XL", confidenceBase: "high" },
  // BMW
  "bmw|1 series": { defaultSize: "Small", confidenceBase: "high" },
  "bmw|2 series": { defaultSize: "Small", confidenceBase: "high" },
  "bmw|3 series": { defaultSize: "Medium", confidenceBase: "high" },
  "bmw|4 series": { defaultSize: "Medium", confidenceBase: "high" },
  "bmw|5 series": { defaultSize: "Medium", confidenceBase: "high" },
  "bmw|x1": { defaultSize: "Medium", confidenceBase: "high" },
  "bmw|x3": { defaultSize: "Large", confidenceBase: "high" },
  "bmw|x5": { defaultSize: "Large", confidenceBase: "high" },
  "bmw|x7": { defaultSize: "XL", confidenceBase: "high" },
  // Mercedes-Benz
  "mercedes-benz|a-class": { defaultSize: "Small", confidenceBase: "high" },
  "mercedes-benz|a class": { defaultSize: "Small", confidenceBase: "high" },
  "mercedes-benz|c-class": { defaultSize: "Medium", confidenceBase: "high" },
  "mercedes-benz|c class": { defaultSize: "Medium", confidenceBase: "high" },
  "mercedes-benz|e-class": { defaultSize: "Medium", confidenceBase: "high" },
  "mercedes-benz|e class": { defaultSize: "Medium", confidenceBase: "high" },
  "mercedes-benz|glc": { defaultSize: "Large", confidenceBase: "high" },
  "mercedes-benz|gle": { defaultSize: "Large", confidenceBase: "high" },
  "mercedes-benz|gls": { defaultSize: "XL", confidenceBase: "high" },
  "mercedes-benz|vito": { defaultSize: "XL", confidenceBase: "high" },
  // Audi
  "audi|a1": { defaultSize: "Small", confidenceBase: "high" },
  "audi|a3": { defaultSize: "Medium", confidenceBase: "high" },
  "audi|a4": { defaultSize: "Medium", confidenceBase: "high" },
  "audi|a5": { defaultSize: "Medium", confidenceBase: "high" },
  "audi|a6": { defaultSize: "Medium", confidenceBase: "high" },
  "audi|q3": { defaultSize: "Medium", confidenceBase: "high" },
  "audi|q5": { defaultSize: "Large", confidenceBase: "high" },
  "audi|q7": { defaultSize: "Large", confidenceBase: "high" },
  // Suzuki
  "suzuki|swift": { defaultSize: "Small", confidenceBase: "high" },
  "suzuki|baleno": { defaultSize: "Small", confidenceBase: "high" },
  "suzuki|ignis": { defaultSize: "Small", confidenceBase: "high" },
  "suzuki|vitara": { defaultSize: "Medium", confidenceBase: "high" },
  "suzuki|s-cross": { defaultSize: "Medium", confidenceBase: "high" },
  "suzuki|jimny": { defaultSize: "Medium", confidenceBase: "high" },
  // Land Rover
  "land-rover|discovery": { defaultSize: "Large", confidenceBase: "high" },
  "land-rover|discovery sport": { defaultSize: "Large", confidenceBase: "high" },
  "land-rover|range rover": { defaultSize: "XL", confidenceBase: "high" },
  "land-rover|defender": { defaultSize: "XL", confidenceBase: "high" },
  // Lexus
  "lexus|ct": { defaultSize: "Small", confidenceBase: "high" },
  "lexus|is": { defaultSize: "Medium", confidenceBase: "high" },
  "lexus|es": { defaultSize: "Medium", confidenceBase: "high" },
  "lexus|gs": { defaultSize: "Medium", confidenceBase: "high" },
  "lexus|nx": { defaultSize: "Medium", confidenceBase: "high" },
  "lexus|rx": { defaultSize: "Large", confidenceBase: "high" },
  "lexus|lx": { defaultSize: "XL", confidenceBase: "high" },
  // Volvo
  "volvo|s60": { defaultSize: "Medium", confidenceBase: "high" },
  "volvo|v60": { defaultSize: "Medium", confidenceBase: "high" },
  "volvo|xc40": { defaultSize: "Medium", confidenceBase: "high" },
  "volvo|xc60": { defaultSize: "Large", confidenceBase: "high" },
  "volvo|xc90": { defaultSize: "Large", confidenceBase: "high" },
  // Isuzu
  "isuzu|d-max": { defaultSize: "XL", confidenceBase: "high" },
  "isuzu|dmax": { defaultSize: "XL", confidenceBase: "high" },
  "isuzu|mu-x": { defaultSize: "Large", confidenceBase: "high" },
  // Great Wall / GWM
  "gwm|ute": { defaultSize: "XL", confidenceBase: "high" },
  "gwm|cannon": { defaultSize: "XL", confidenceBase: "high" },
  "gwm|haval h6": { defaultSize: "Large", confidenceBase: "high" },
};

// ── Fuzzy bigram similarity ────────────────────────────────────────────────

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    const out = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

const FUZZY_MIN = 0.82;
const FUZZY_HIGH = 0.91;

// ── Public API ─────────────────────────────────────────────────────────────

export function classifyVehicle(
  makeRaw: string,
  modelRaw: string
): VehicleSizingResult | null {
  const makeNorm = normalizeMake(makeRaw);
  const modelNorm = normalizeModel(modelRaw);
  const exactKey = `${makeNorm}|${modelNorm}`;

  // 1. Exact match
  if (MODEL_DB[exactKey]) {
    const rec = MODEL_DB[exactKey];
    return {
      size: rec.defaultSize,
      confidence: rec.confidenceBase === "high" ? "high" : "low",
      confNumeric: rec.confidenceBase === "high" ? 0.95 : 0.60,
      reasonCode: "model_db",
      canonicalKey: exactKey,
    };
  }

  // 2. Fuzzy match (same make only)
  let bestKey = "";
  let bestScore = 0;
  for (const key of Object.keys(MODEL_DB)) {
    const [mk, mdl] = key.split("|");
    if (mk !== makeNorm) continue;
    const score = similarity(modelNorm, mdl);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (bestScore >= FUZZY_MIN && bestKey) {
    const rec = MODEL_DB[bestKey];
    const confidence: ConfidenceLevel = bestScore >= FUZZY_HIGH ? "high" : "medium";
    return {
      size: rec.defaultSize,
      confidence,
      confNumeric: bestScore,
      reasonCode: "fuzzy_match",
      canonicalKey: bestKey,
    };
  }

  return null; // unknown — caller sets needs_approval
}
