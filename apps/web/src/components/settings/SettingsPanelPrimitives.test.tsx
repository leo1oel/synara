import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsListRow, SettingsRow } from "./SettingsPanelPrimitives";

describe("SettingsPanelPrimitives trailing regions", () => {
  it("marks form controls and list actions as distinct layout regions", () => {
    const controlMarkup = renderToStaticMarkup(
      <SettingsRow
        title="Provider"
        description="Choose a provider."
        control={<button>Choose</button>}
      />,
    );
    const actionsMarkup = renderToStaticMarkup(
      <SettingsListRow title="Droid" actions={<button>Update</button>} />,
    );

    expect(controlMarkup).toContain('data-slot="settings-control"');
    expect(actionsMarkup).toContain('data-slot="settings-actions"');
    expect(actionsMarkup).not.toContain('data-slot="settings-control"');
  });

  it("right-aligns trailing content at every responsive width", () => {
    const markup = renderToStaticMarkup(
      <SettingsRow
        title="Humanize Writing"
        description="Write in your own voice."
        control={<div>Switch and disclosure</div>}
      />,
    );

    expect(markup).toContain("items-center justify-end");
    expect(markup).not.toContain("sm:justify-end");
  });

  it("omits the description line when no description is available", () => {
    const markup = renderToStaticMarkup(<SettingsRow title="No description" />);

    expect(markup).not.toContain("<p");
  });

  it("allows inset-list consumers to add symmetric row padding", () => {
    const markup = renderToStaticMarkup(
      <SettingsListRow title="Droid" actions={<button>Update</button>} className="px-3" />,
    );

    expect(markup).toContain("px-3");
  });
});
