/**
 * One-time ops script: ensure the Stripe webhook endpoint for this app is
 * subscribed to the events the new handlers depend on (M2/M9):
 *   - setup_intent.succeeded   (green an ACSS/PAD guarantee once verified)
 *   - charge.dispute.created   (flag a chargeback, block the receipt)
 *   - charge.refund.updated    (revert a failed/canceled refund)
 *
 * Operates in the mode of STRIPE_SECRET_KEY (live vs test). Idempotent:
 * merges the events into the endpoint's existing list (never removes any) and
 * is a no-op if they're already present (or the endpoint listens to "*").
 *
 * Usage: STRIPE_SECRET_KEY=... npx tsx scripts/add-stripe-webhook-events.ts
 */
import Stripe from "stripe";

const NEEDED = [
  "setup_intent.succeeded",
  "charge.dispute.created",
  "charge.refund.updated",
];

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is required");
  const mode = key.startsWith("sk_live_") ? "LIVE" : "TEST/other";
  const stripe = new Stripe(key, { apiVersion: "2025-10-29.clover" });

  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const targets = endpoints.data.filter((e) =>
    e.url.includes("/api/payments/webhook"),
  );

  console.log(`Stripe mode: ${mode}; ${endpoints.data.length} endpoint(s) total.`);
  if (targets.length === 0) {
    console.log(
      "No endpoint URL contains /api/payments/webhook. Endpoints found:",
    );
    endpoints.data.forEach((e) =>
      console.log(
        ` - ${e.id} ${e.url} [${e.status}] (${
          Array.isArray(e.enabled_events) ? e.enabled_events.length : e.enabled_events
        } events)`,
      ),
    );
    console.log("No change made — point this at the right endpoint manually.");
    return;
  }

  for (const ep of targets) {
    const current = ep.enabled_events ?? [];
    if (current.includes("*")) {
      console.log(`${ep.id} (${ep.url}) listens to ALL events — no change.`);
      continue;
    }
    const added = NEEDED.filter((e) => !current.includes(e));
    if (added.length === 0) {
      console.log(`${ep.id} (${ep.url}) already has the 3 events — no change.`);
      continue;
    }
    const merged = Array.from(new Set([...current, ...NEEDED]));
    await stripe.webhookEndpoints.update(ep.id, {
      enabled_events:
        merged as unknown as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
    });
    console.log(
      `${ep.id} (${ep.url}) — ADDED [${added.join(", ")}]; now ${merged.length} events.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
