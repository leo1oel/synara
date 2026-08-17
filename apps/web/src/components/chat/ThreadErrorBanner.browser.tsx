import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const toast = vi.hoisted(() => ({
  add: vi.fn(() => "thread-error-toast"),
  update: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../ui/toast", () => ({ toastManager: toast }));

import { formatProviderDeliveryBlockDetail } from "@synara/shared/providerDeliveryBlock";

import { ThreadErrorBanner } from "./ThreadErrorBanner";

const blockedError = formatProviderDeliveryBlockDetail(
  "External provider command claim expired without a durable acceptance result; execution was not replayed.",
);

function installEmbeddedSession(): void {
  sessionStorage.setItem(
    "synara.poc.embed-mode",
    JSON.stringify({
      workspaceRoot: "/Users/me/paper",
      hostOrigin: "http://localhost:1420",
    }),
  );
}

afterEach(() => {
  toast.add.mockClear();
  toast.update.mockClear();
  toast.close.mockClear();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

describe("ThreadErrorBanner embedded toast", () => {
  it("adds, updates, delegates actions, and closes one persistent host toast", async () => {
    installEmbeddedSession();
    const onDismiss = vi.fn();
    const onUnblock = vi.fn();
    const mounted = await render(
      <ThreadErrorBanner error="The provider rejected the prompt." onDismiss={onDismiss} />,
    );

    await vi.waitFor(() => expect(toast.add).toHaveBeenCalledOnce());
    expect(toast.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "The provider rejected the prompt.",
        timeout: 0,
        data: expect.objectContaining({
          copyText: "The provider rejected the prompt.",
          onClose: onDismiss,
        }),
      }),
    );

    await mounted.rerender(
      <ThreadErrorBanner
        error={blockedError}
        onDismiss={onDismiss}
        onUnblock={onUnblock}
        unblocking
      />,
    );
    await vi.waitFor(() => expect(toast.update).toHaveBeenCalledOnce());
    expect(toast.update).toHaveBeenCalledWith(
      "thread-error-toast",
      expect.objectContaining({
        title: blockedError,
        actionProps: expect.objectContaining({
          children: "Unblocking…",
          disabled: true,
          onClick: onUnblock,
        }),
      }),
    );

    const updatedPayload = toast.update.mock.calls[0]?.[1];
    updatedPayload.data.onClose();
    updatedPayload.actionProps.onClick();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onUnblock).toHaveBeenCalledOnce();

    await mounted.rerender(<ThreadErrorBanner error={null} />);
    await vi.waitFor(() =>
      expect(toast.close).toHaveBeenCalledExactlyOnceWith("thread-error-toast"),
    );
    await mounted.unmount();
  });
});
