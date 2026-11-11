import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { i18n } from ".";
import { formatDayAwareTimestamp } from "../timestampFormat";
import {
  PullRequestStateGlyph,
  IssueStateGlyph,
} from "../components/pullRequest/PullRequestStateGlyph";
import {
  resolvePrStatePresentation,
  resolveIssueStatePresentation,
} from "../components/pullRequest/pullRequestStatePresentation";

describe("locale-aware presentation", () => {
  it("names weekdays", () => {
    const now = new Date(2026, 2, 17, 12, 0);
    const monday = new Date(2026, 2, 16, 9, 5).toISOString();
    expect(formatDayAwareTimestamp(monday, "24-hour", now)).toMatch(/^Monday /);
  });

  it("keeps source PR and issue states stable for agent context", () => {
    expect(resolvePrStatePresentation({ state: "open", isDraft: true }).label).toBe("PR draft");
    expect(
      resolveIssueStatePresentation({ state: "closed", stateReason: "completed" }).shortLabel,
    ).toBe("Closed");
  });
});

it("keeps project names that match translation keys unchanged in settings groups", async () => {
  const { SettingsSection } = await import("../components/settings/SettingsPanelPrimitives");
  expect(
    renderToStaticMarkup(
      <SettingsSection title="workspace:toast_settings" translateTitle={false}>
        <span>data</span>
      </SettingsSection>,
    ),
  ).toContain(">workspace:toast_settings</h2>");
  expect(
    renderToStaticMarkup(
      <SettingsSection title="workspace:toast_settings">
        <span>data</span>
      </SettingsSection>,
    ),
  ).toContain(">Settings</h2>");
});

// Lattice's embedded panel reads in Chinese when Lattice does, with Lattice's own terms.
describe("Lattice's Chinese panel", () => {
  afterEach(() => void i18n.changeLanguage("en"));

  it("localizes PR and issue glyphs while source states stay stable for agent context", () => {
    void i18n.changeLanguage("zh-CN");
    expect(resolvePrStatePresentation({ state: "open", isDraft: true }).label).toBe("PR draft");
    expect(renderToStaticMarkup(<PullRequestStateGlyph state="open" isDraft={true} />)).toContain(
      'aria-label="PR 草稿"',
    );
    expect(
      renderToStaticMarkup(<IssueStateGlyph state="closed" stateReason="completed" />),
    ).toContain('aria-label="议题已关闭"');
  });
});
