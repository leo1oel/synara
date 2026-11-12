// Only the user's own recheck (the sign-in window's check and close) may ask the
// server to forget the models an account refused; every other refresh stays plain.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  type RefreshProviderStatusesNow,
  useRefreshProviderStatusesNow,
} from "./useProviderStatusRefresh";

const { refreshProviders } = vi.hoisted(() => ({
  refreshProviders: vi.fn(async (_input?: { explicit?: boolean }) => ({ providers: [] })),
}));
vi.mock("../nativeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../nativeApi")>()),
  readNativeApi: () => ({ server: { refreshProviders } }),
}));
// Folding the result into the cached server config is not under test here.
vi.mock("../lib/serverReactQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/serverReactQuery")>()),
  reconcileServerProviderStatuses: async () => undefined,
}));

function Probe(props: { readonly onReady: (refresh: RefreshProviderStatusesNow) => void }) {
  props.onReady(useRefreshProviderStatusesNow());
  return null;
}

describe("useRefreshProviderStatusesNow", () => {
  afterEach(() => refreshProviders.mockClear());

  it("marks only an explicit recheck as explicit", async () => {
    let refresh!: RefreshProviderStatusesNow;
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe onReady={(next) => (refresh = next)} />
      </QueryClientProvider>,
    );
    try {
      await refresh({ silent: true });
      expect(refreshProviders).toHaveBeenLastCalledWith();
      await refresh({ silent: true, explicit: true });
      expect(refreshProviders).toHaveBeenLastCalledWith({ explicit: true });
    } finally {
      await screen.unmount();
    }
  });
});
