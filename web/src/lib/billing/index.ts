import type Stripe from "stripe";
import { record } from "@/lib/audit";

/**
 * Usage metering.
 *
 * An assessment costs real money — one model call per claim plus retrieval — so
 * the unit of billing is the run, not the seat. Metering happens after the run
 * completes rather than when it is queued, because a customer should not be
 * charged for an assessment that failed.
 *
 * With no STRIPE_SECRET_KEY this records the meter event to the audit log and
 * returns, so the product works unbilled in development. The Stripe SDK is
 * imported dynamically and never bundled when the key is absent.
 */

const METER = process.env.STRIPE_METER_EVENT ?? "assessment_run";

let client: Stripe | null = null;

async function stripe(): Promise<Stripe | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (client) return client;
  const { default: StripeSdk } = await import("stripe");
  client = new StripeSdk(key, { apiVersion: "2026-08-26.dahlia" });
  return client;
}

export async function meterRun(applicationId: string): Promise<void> {
  const customer = process.env.STRIPE_CUSTOMER_ID;
  const sdk = await stripe();

  if (!sdk || !customer) {
    await record("run_completed", "billing", `Metered 1 assessment run (billing disabled)`, {
      detail: { applicationId, meter: METER, billed: false },
    });
    return;
  }

  await sdk.billing.meterEvents.create({
    event_name: METER,
    payload: { stripe_customer_id: customer, value: "1" },
    // Idempotent on the application: a retried job must not bill twice, and
    // queue retries are a normal part of operation rather than an exception.
    identifier: `assessment:${applicationId}`,
  });

  await record("run_completed", "billing", `Metered 1 assessment run to Stripe`, {
    detail: { applicationId, meter: METER, billed: true },
  });
}
