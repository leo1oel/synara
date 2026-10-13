import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SETTINGS_SECTION_READY_TIMEOUT_MS,
  watchEmbeddedSettingsSectionReady,
} from "./embeddedSettingsSectionReady";

function frames() {
  let queued: FrameRequestCallback[] = [];
  return {
    requestFrame: (callback: FrameRequestCallback) => queued.push(callback),
    cancelFrame: vi.fn(),
    run() {
      const current = queued;
      queued = [];
      for (const callback of current) callback(0);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A query a mounted panel renders: observed, and fetched as it subscribes. */
function render<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  options: { retry?: number; retryDelay?: number } = {},
) {
  const observer = new QueryObserver(queryClient, { queryKey, queryFn, ...options });
  return observer.subscribe(() => {});
}

describe("watchEmbeddedSettingsSectionReady", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is ready two frames after a section with nothing to load commits", () => {
    const queryClient = new QueryClient();
    const frame = frames();
    const onReady = vi.fn();
    watchEmbeddedSettingsSectionReady({ queryClient, onReady, ...frame });

    frame.run();
    expect(onReady).not.toHaveBeenCalled();
    frame.run();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("waits for a rendered first load, not for a refetch of data already shown", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["shown"], ["cached"]);
    render(queryClient, ["shown"], () => new Promise<string[]>(() => {}));
    const projects = deferred<string[]>();
    render(queryClient, ["projects"], () => projects.promise);
    const frame = frames();
    const onReady = vi.fn();
    watchEmbeddedSettingsSectionReady({ queryClient, onReady, ...frame });

    frame.run();
    frame.run();
    expect(onReady).not.toHaveBeenCalled();

    projects.resolve(["Home"]);
    await vi.waitFor(() => expect(queryClient.getQueryData(["projects"])).toEqual(["Home"]));
    frame.run();
    frame.run();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("does not wait for a query nothing renders, or one already retrying a failure", async () => {
    const queryClient = new QueryClient();
    void queryClient.prefetchQuery({
      queryKey: ["prefetch"],
      queryFn: () => new Promise(() => {}),
    });
    const discovery = deferred<string[]>();
    render(queryClient, ["provider-discovery"], () => discovery.promise, {
      retry: 3,
      retryDelay: 60_000,
    });
    const frame = frames();
    const onReady = vi.fn();
    watchEmbeddedSettingsSectionReady({ queryClient, onReady, ...frame });
    frame.run();
    frame.run();
    expect(onReady).not.toHaveBeenCalled();

    discovery.reject(new Error("provider is not installed"));
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(["provider-discovery"])?.fetchFailureCount).toBe(1),
    );
    expect(queryClient.getQueryState(["provider-discovery"])?.fetchStatus).toBe("fetching");
    frame.run();
    frame.run();
    expect(onReady).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  it("goes back to waiting when a query starts before the data has painted", async () => {
    const queryClient = new QueryClient();
    const frame = frames();
    const onReady = vi.fn();
    watchEmbeddedSettingsSectionReady({ queryClient, onReady, ...frame });

    frame.run();
    const details = deferred<string>();
    render(queryClient, ["details"], () => details.promise);
    frame.run();
    frame.run();
    expect(onReady).not.toHaveBeenCalled();

    details.resolve("loaded");
    await vi.waitFor(() => expect(queryClient.getQueryData(["details"])).toBe("loaded"));
    frame.run();
    frame.run();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("gives up on a slow query after the timeout, and never answers twice", () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    render(queryClient, ["slow"], () => new Promise<never>(() => {}));
    const frame = frames();
    const onReady = vi.fn();
    watchEmbeddedSettingsSectionReady({ queryClient, onReady, ...frame });

    vi.advanceTimersByTime(SETTINGS_SECTION_READY_TIMEOUT_MS - 1);
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SETTINGS_SECTION_READY_TIMEOUT_MS);
    frame.run();
    frame.run();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("stays silent once cancelled", () => {
    const queryClient = new QueryClient();
    const frame = frames();
    const onReady = vi.fn();
    const cancel = watchEmbeddedSettingsSectionReady({ queryClient, onReady, ...frame });

    cancel();
    frame.run();
    frame.run();
    expect(onReady).not.toHaveBeenCalled();
  });
});
