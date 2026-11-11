import { afterEach, describe, expect, it } from "vitest";

import { setLanguagePreference, t } from "~/i18n";
import { localizeProviderStatusMessage } from "./providerStatusMessages";

const TOO_OLD = "Claude Code 1.0.100 is too old. Run `claude update` in Terminal.";

describe("localizeProviderStatusMessage", () => {
  afterEach(() => setLanguagePreference("en"));

  // The Claude tab of the model picker shows this in place of its models.
  it("says in plain words that an outdated Claude Code needs updating", () => {
    setLanguagePreference("zh-CN");
    expect(localizeProviderStatusMessage(t, TOO_OLD)).toBe(
      "Claude Code 1.0.100 太旧，请在终端运行 `claude update`。",
    );
    setLanguagePreference("en");
    expect(localizeProviderStatusMessage(t, TOO_OLD)).toBe(
      "Claude Code 1.0.100 is too old. Run `claude update` in Terminal.",
    );
  });

  it("says Anthropic refused the account or network, not that it is signed out", () => {
    const refused = "Anthropic refused this Claude account or network (403 Request not allowed).";
    setLanguagePreference("zh-CN");
    expect(localizeProviderStatusMessage(t, refused)).toBe(
      "Anthropic 拒绝了这个 Claude 账号或所在网络（403），请检查账号状态。",
    );
    setLanguagePreference("en");
    expect(localizeProviderStatusMessage(t, refused)).toBe(
      "Anthropic refused this Claude account or network (403). Check the account's status.",
    );
  });

  // Lattice's Pi health message points at its own Model endpoint pane, not a Pi CLI.
  it("localizes the Lattice Pi set-up hint", () => {
    const notSetUp =
      "Pi is not set up. Connect a model endpoint in Settings → Agent → Model endpoint to use the Pi provider.";
    setLanguagePreference("zh-CN");
    expect(localizeProviderStatusMessage(t, notSetUp)).toBe(
      "Pi 还没有配置好。请在“设置 → AI 助手 → 模型端点”中连接模型端点，然后再使用 Pi。",
    );
    setLanguagePreference("en");
    expect(localizeProviderStatusMessage(t, notSetUp)).toBe(notSetUp);
  });
});
