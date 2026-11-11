/**
 * providerModelAvailability - Models an account refused at run time.
 *
 * The model picker lists Claude's static catalog merged with discovery, so a
 * model the signed-in account cannot use stays selectable until a turn with it
 * fails with `model_not_found` (or Claude Code exits saying "There's an issue with
 * the selected model"). The provider adapter records that failure here;
 * ProviderHealth projects the entries onto the instance's status as
 * `unavailableModels`, so the picker greys the row and the composer leaves it.
 *
 * Nothing here probes: entries come only from turn results, so availability
 * costs no CLI process or keychain read. An entry clears only when a turn with
 * that model succeeds, when the user rechecks providers themselves (the sign-in
 * window's status check and its close send an explicit refresh), when a status
 * refresh finds the instance's account changed, or when the server restarts.
 * Automatic refreshes (startup, window focus, hourly) keep it: they would make
 * the model selectable again within seconds, only to fail the same way.
 *
 * State is per server process, like provider runtime installs; it is not
 * persisted, so a restart forgets every entry.
 */
import type { ServerProviderUnavailableModel } from "@synara/contracts";

const entriesByInstance = new Map<string, Map<string, ServerProviderUnavailableModel>>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Records that `instanceId` refused `model`. Replaces an older entry for it. */
export function recordUnavailableModel(input: {
  readonly instanceId: string;
  readonly model: string;
  readonly reason: string;
  readonly recordedAt?: string;
}): void {
  const model = input.model.trim();
  const reason = input.reason.trim();
  if (model.length === 0 || reason.length === 0) return;
  let entries = entriesByInstance.get(input.instanceId);
  if (!entries) {
    entries = new Map();
    entriesByInstance.set(input.instanceId, entries);
  }
  entries.set(model, {
    model,
    reason,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  });
  notify();
}

/** Clears one model (a turn with it just succeeded). Returns whether it was listed. */
export function clearUnavailableModel(input: {
  readonly instanceId: string;
  readonly model: string;
}): boolean {
  const entries = entriesByInstance.get(input.instanceId);
  if (!entries?.delete(input.model.trim())) return false;
  if (entries.size === 0) entriesByInstance.delete(input.instanceId);
  notify();
  return true;
}

/**
 * Clears entries recorded before `before` (epoch ms), for one instance or, without
 * `instanceId`, for all: the account changed, or the user rechecked providers.
 * An entry recorded after that point stays, because the recheck cannot have seen it.
 */
export function clearUnavailableModelsRecordedBefore(input: {
  readonly instanceId?: string;
  readonly before: number;
}): boolean {
  const instanceIds =
    input.instanceId === undefined ? Array.from(entriesByInstance.keys()) : [input.instanceId];
  let changed = false;
  for (const instanceId of instanceIds) {
    const entries = entriesByInstance.get(instanceId);
    if (!entries) continue;
    for (const [model, entry] of entries) {
      if (Date.parse(entry.recordedAt) <= input.before) {
        entries.delete(model);
        changed = true;
      }
    }
    if (entries.size === 0) entriesByInstance.delete(instanceId);
  }
  if (changed) notify();
  return changed;
}

/** The instance's refused models, oldest first; empty when none. */
export function unavailableModelsFor(
  instanceId: string,
): ReadonlyArray<ServerProviderUnavailableModel> {
  const entries = entriesByInstance.get(instanceId);
  return entries ? Array.from(entries.values()) : [];
}

/** Notified after every change, so status consumers can republish. */
export function subscribeUnavailableModelChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: forget every entry. Listeners stay subscribed. */
export function resetUnavailableModelsForTest(): void {
  entriesByInstance.clear();
}
