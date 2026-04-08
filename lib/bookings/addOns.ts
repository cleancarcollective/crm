function cleanValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

function normalizeList(values: string[]) {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !["none", "n/a", "na"].includes(value.toLowerCase()));
}

function fromCsv(value: string) {
  return normalizeList(value.split(","));
}

function fromUnknownArray(values: unknown[]) {
  return normalizeList(
    values.flatMap((value) => {
      if (typeof value === "string") {
        return [value];
      }

      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return [record.name, record.title, record.label].filter((entry): entry is string => typeof entry === "string");
      }

      return [];
    })
  );
}

function fromSummaryText(summary: string) {
  const match = summary.match(/^ADD-ONS:\s*(.+)$/im);
  if (!match) {
    return [];
  }

  return fromCsv(match[1]);
}

export function getBookingAddOns(rawPayload: Record<string, unknown> | null | undefined) {
  if (!rawPayload) {
    return [] as string[];
  }

  const arrayCandidates = [
    rawPayload.add_ons,
    rawPayload.add_ons_array,
    rawPayload.addons,
    rawPayload.addons_array,
    rawPayload.selectedAddOns,
  ];

  for (const candidate of arrayCandidates) {
    if (Array.isArray(candidate)) {
      const parsed = fromUnknownArray(candidate);
      if (parsed.length > 0) {
        return parsed;
      }
    }
  }

  const stringCandidates = [
    cleanValue(rawPayload.add_ons),
    cleanValue(rawPayload.addons),
    cleanValue(rawPayload["Add-Ons"]),
    cleanValue(rawPayload["ADD-ONS"]),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of stringCandidates) {
    const parsed = fromCsv(candidate);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  const summaryCandidates = [
    cleanValue(rawPayload.Details),
    cleanValue(rawPayload.notes),
    cleanValue(rawPayload.summary),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of summaryCandidates) {
    const parsed = fromSummaryText(candidate);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  return [] as string[];
}

export function getBookingAddOnsLabel(rawPayload: Record<string, unknown> | null | undefined) {
  const addOns = getBookingAddOns(rawPayload);
  return addOns.length > 0 ? addOns.join(", ") : "None";
}
