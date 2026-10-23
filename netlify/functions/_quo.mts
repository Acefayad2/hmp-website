// Server-side Quo (OpenPhone) texts. The API key is read only from QUO_API_KEY.
const DEFAULT_FROM_NUMBER = "+14437855238";
const DEFAULT_API_BASE = "https://api.openphone.com/v1";

export class SmsError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "SmsError";
    this.status = status;
  }
}

const readSetting = (name: string) => {
  const value = typeof Netlify === "undefined" ? undefined : Netlify.env.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** US 10-digit numbers gain +1. Numbers that already include + keep their country code. */
export const toE164 = (value: unknown) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  let normalized = "";
  if (trimmed.startsWith("+")) normalized = `+${digits}`;
  else if (digits.length === 10) normalized = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) normalized = `+${digits}`;
  else return "";
  const numeric = normalized.slice(1);
  if (numeric.length < 10 || numeric.length > 15) return "";
  return normalized;
};

export const quoConfig = () => {
  const apiKey = readSetting("QUO_API_KEY");
  const configuredFrom = readSetting("QUO_FROM_NUMBER");
  const from = configuredFrom ? toE164(configuredFrom) : DEFAULT_FROM_NUMBER;
  if (!from) throw new SmsError("QUO_FROM_NUMBER must be a valid E.164 number such as +14437855238.", 503);
  const phoneNumberId = readSetting("QUO_PHONE_NUMBER_ID");
  const configuredBase = readSetting("QUO_API_BASE") || DEFAULT_API_BASE;
  let base: URL;
  try {
    base = new URL(configuredBase);
  } catch {
    throw new SmsError("QUO_API_BASE must be an https URL.", 503);
  }
  if (base.protocol !== "https:") throw new SmsError("QUO_API_BASE must use https.", 503);
  const root = base.toString().replace(/\/+$/, "");
  return {
    apiKey,
    from,
    phoneNumberId,
    endpoint: root.endsWith("/messages") ? root : `${root}/messages`,
  };
};

const providerDetail = (payload: unknown, apiKey: string) => {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  const raw = [record.message, nested.message, typeof record.error === "string" ? record.error : ""]
    .find((value) => typeof value === "string" && value.trim()) as string | undefined;
  if (!raw) return "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const redacted = apiKey ? cleaned.split(apiKey).join("") : cleaned;
  if (!redacted.trim() || /authorization|bearer|api[_ ]?key/i.test(redacted)) return "";
  return redacted.trim().slice(0, 160);
};

const quoFailureMessage = (status: number, payload: unknown, apiKey: string) => {
  if (status === 401 || status === 403) {
    return "Quo refused the text. Check QUO_API_KEY, QUO_FROM_NUMBER, and that A2P 10DLC is still approved.";
  }
  if (status === 429) return "Quo is rate limiting texts. Wait a moment and try again.";
  const detail = providerDetail(payload, apiKey);
  return detail
    ? `Quo did not accept the text. ${detail}`
    : "Quo did not accept the text. Nothing was delivered.";
};

export const sendQuoMessage = async ({
  to,
  content,
  fetchFn = fetch,
}: {
  to: string;
  content: string;
  fetchFn?: typeof fetch;
}) => {
  const config = quoConfig();
  if (!config.apiKey) throw new SmsError("Texting is not configured. Add QUO_API_KEY on the HMP site.", 503);
  const destination = toE164(to);
  if (!destination) throw new SmsError("Enter a valid mobile number, including the area code.", 400);
  const text = content.trim();
  if (!text) throw new SmsError("Enter a text message.", 400);
  if (text.length > 1600) throw new SmsError("Text messages can be at most 1,600 characters.", 400);
  const payload: Record<string, unknown> = { from: config.from, to: [destination], content: text };
  if (config.phoneNumberId) payload.phoneNumberId = config.phoneNumberId;
  let response: Response;
  try {
    response = await fetchFn(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new SmsError("Quo could not be reached. The text was not sent.", 502);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new SmsError(quoFailureMessage(response.status, body, config.apiKey), 502);
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const nested = data.data && typeof data.data === "object" ? data.data as Record<string, unknown> : {};
  const providerId = String(nested.id || data.id || "").slice(0, 120);
  return { providerId, to: destination, from: config.from };
};
