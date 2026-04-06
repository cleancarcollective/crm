type VehicleInput = {
  vehicle_year?: string;
  vehicle_make?: string;
  vehicle_model?: string;
};

export type ParsedLeadVehicle = {
  year: string | null;
  make: string | null;
  model: string | null;
  raw: string | null;
};

function clean(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseLeadVehicleInput(input: VehicleInput): ParsedLeadVehicle {
  const explicitYear = clean(input.vehicle_year);
  const explicitMake = clean(input.vehicle_make);
  const explicitModel = clean(input.vehicle_model);

  if (explicitYear || explicitMake || explicitModel) {
    if (explicitModel || explicitYear) {
      return {
        year: explicitYear,
        make: explicitMake,
        model: explicitModel,
        raw: [explicitYear, explicitMake, explicitModel].filter(Boolean).join(" ") || explicitMake,
      };
    }

    const combined = explicitMake;
    if (!combined) {
      return { year: null, make: null, model: null, raw: null };
    }

    const yearMatch = combined.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch?.[0] ?? null;
    const withoutYear = combined.replace(/\b(19|20)\d{2}\b/, "").replace(/\s+/g, " ").trim();

    if (!withoutYear) {
      return { year, make: combined, model: null, raw: combined };
    }

    const parts = withoutYear.split(" ");
    return {
      year,
      make: parts[0] ?? null,
      model: parts.slice(1).join(" ") || null,
      raw: combined,
    };
  }

  return { year: null, make: null, model: null, raw: null };
}
