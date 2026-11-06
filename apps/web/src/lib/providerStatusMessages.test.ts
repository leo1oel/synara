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
});
