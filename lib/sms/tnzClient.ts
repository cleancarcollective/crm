/**
 * TNZ Group SMS client
 * Docs: https://www.tnz.co.nz/Docs/RestAPI/
 * Auth: Basic [TNZ_AUTH_TOKEN] in Authorization header
 */

const TNZ_API_BASE = "https://api.tnz.co.nz/api/v2.04";

type TnzSmsPayload = {
  MessageData: {
    Message: string;
    Destinations: Array<{ Recipient: string }>;
    /** Optional — defaults to your account sender ID */
    From?: string;
  };
};

type TnzSmsResult =
  | { success: true; messageId: string }
  | { success: false; error: string };

function getAuthToken(): string {
  const token = process.env["TNZ_AUTH_TOKEN"];
  if (!token) throw new Error("Missing TNZ_AUTH_TOKEN environment variable");
  return token;
}

/**
 * Normalise a NZ phone number to E.164 format (+64...).
 * Handles: 021..., 027..., 022..., 0800..., +64..., 64...
 */
export function normaliseNzPhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().+]/g, "");

  if (!digits) return null;

  // Already E.164
  if (digits.startsWith("64") && digits.length >= 11) {
    return `+${digits}`;
  }

  // Local NZ format starting with 0
  if (digits.startsWith("0") && digits.length >= 9) {
    return `+64${digits.slice(1)}`;
  }

  return null;
}

/**
 * Send an SMS via TNZ Group REST API.
 * Returns { success: true, messageId } or { success: false, error }.
 */
export async function sendTnzSms(
  toPhone: string,
  message: string
): Promise<TnzSmsResult> {
  const recipient = normaliseNzPhone(toPhone);

  if (!recipient) {
    return { success: false, error: `Could not normalise phone number: ${toPhone}` };
  }

  const payload: TnzSmsPayload = {
    MessageData: {
      Message: message,
      Destinations: [{ Recipient: recipient }],
    },
  };

  try {
    const response = await fetch(`${TNZ_API_BASE}/send/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; encoding='utf-8'",
        "Accept": "application/json; encoding='utf-8'",
        "Authorization": `Basic ${getAuthToken()}`,
      },
      body: JSON.stringify(payload),
    });

    const json = (await response.json()) as { Result?: string; MessageID?: string; ErrorMessage?: string };

    if (!response.ok || json.Result !== "Success") {
      const errMsg = json.ErrorMessage ?? `HTTP ${response.status}`;
      console.error("TNZ SMS send failed", { recipient, error: errMsg });
      return { success: false, error: errMsg };
    }

    console.info("TNZ SMS sent", { recipient, messageId: json.MessageID });
    return { success: true, messageId: json.MessageID ?? "" };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown TNZ error";
    console.error("TNZ SMS request threw", { recipient, error: errMsg });
    return { success: false, error: errMsg };
  }
}
