// FILE: embeddedSettingsSectionReady.ts
// Purpose: Decide when an embedded Settings section can be shown: its panel has committed and
//          no query is still loading its first result (an empty "No projects" row before the
//          projects arrive, a Skills page before its library), then two frames for that data to
//          paint. Lattice keeps the frame hidden until then.
// Layer: Pure watcher over the React Query cache, so it is testable without a DOM.

import type { QueryClient } from "@tanstack/react-query";

/** After this a slow query shows its own loading row rather than a blank host placeholder. */
export const SETTINGS_SECTION_READY_TIMEOUT_MS = 1_200;

type ReadyClient = Pick<QueryClient, "getQueryCache" | "isFetching">;

// Only a first load the page renders changes what it shows. A refetch of data already on screen,
// a prefetch nothing renders yet, and a query already failing (a provider that is not installed
// retries for seconds before it settles on its error) are not worth a blank sheet.
const loadingFirstResult = (client: ReadyClient) =>
  client.isFetching({
    predicate: (query) =>
      query.state.data === undefined &&
      query.state.fetchFailureCount === 0 &&
      query.getObserversCount() > 0,
  }) > 0;

/**
 * Calls `onReady` once, when the section has settled or the timeout passes. Run it from an effect
 * of the route that renders the section: child effects run first, so the panel's queries have
 * already started fetching when it first checks. Returns the cancel function.
 */
export function watchEmbeddedSettingsSectionReady(options: {
  queryClient: ReadyClient;
  onReady: () => void;
  timeoutMs?: number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}): () => void {
  const requestFrame =
    options.requestFrame ?? ((callback) => window.requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
  let frame: number | null = null;
  let done = false;

  const stopWaitingForPaint = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };
  const finish = () => {
    if (done) return;
    cancel();
    options.onReady();
  };
  const check = () => {
    if (done) return;
    if (loadingFirstResult(options.queryClient)) {
      stopWaitingForPaint();
      return;
    }
    if (frame !== null) return;
    // Data that has just arrived is rendered by React after this check; the second frame is the
    // first one that can carry it. A query started meanwhile (a row that loads its own details)
    // sends the wait back to the cache.
    frame = requestFrame(() => {
      frame = requestFrame(() => {
        frame = null;
        if (loadingFirstResult(options.queryClient)) return;
        finish();
      });
    });
  };

  const unsubscribe = options.queryClient.getQueryCache().subscribe(check);
  const timer = setTimeout(finish, options.timeoutMs ?? SETTINGS_SECTION_READY_TIMEOUT_MS);
  function cancel() {
    done = true;
    unsubscribe();
    clearTimeout(timer);
    stopWaitingForPaint();
  }
  check();
  return cancel;
}
