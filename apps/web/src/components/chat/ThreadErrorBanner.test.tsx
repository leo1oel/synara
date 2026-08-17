// FILE: ThreadErrorBanner.test.tsx
// Purpose: Guards the thread error banner's provider-quarantine recovery action.
// Layer: Component rendering tests
// Depends on: the banner component and React server rendering.

import { formatProviderDeliveryBlockDetail } from "@synara/shared/providerDeliveryBlock";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { ThreadErrorBanner } from "./ThreadErrorBanner";

const blockedError = formatProviderDeliveryBlockDetail(
  "External provider command claim expired without a durable acceptance result; execution was not replayed.",
);

function installEmbeddedSessionStorage(config: Record<string, unknown>) {
  const values = new Map<string, string>([["synara.poc.embed-mode", JSON.stringify(config)]]);
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
}

afterEach(() => {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

describe("ThreadErrorBanner", () => {
  it("offers the unblock action for a provider-delivery quarantine", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner error={blockedError} onDismiss={() => {}} onUnblock={() => {}} />,
    );

    expect(markup).toContain("Unblock thread");
    expect(markup).toContain("Dismiss error");
  });

  it("disables the action while unblocking", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner error={blockedError} onUnblock={() => {}} unblocking />,
    );

    expect(markup).toContain("Unblocking");
    expect(markup).toContain("disabled");
  });

  it("hides the action for unrelated thread errors", () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner
        error="The provider rejected the prompt."
        onDismiss={() => {}}
        onUnblock={() => {}}
      />,
    );

    expect(markup).toContain("The provider rejected the prompt.");
    expect(markup).not.toContain("Unblock thread");
  });

  it("renders nothing without an error", () => {
    expect(renderToStaticMarkup(<ThreadErrorBanner error={null} onUnblock={() => {}} />)).toBe("");
  });

  it("hands the error to the host notification stack instead of the inline banner when embedded", () => {
    installEmbeddedSessionStorage({
      workspaceRoot: "/Users/me/paper",
      hostOrigin: "http://localhost:1420",
    });

    expect(
      renderToStaticMarkup(
        <ThreadErrorBanner error="The provider rejected the prompt." onDismiss={() => {}} />,
      ),
    ).toBe("");
  });

  it("keeps the inline banner when embedded without a host origin to bridge to", () => {
    installEmbeddedSessionStorage({ workspaceRoot: "/Users/me/paper" });

    expect(
      renderToStaticMarkup(
        <ThreadErrorBanner error="The provider rejected the prompt." onDismiss={() => {}} />,
      ),
    ).toContain("The provider rejected the prompt.");
  });
});
