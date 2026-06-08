import { getServiceSupabase } from "./db";

/**
 * Has this GitHub webhook delivery already been successfully processed?
 *
 * The webhook route uses this BEFORE running the handler. We only write to
 * webhook_deliveries AFTER a handler succeeds (or after a non-retryable
 * validation rejection) — so a transient handler failure leaves no row, and
 * GitHub's automatic retry of the same delivery id will pass the check and run
 * the handler again instead of being short-circuited as a duplicate.
 */
export async function hasDelivery(id: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("webhook_deliveries")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`hasDelivery failed: ${error.message}`);
  return data !== null;
}

/**
 * Mark a delivery as processed. Idempotent — concurrent invocations for the
 * same id resolve via the table's primary key (`on conflict do nothing` in
 * the RPC). Returns true if newly recorded, false if it already existed (e.g.
 * a concurrent peer beat us to it).
 */
export async function recordDelivery(id: string, event: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc("record_webhook_delivery", {
    p_id: id,
    p_event: event,
  });
  if (error) throw new Error(`recordDelivery failed: ${error.message}`);
  return data === true;
}
