import { afterEach, describe, expect, it } from "vitest";

import { setLanguagePreference, t } from "~/i18n";
import { localizeProviderStatusMessage } from "./providerStatusMessages";

const TOO_OLD =
  "Claude Code 1.0.100 is too old for this app. Run `claude update` (or reinstall Claude Code), then try again.";

describe("localizeProviderStatusMessage", () => {
  afterEach(() => setLanguagePreference("en"));

  // The Claude tab of the model picker shows this in place of its models.
  it("says in plain words that an outdated Claude Code needs updating", () => {
    setLanguagePreference("zh-CN");
    expect(localizeProviderStatusMessage(t, TOO_OLD)).toBe(
      "你安装的 Claude Code 1.0.100 版本太旧，用不了。请在终端运行 `claude update`（或重装 Claude Code），然后重试。",
    );
    setLanguagePreference("en");
    expect(localizeProviderStatusMessage(t, TOO_OLD)).toBe(
      "Claude Code 1.0.100 is too old for this app. Run `claude update` in Terminal (or reinstall Claude Code), then try again.",
    );
  });
});
