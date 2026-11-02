import { t, setLanguagePreference } from "~/i18n";

import { afterEach, describe, expect, it } from "vitest";

import { localizeGitText } from "./gitLocalization";

afterEach(() => setLanguagePreference("en"));

describe("localizeGitText", () => {
  it("localizes static and branch-specific Git actions in Chinese", () => {
    setLanguagePreference("zh-CN");

    expect(localizeGitText(t, "Commit & push")).toBe("提交并推送");
    expect(localizeGitText(t, "Created PR")).toBe("已创建 PR");
    expect(localizeGitText(t, "Push to feature/i18n")).toBe("推送到 feature/i18n");
    expect(localizeGitText(t, "Pushed abc1234 to main")).toBe("已将 abc1234 推送到 main");
  });
});
