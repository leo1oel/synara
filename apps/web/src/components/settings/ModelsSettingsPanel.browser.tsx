import "../../index.css";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AppSettingsSchema } from "../../appSettings";
import { i18n } from "../../i18n";
import { ModelsSettingsPanel } from "./ModelsSettingsPanel";

vi.mock("../../hooks/useProviderModelCatalog", () => ({
  useProviderModelCatalog: () => ({
    modelOptionsByProvider: {
      codex: [{ slug: "discovered-model", name: "Discovered model" }],
      claudeAgent: [],
      cursor: [],
      devin: [],
      antigravity: [],
      grok: [],
      droid: [],
      opencode: [],
      pi: [],
    },
  }),
}));

it("selects discovered, custom and transient repair models independently and resets the row", async () => {
  await page.viewport(900, 800);
  i18n.loadAndActivate({ locale: "en", messages: {} });
  const defaults = AppSettingsSchema.makeUnsafe({});
  const settings = {
    ...defaults,
    compileRepairProvider: "codex" as const,
    compileRepairModel: "transient-model",
    customCodexModels: ["custom-model"],
  };
  const updateSettings = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  const host = document.createElement("div");
  host.className = "app-settings-surface p-6";
  document.body.append(host);
  const mounted = await render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ModelsSettingsPanel
          active
          resetEpoch={0}
          settings={settings}
          defaults={defaults}
          updateSettings={updateSettings}
        />
      </QueryClientProvider>
    </I18nProvider>,
    { container: host },
  );
  try {
    expect(host.textContent).toContain("Compile repair model");
    const picker = page.getByRole("combobox", { name: "Compile repair model", exact: true });
    expect(picker.element()).toBeDefined();
    await picker.click();
    await expect.element(page.getByRole("option", { name: /Transient Model/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Custom Model/ })).toBeInTheDocument();
    await page.getByRole("option", { name: /Discovered model/ }).click();
    expect(updateSettings).toHaveBeenLastCalledWith({
      compileRepairProvider: "codex",
      compileRepairModel: "discovered-model",
    });
    await page.getByRole("button", { name: "Reset compile repair model to default" }).click();
    expect(updateSettings).toHaveBeenLastCalledWith({
      compileRepairProvider: defaults.compileRepairProvider,
      compileRepairModel: defaults.compileRepairModel,
    });
    await page.screenshot();
  } finally {
    await mounted.unmount();
    client.clear();
    host.remove();
  }
});
