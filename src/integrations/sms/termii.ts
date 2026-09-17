import { env } from "@/lib/env";

function configured(): boolean {
  return Boolean(
    env.TERMII_BASE_URL && env.TERMII_API_KEY && env.TERMII_SENDER_ID,
  );
}

export function normalizeTermiiRecipient(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) {
    return `${env.TERMII_DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
  }
  return digits;
}

export async function sendTransactionalSms(params: {
  to: string;
  message: string;
}): Promise<"disabled" | "sent"> {
  if (!configured()) return "disabled";
  const recipient = normalizeTermiiRecipient(params.to);
  if (!recipient) throw new Error("The SMS recipient phone number is invalid.");

  const endpoint = new URL("api/sms/send", `${env.TERMII_BASE_URL}/`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: env.TERMII_API_KEY,
      to: recipient,
      from: env.TERMII_SENDER_ID,
      sms: params.message,
      type: "plain",
      channel: env.TERMII_CHANNEL,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Termii returned HTTP ${response.status}.`);
  }

  const result = (await response.json()) as { code?: string };
  if (result.code !== "ok") {
    throw new Error("Termii did not accept the SMS message.");
  }
  return "sent";
}
