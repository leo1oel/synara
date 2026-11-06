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
});
