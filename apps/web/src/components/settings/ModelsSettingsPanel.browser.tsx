import "../../index.css";

import { useState } from "react";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: { cwd: "/tmp" } }),
}));
// The panel reads the instance-keyed catalog for Git writing and proofreading,
// and the provider-keyed catalog for Lattice's compile repair model.
vi.mock("~/hooks/useProviderModelCatalog", () => ({
  useProviderModelCatalog: () => ({
    modelOptionsByProviderInstance: {
      codex: [
        { slug: "gpt-5.4", name: "GPT-5.4" },
        { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
      ],
    },
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
      omp: [],
    },
  }),
}));

import { AppSettingsSchema, type AppSettings } from "~/appSettings";
import { i18n } from "~/i18n";
import { ModelsSettingsPanel } from "./ModelsSettingsPanel";

const defaults = AppSettingsSchema.makeUnsafe({});

function Harness() {
  const [settings, setSettings] = useState(defaults);
  return (
    <I18nProvider i18n={i18n}>
      <div className="p-4">
        <ModelsSettingsPanel
          settings={settings}
          defaults={defaults}
          updateSettings={(patch: Partial<AppSettings>) =>
            setSettings((current) => ({ ...current, ...patch }))
          }
          resetEpoch={0}
          active
        />
      </div>
    </I18nProvider>
  );
}

afterEach(cleanup);

it("switches descriptions, saves custom text, preserves it across styles, and resets the row", async () => {
  await page.viewport(1280, 800);
  i18n.loadAndActivate({ locale: "en", messages: {} });
  await render(<Harness />);
  const picker = page.getByRole("combobox", { name: "Source control writing style" });
  expect(document.body.textContent).toContain(
    "In each project, matches recent change descriptions and change request titles.",
  );
  await picker.click();
  await page.getByRole("option", { name: "Conventional Commits", exact: true }).click();
  expect(document.body.textContent).toContain(
    "Use Conventional Commit prefixes and keep change request text concise.",
  );
  await picker.click();
  await page.getByRole("option", { name: "Custom instructions", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Custom source control writing instructions" });
  await field.fill("Use concise titles.\nUse short bullets.");
  await picker.click();
  await page.getByRole("option", { name: "Repository conventions", exact: true }).click();
  expect(document.querySelector("textarea")?.closest("[inert]")).not.toBeNull();
  await picker.click();
  await page.getByRole("option", { name: "Custom instructions", exact: true }).click();
  expect((field.element() as HTMLTextAreaElement).value).toBe(
    "Use concise titles.\nUse short bullets.",
  );
  await page.getByRole("button", { name: "Reset source control writing style to default" }).click();
  expect(picker.element().textContent).toContain("Repository conventions");
  await picker.click();
  await page.getByRole("option", { name: "Custom instructions", exact: true }).click();
  expect((field.element() as HTMLTextAreaElement).value).toBe("");
});

it("supports keyboard selection and keeps the custom editor within a narrow viewport", async () => {
  await page.viewport(360, 800);
  i18n.loadAndActivate({ locale: "en", messages: {} });
  await render(<Harness />);
  const picker = page.getByRole("combobox", { name: "Source control writing style" });
  (picker.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}{End}{Enter}");
  const field = page.getByRole("textbox", { name: "Custom source control writing instructions" });
  await expect.element(field).toBeVisible();
  await field.fill("Keep titles concise.");
  await userEvent.tab();
  const row = picker.element().closest('[data-slot="settings-row"]')!;
  expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(360);
  expect(field.element().getBoundingClientRect().right).toBeLessThanOrEqual(360);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(360);
});

it("selects discovered, custom and transient repair models independently and resets the row", async () => {
  await page.viewport(900, 800);
  i18n.loadAndActivate({ locale: "en", messages: {} });
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

it("inherits the Git writing model for proofreading until a model is chosen, then resets", async () => {
  await page.viewport(900, 800);
  i18n.loadAndActivate({ locale: "en", messages: {} });
  await render(<Harness />);
  const picker = page.getByRole("combobox", { name: "Proofreading model", exact: true });
  const inherited = "Same as Git writing (";
  expect(picker.element().textContent).toContain(inherited);
  expect(document.querySelector('[aria-label="Reset proofreading model to default"]')).toBeNull();

  await picker.click();
  await page.getByRole("option", { name: "Codex / GPT-5.4 Mini", exact: true }).click();
  expect(picker.element().textContent).toBe("Codex / GPT-5.4 Mini");

  await page.getByRole("button", { name: "Reset proofreading model to default" }).click();
  expect(picker.element().textContent).toContain(inherited);

  await picker.click();
  await page.getByRole("option", { name: "Codex / GPT-5.4", exact: true }).click();
  await picker.click();
  await page.getByRole("option", { name: new RegExp(`^${inherited.replace("(", "\\(")}`) }).click();
  expect(picker.element().textContent).toContain(inherited);
});
