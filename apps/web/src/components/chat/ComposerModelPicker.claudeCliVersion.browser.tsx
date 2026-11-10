// Claude Code learns each new Claude model in a release (Fable 5.2 needs 2.1.321,
// Sonnet 5.5 2.1.284, Haiku 5.5 2.1.293),
// while the Claude tab lists Synara's static catalog whatever Claude Code is
// installed. On an older Claude Code the picker must grey that model's row with
// the version it needs, say so above the list, and leave every other row usable.
import "../../index.css";

import {
  type ModelSlug,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerProviderStatus,
  ThreadId,
} from "@synara/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { setLanguagePreference, t } from "../../i18n";
import { type ProviderModelOption } from "../../providerModelOptions";
import { ComposerModelPicker } from "./ComposerModelPicker";

const THREAD_ID = ThreadId.makeUnsafe("thread-claude-cli-version");
const CLAUDE = "claudeAgent" as ProviderInstanceId;
const FABLE_5_2 = "claude-fable-5-2" as ModelSlug;
const FABLE_5_1 = "claude-fable-5-1" as ModelSlug;
const SONNET = "claude-sonnet-5" as ModelSlug;
const SONNET_5_5 = "claude-sonnet-5-5" as ModelSlug;
const HAIKU_5_5 = "claude-haiku-5-5" as ModelSlug;
const CLAUDE_MODELS: ReadonlyArray<ProviderModelOption> = [
  { slug: FABLE_5_2, name: "Claude Fable 5.2" },
  { slug: FABLE_5_1, name: "Claude Fable 5.1" },
  { slug: SONNET_5_5, name: "Claude Sonnet 5.5" },
  { slug: SONNET, name: "Claude Sonnet 5" },
  { slug: HAIKU_5_5, name: "Claude Haiku 5.5" },
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

function claudeStatus(version: string | null): ServerProviderStatus {
  return {
    provider: "claudeAgent",
    instanceId: CLAUDE,
    driver: "claudeAgent",
    status: "ready",
    available: true,
    authStatus: "authenticated",
    checkedAt: "2026-11-09T10:00:00.000Z",
    version,
  };
}

function Picker(props: {
  readonly version: string | null;
  readonly onPick: (model: ModelSlug) => void;
}) {
  return (
    <ComposerModelPicker
      provider="claudeAgent"
      model={SONNET}
      lockedProvider={null}
      boundProviderInstance={null}
      effortControl="menu"
      providers={[claudeStatus(props.version)]}
      modelOptionsByProvider={MODEL_OPTIONS_BY_PROVIDER}
      onProviderModelChange={(_provider, next) => props.onPick(next)}
      threadId={THREAD_ID}
      modelOptions={undefined}
      prompt=""
      onPromptChange={() => undefined}
      warning={null}
    />
  );
}

const openPicker = () =>
  page.getByRole("button", { name: t("chat:modelEffort_changeModelAndReasoning") }).click();
const fable52Row = () => page.getByRole("menuitem", { name: /Fable 5\.2/u });
const fable51Row = () => page.getByRole("menuitem", { name: /Fable 5\.1/u });
const sonnet55Row = () => page.getByRole("menuitem", { name: /Sonnet 5\.5/u });
const haiku55Row = () => page.getByRole("menuitem", { name: /Haiku 5\.5/u });

describe("a Claude model the installed Claude Code is too old for", () => {
  afterEach(() => {
    setLanguagePreference("en");
    document.body.innerHTML = "";
  });

  it("greys Fable 5.2 with the version it needs and says to update, on Claude Code 2.1.319", async () => {
    setLanguagePreference("en");
    const onPick = vi.fn();
    const screen = await render(<Picker version="2.1.319" onPick={onPick} />);
    try {
      await openPicker();
      await expect
        .element(page.getByRole("status"))
        .toHaveTextContent("Update Claude Code to 2.1.321+ to use Fable 5.2");
      await expect.element(fable52Row()).toHaveAttribute("aria-disabled", "true");
      await expect.element(fable52Row()).toHaveTextContent("Needs Claude Code 2.1.321+");
      await fable52Row().click({ force: true });
      expect(onPick).not.toHaveBeenCalled();

      // Fable 5.1 runs on that Claude Code, so its row stays usable.
      await expect.element(fable51Row()).not.toHaveAttribute("aria-disabled", "true");
      await fable51Row().click();
      expect(onPick).toHaveBeenCalledWith(FABLE_5_1);
    } finally {
      await screen.unmount();
    }
  });

  it("offers Fable 5.2 with no note once Claude Code is 2.1.321, or when its version is unknown", async () => {
    setLanguagePreference("en");
    const onPick = vi.fn();
    const screen = await render(<Picker version="2.1.321" onPick={onPick} />);
    try {
      await openPicker();
      await expect.element(fable52Row()).not.toHaveAttribute("aria-disabled", "true");
      await expect.element(fable52Row()).not.toHaveTextContent("Needs Claude Code");
      expect(page.getByRole("status").elements()).toHaveLength(0);

      await screen.rerender(<Picker version={null} onPick={onPick} />);
      await expect.element(fable52Row()).not.toHaveAttribute("aria-disabled", "true");
      expect(page.getByRole("status").elements()).toHaveLength(0);

      await fable52Row().click();
      expect(onPick).toHaveBeenCalledWith(FABLE_5_2);
    } finally {
      await screen.unmount();
    }
  });

  it("greys Haiku 5.5 below 2.1.293 and Sonnet 5.5 below 2.1.284, each with its own version", async () => {
    setLanguagePreference("en");
    const onPick = vi.fn();
    const screen = await render(<Picker version="2.1.290" onPick={onPick} />);
    try {
      await openPicker();
      await expect.element(haiku55Row()).toHaveAttribute("aria-disabled", "true");
      await expect.element(haiku55Row()).toHaveTextContent("Needs Claude Code 2.1.293+");
      await expect.element(sonnet55Row()).not.toHaveAttribute("aria-disabled", "true");
      await sonnet55Row().click();
      expect(onPick).toHaveBeenCalledWith(SONNET_5_5);

      await screen.rerender(<Picker version="2.1.280" onPick={onPick} />);
      await openPicker();
      await expect.element(sonnet55Row()).toHaveAttribute("aria-disabled", "true");
      await expect.element(sonnet55Row()).toHaveTextContent("Needs Claude Code 2.1.284+");

      await screen.rerender(<Picker version="2.1.321" onPick={onPick} />);
      await expect.element(sonnet55Row()).not.toHaveAttribute("aria-disabled", "true");
      await expect.element(haiku55Row()).not.toHaveAttribute("aria-disabled", "true");
      await haiku55Row().click();
      expect(onPick).toHaveBeenCalledWith(HAIKU_5_5);
    } finally {
      await screen.unmount();
    }
  });

  it("says it in Chinese for a zh-CN interface", async () => {
    setLanguagePreference("zh-CN");
    const screen = await render(<Picker version="2.1.300" onPick={() => undefined} />);
    try {
      await openPicker();
      await expect
        .element(page.getByRole("status"))
        .toHaveTextContent("将 Claude Code 升级到 2.1.321+ 以使用 Fable 5.2");
      await expect.element(fable52Row()).toHaveTextContent("需要 Claude Code 2.1.321+");
    } finally {
      await screen.unmount();
    }
  });
});
