import type { ImpressionEvent, TelemetryBatch } from "@meantime/shared";
import { TELEMETRY } from "@meantime/shared";
import { STORAGE_KEYS, storageGet, storageSet, uuidv4 } from "./storage";

/** Hard cap on unsent events. Oldest are dropped first. */
export const MAX_QUEUED_EVENTS = 200;

export interface QueuedImpression extends ImpressionEvent {
  queuedAt: number;
}

/**
 * Queue mutations are serialized inside the worker. `chrome.storage` has no
 * compare-and-swap, so concurrent enqueue/flush could otherwise lose events.
 */
let queueChain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueChain.then(fn, fn);
  queueChain = run.catch(() => undefined);
  return run;
}

export function queueImpression(event: ImpressionEvent): Promise<number> {
  return serial(async () => {
    const queue = await storageGet<QueuedImpression[]>(STORAGE_KEYS.PENDING_TELEMETRY, []);
    queue.push({ ...event, queuedAt: Date.now() });
    const bounded = queue.slice(-MAX_QUEUED_EVENTS);
    await storageSet(STORAGE_KEYS.PENDING_TELEMETRY, bounded);
    return bounded.length;
  });
}

export async function pendingCount(): Promise<number> {
  return (await storageGet<QueuedImpression[]>(STORAGE_KEYS.PENDING_TELEMETRY, [])).length;
}

/**
 * Read the oldest `max` events without removing them. They are only removed by
 * `ackBatch` after the server accepted the batch, so an interrupted flush
 * resumes rather than losing the tail.
 */
export function peekBatch(max: number): Promise<QueuedImpression[]> {
  return serial(async () => {
    const queue = await storageGet<QueuedImpression[]>(STORAGE_KEYS.PENDING_TELEMETRY, []);
    return queue.slice(0, Math.min(max, MAX_QUEUED_EVENTS));
  });
}

/** Remove exactly the acknowledged events, preserving anything enqueued meanwhile. */
export function ackBatch(impressionIds: string[]): Promise<void> {
  return serial(async () => {
    const sent = new Set(impressionIds);
    const queue = await storageGet<QueuedImpression[]>(STORAGE_KEYS.PENDING_TELEMETRY, []);
    await storageSet(
      STORAGE_KEYS.PENDING_TELEMETRY,
      queue.filter((event) => !sent.has(event.impressionId)),
    );
  });
}

/** @deprecated Retained for callers that need a full drain; prefer peek/ack. */
export async function drainQueue(): Promise<QueuedImpression[]> {
  return serial(async () => {
    const queue = await storageGet<QueuedImpression[]>(STORAGE_KEYS.PENDING_TELEMETRY, []);
    await storageSet(STORAGE_KEYS.PENDING_TELEMETRY, []);
    return queue;
  });
}

/** Re-enqueue on flush failure (network offline), bounded to avoid unbounded growth. */
export async function restoreQueue(events: QueuedImpression[]): Promise<void> {
  return serial(async () => {
    const queue = await storageGet<QueuedImpression[]>(STORAGE_KEYS.PENDING_TELEMETRY, []);
    const merged = [...events, ...queue].slice(-MAX_QUEUED_EVENTS);
    await storageSet(STORAGE_KEYS.PENDING_TELEMETRY, merged);
  });
}

export function buildBatch(
  events: QueuedImpression[],
  deviceId: string,
  extensionVersion: string,
): TelemetryBatch {
  return {
    batchId: uuidv4(),
    deviceId,
    extensionVersion,
    sentAt: Date.now(),
    events: events
      .slice(0, TELEMETRY.MAX_EVENTS_PER_BATCH)
      .map(({ queuedAt: _queuedAt, ...event }) => event),
  };
}
