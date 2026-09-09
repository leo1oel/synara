import { ThreadId } from "@synara/contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";

import { useThreadUnblock } from "./useThreadUnblock";

const api = vi.hoisted(() => ({
  listProviderDeliveryBlockers: vi.fn(),
  reconcileProviderDelivery: vi.fn(),
  addToast: vi.fn(),
}));
vi.mock("../nativeApi", () => ({ readNativeApi: () => ({ orchestration: api }) }));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: api.addToast } }));

beforeEach(() => vi.resetAllMocks());

it("keeps the error banner when retrying a skipped message blocks the thread again", async () => {
  const threadId = ThreadId.makeUnsafe("unblock-replay-failure");
  const onUnblocked = vi.fn();
  const initial = { eventSequence: 17, state: "uncertain" };
  api.listProviderDeliveryBlockers
    .mockResolvedValueOnce([initial])
    .mockResolvedValueOnce([
      {
        eventSequence: 43,
        state: "uncertain",
        lastError: "Codex process exit could not be verified",
      },
    ]);
  api.reconcileProviderDelivery.mockResolvedValue({ state: "succeeded" });

  const hook = await renderHook(() => useThreadUnblock({ threadId, onUnblocked }));
  hook.result.current.unblockThread();
  await vi.waitFor(() => expect(api.addToast).toHaveBeenCalledOnce());
  expect(onUnblocked).not.toHaveBeenCalled();
  expect(api.addToast).toHaveBeenCalledWith({
    type: "error",
    title: "Could not unblock thread",
    description:
      "The provider is still blocking this thread. Codex process exit could not be verified",
  });
  await vi.waitFor(() => expect(hook.result.current.unblocking).toBe(false));

  api.listProviderDeliveryBlockers.mockResolvedValueOnce([initial]).mockResolvedValueOnce([]);
  hook.result.current.unblockThread();
  await vi.waitFor(() => expect(onUnblocked).toHaveBeenCalledWith(threadId));
  expect(api.addToast).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "success", title: "Delivery blockers cleared" }),
  );
  await hook.unmount();
});
