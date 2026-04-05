export function cleanString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeEmail(value: unknown) {
  const email = cleanString(value);
  return email ? email.toLowerCase() : null;
}

export function normalizePhone(value: unknown) {
  const phone = cleanString(value);

  if (!phone) {
    return null;
  }

  const normalized = phone.replace(/[^\d+]/g, "");
  return normalized.length > 0 ? normalized : null;
}

export function normalizeRego(value: unknown) {
  const rego = cleanString(value);

  if (!rego) {
    return null;
  }

  return rego.replace(/\s+/g, "").toUpperCase();
}

export function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
