import Stripe from "stripe";

/**
 * A refusal Stripe will give again (a 4xx other than a conflict or rate limit), as opposed to an
 * outcome we do not know (network, 5xx, idempotency conflict). A definitive refusal can be recorded
 * as failed; an unknown one must never be treated as "nothing happened".
 */
export function isDefinitiveStripeError(e: unknown): boolean {
  if (!(e instanceof Stripe.errors.StripeError)) return false;
  if (e.type === "StripeIdempotencyError") return false;
  const code = e.statusCode ?? 0;
  return code >= 400 && code < 500 && code !== 409 && code !== 429;
}
