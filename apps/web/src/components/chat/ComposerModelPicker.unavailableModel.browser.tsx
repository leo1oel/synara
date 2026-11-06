// A Claude turn that failed with model_not_found puts the model on its account's
// status as `unavailableModels`. The picker must then grey that row with the
// reason, the composer must leave it for the default model, and both must undo
// once the entry clears (a successful turn or the next status refresh).
import "../../index.css";

import {
  type ModelSlug,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerProviderStatus,
  ThreadId,
} from "@synara/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { setLanguagePreference, t } from "../../i18n";
import { type ProviderModelOption } from "../../providerModelOptions";
import { ComposerModelPicker } from "./ComposerModelPicker";
import { useUnavailableModelFallback } from "./useUnavailableModelFallback";

const THREAD_ID = ThreadId.makeUnsafe("thread-unavailable-model");
const CLAUDE = "claudeAgent" as ProviderInstanceId;
const FABLE = "claude-fable-5-1" as ModelSlug;
// The provider's default model, where the composer goes.
const SONNET = "claude-sonnet-5" as ModelSlug;
const CLAUDE_MODELS: ReadonlyArray<ProviderModelOption> = [
  { slug: FABLE, name: "Claude Fable 5.1" },
  { slug: SONNET, name: "Claude Sonnet 5" },
];
const MODEL_OPTIONS_BY_PROVIDER = {
  claudeAgent: CLAUDE_MODELS,
  codex: [],
  cursor: [],
  devin: [],
  antigravity: [],
  grok: [],
  droid: [],
  omp: [],
  opencode: [],
  pi: [],
} satisfies Record<ProviderKind, ReadonlyArray<ProviderModelOption>>;

function claudeStatus(refused: ReadonlyArray<string> = []): ServerProviderStatus {
  return {
    provider: "claudeAgent",
    instanceId: CLAUDE,
    driver: "claudeAgent",
    status: "ready",
    available: true,
    authStatus: "authenticated",
    checkedAt: "2026-11-06T10:00:00.000Z",
    ...(refused.length > 0
      ? {
          unavailableModels: refused.map((model) => ({
            model,
            reason: "The selected Claude model is unavailable for this account.",
            recordedAt: "2026-11-06T10:00:02.000Z",
          })),
        }
      : {}),
  };
}

function Harness(props: {
  readonly providers: ReadonlyArray<ServerProviderStatus>;
  readonly onPick: (model: ModelSlug) => void;
}) {
  const [model, setModel] = useState<ModelSlug>(FABLE);
  // ChatView wires the same hook to its own model commit.
  useUnavailableModelFallback({
    enabled: true,
    provider: "claudeAgent",
    instanceId: CLAUDE,
    model,
    statuses: props.providers,
    options: CLAUDE_MODELS,
    select: (_provider, next) => setModel(next),
  });
  return (
    <>
      <output data-testid="composer-model">{model}</output>
      <ComposerModelPicker
        provider="claudeAgent"
        model={model}
        lockedProvider={null}
        boundProviderInstance={null}
        effortControl="menu"
        providers={props.providers}
        modelOptionsByProvider={MODEL_OPTIONS_BY_PROVIDER}
        onProviderModelChange={(_provider, next) => {
          props.onPick(next);
          setModel(next);
        }}
        threadId={THREAD_ID}
        modelOptions={undefined}
        prompt=""
        onPromptChange={() => undefined}
      />
    </>
  );
}

const openPicker = () =>
  page.getByRole("button", { name: t("chat:modelEffort_changeModelAndReasoning") }).click();
const fableRow = () => page.getByRole("menuitem", { name: /Fable 5\.1/u });

describe("a model the account refused", () => {
  afterEach(() => {
    setLanguagePreference("en");
    document.body.innerHTML = "";
  });

  it("greys the row with the reason, moves the composer to the default, and undoes on clear", async () => {
    setLanguagePreference("en");
    const onPick = vi.fn();
    const screen = await render(<Harness providers={[claudeStatus()]} onPick={onPick} />);
    try {
      await expect.element(page.getByTestId("composer-model")).toHaveTextContent(FABLE);

      // The failed turn's status update arrives.
      await screen.rerender(<Harness providers={[claudeStatus([FABLE])]} onPick={onPick} />);
      await expect.element(page.getByTestId("composer-model")).toHaveTextContent(SONNET);

      await openPicker();
      await expect.element(fableRow()).toHaveAttribute("aria-disabled", "true");
      await expect.element(fableRow()).toHaveTextContent("Not available to your account");
      await expect
        .element(page.getByRole("menuitem", { name: /Sonnet 5/u }))
        .toHaveAttribute("aria-current", "true");
      await fableRow().click({ force: true });
      expect(onPick).not.toHaveBeenCalled();

      // A successful turn with the model, or the next status refresh, clears it.
      await screen.rerender(<Harness providers={[claudeStatus()]} onPick={onPick} />);
      await expect.element(fableRow()).not.toHaveAttribute("aria-disabled", "true");
      expect(fableRow().element().textContent).not.toContain("Not available");
      // Clearing does not move the composer back on its own.
      await expect.element(page.getByTestId("composer-model")).toHaveTextContent(SONNET);
      await fableRow().click();
      expect(onPick).toHaveBeenCalledExactlyOnceWith(FABLE);
    } finally {
      await screen.unmount();
    }
  });

  it("says why in Chinese", async () => {
    setLanguagePreference("zh-CN");
    await page.viewport(240, 700);
    const screen = await render(<Harness providers={[claudeStatus([FABLE])]} onPick={vi.fn()} />);
    try {
      await openPicker();
      await expect.element(fableRow()).toHaveTextContent("你的账号用不了");
      await expect.element(fableRow()).toHaveAttribute("aria-disabled", "true");
      // In Lattice's narrow panel the reason must end before the row's star button.
      const row = fableRow().element();
      const reason = Array.from(row.querySelectorAll("span")).find(
        (span) => span.textContent === "你的账号用不了",
      );
      const star = row.parentElement?.querySelector("button");
      expect(reason).toBeDefined();
      expect(star).toBeDefined();
      const reasonEnd = Math.round(reason!.getBoundingClientRect().right);
      const starStart = Math.round(star!.getBoundingClientRect().left);
      expect({ reasonEnd, starStart, fits: reasonEnd <= starStart }).toMatchObject({ fits: true });
      expect(row.parentElement?.getAttribute("title")).toBe("你的账号用不了");
    } finally {
      await screen.unmount();
    }
  });
});
