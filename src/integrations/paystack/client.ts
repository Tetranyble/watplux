import { env } from "@/lib/env";
import type {
  CreateRefundParams,
  CreateRefundResult,
  InitializeTransactionParams,
  InitializeTransactionResult,
  VerifyTransactionResult,
} from "@/src/integrations/paystack/types";
// The payment module owns the integration interface; this file supplies the
// default real implementation. Tests inject a fake through the same seam.
import type { PaystackClient } from "@/src/modules/payment/types";

/**
 * Thin, typed Paystack REST client — no business logic
 * (docs/PHASE_8_PAYMENT_PAYSTACK_PLAN.md §7). Uses native `fetch` (no new
 * HTTP dependency). Every function either returns a narrow, typed result
 * or throws `PaystackApiError`/`PaystackConfigError` — it never decides
 * what a response means for our order/payment/inventory state; that
 * interpretation lives entirely in `src/modules/payment/`'s use-cases.
 *
 * Never imports a repo, use-case, domain, or job module — a pure leaf
 * dependency, called *by* the payment module, never the reverse.
 */

const PAYSTACK_API_BASE = "https://api.paystack.co";

/** Thrown when `PAYSTACK_SECRET_KEY` is not configured — a deployment/
 * configuration error, never something a caller should catch and treat
 * as a business outcome. */
export class PaystackConfigError extends Error {
  constructor(message = "PAYSTACK_SECRET_KEY is not configured.") {
    super(message);
    this.name = "PaystackConfigError";
  }
}

/** A Paystack API call completed but reported failure, or the HTTP call
 * itself failed. `code` is a short, sanitized machine-readable marker
 * (never a raw Paystack error body) — the payment module's use-cases
 * translate this into the appropriate `payment_attempts.error_code`/
 * `AppError` subclass. `message` is sanitized: Paystack's own message
 * text (safe, customer-facing by Paystack's own design) or a local
 * NETWORK_ERROR/TIMEOUT marker — never a raw request/response body,
 * never anything resembling a secret or card data. */
export class PaystackApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PaystackApiError";
    this.code = code;
  }
}

function requireSecretKey(): string {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new PaystackConfigError();
  }
  return env.PAYSTACK_SECRET_KEY;
}

async function paystackFetch(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ status: boolean; message: string; data: unknown }> {
  const secretKey = requireSecretKey();

  let response: Response;
  try {
    response = await fetch(`${PAYSTACK_API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new PaystackApiError(
      "NETWORK_ERROR",
      "Could not reach Paystack — the request failed before receiving a response.",
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new PaystackApiError(
      "MALFORMED_RESPONSE",
      "Paystack returned a response that could not be parsed as JSON.",
    );
  }

  if (
    typeof json !== "object" ||
    json === null ||
    !("status" in json) ||
    !("message" in json)
  ) {
    throw new PaystackApiError(
      "MALFORMED_RESPONSE",
      "Paystack returned an unexpected response shape.",
    );
  }

  const parsed = json as { status: boolean; message: string; data?: unknown };

  if (!response.ok || parsed.status !== true) {
    throw new PaystackApiError(
      response.status === 404 ? "NOT_FOUND" : "REQUEST_FAILED",
      typeof parsed.message === "string"
        ? parsed.message
        : "Paystack request failed.",
    );
  }

  return { status: parsed.status, message: parsed.message, data: parsed.data };
}

export async function initializeTransaction(
  params: InitializeTransactionParams,
): Promise<InitializeTransactionResult> {
  const { data } = await paystackFetch("/transaction/initialize", {
    method: "POST",
    body: {
      amount: params.amountMinor,
      email: params.email,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    },
  });

  const result = data as
    | { authorization_url?: string; access_code?: string; reference?: string }
    | undefined;
  if (!result?.authorization_url || !result.access_code || !result.reference) {
    throw new PaystackApiError(
      "MALFORMED_RESPONSE",
      "Paystack's Initialize Transaction response is missing expected fields.",
    );
  }

  return {
    authorizationUrl: result.authorization_url,
    accessCode: result.access_code,
    reference: result.reference,
  };
}

export async function verifyTransaction(
  reference: string,
): Promise<VerifyTransactionResult> {
  const { data } = await paystackFetch(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: "GET" },
  );

  const result = data as
    | {
        id?: number;
        status?: string;
        reference?: string;
        amount?: number;
        currency?: string;
        gateway_response?: string | null;
        channel?: string | null;
        paid_at?: string | null;
      }
    | undefined;

  if (
    result?.id === undefined ||
    typeof result.status !== "string" ||
    typeof result.reference !== "string" ||
    typeof result.amount !== "number" ||
    typeof result.currency !== "string"
  ) {
    throw new PaystackApiError(
      "MALFORMED_RESPONSE",
      "Paystack's Verify Transaction response is missing expected fields.",
    );
  }

  return {
    id: result.id,
    status: result.status,
    reference: result.reference,
    amountMinor: result.amount,
    currency: result.currency,
    gatewayResponse: result.gateway_response ?? null,
    channel: result.channel ?? null,
    paidAt: result.paid_at ?? null,
  };
}

export async function createRefund(
  params: CreateRefundParams,
): Promise<CreateRefundResult> {
  const { data } = await paystackFetch("/refund", {
    method: "POST",
    body: {
      transaction: params.transactionReference,
      amount: params.amountMinor,
      merchant_note: params.merchantNote,
    },
  });

  const result = data as
    { status?: string; transaction?: { reference?: string } } | undefined;

  return {
    status: typeof result?.status === "string" ? result.status : "pending",
    transactionReference: params.transactionReference,
  };
}

/** The default, real implementation of `PaystackClient` — every
 * production call path uses this; tests inject a fake object satisfying
 * the same interface instead (plan §28.4), never a mocked `fetch`
 * underneath this one. */
export const defaultPaystackClient: PaystackClient = {
  initializeTransaction,
  verifyTransaction,
  createRefund,
};
