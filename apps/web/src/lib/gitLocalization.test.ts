import { setupI18n } from "@lingui/core";
import { describe, expect, it } from "vitest";
import { messages as zhMessages } from "~/locales/zh-CN/messages.po";

import { localizeGitText } from "./gitLocalization";

describe("localizeGitText", () => {
  it("localizes static and branch-specific Git actions in Chinese", () => {
    const i18n = setupI18n();
    i18n.loadAndActivate({ locale: "zh-CN", messages: zhMessages });

    expect(localizeGitText(i18n, "Commit & push")).toBe("提交并推送");
    expect(localizeGitText(i18n, "Created PR")).toBe("已创建 PR");
    expect(localizeGitText(i18n, "Push to feature/i18n")).toBe("推送到 feature/i18n");
    expect(localizeGitText(i18n, "Pushed abc1234 to main")).toBe("已将 abc1234 推送到 main");
  });
});
