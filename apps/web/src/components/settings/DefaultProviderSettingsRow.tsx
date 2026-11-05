// FILE: DefaultProviderSettingsRow.tsx
// Purpose: The Default provider setting, shared by General and Lattice's embedded Providers page.
// Layer: Settings UI

import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@synara/contracts";

import type { AppSettingsBinding } from "~/appSettings";
import { useTranslation } from "~/i18n";

import { VISIBLE_PROVIDER_DESCRIPTORS } from "../../betaFeatures";
import { ProviderOptionLabel } from "../ProviderIcon";
import { SelectItem } from "../ui/select";
import { SettingResetButton, SettingsSelectControl } from "./SettingControls";
import { SettingsRow } from "./SettingsPanelPrimitives";

const PROVIDER_SELECT_OPTIONS = VISIBLE_PROVIDER_DESCRIPTORS.map((descriptor) => descriptor.kind);

function isProviderSelectOption(value: string): value is ProviderKind {
  return PROVIDER_SELECT_OPTIONS.includes(value as ProviderKind);
}

export function DefaultProviderSettingsRow({
  settings,
  defaults,
  updateSettings,
}: Pick<AppSettingsBinding, "settings" | "defaults" | "updateSettings">) {
  const { t } = useTranslation();
  return (
    <SettingsRow
      id="setting-default-provider"
      title="settings:changed_defaultProvider"
      description="settings:providerUsedForNewChatsUntilYouPickA"
      resetAction={
        settings.defaultProvider !== defaults.defaultProvider ? (
          <SettingResetButton
            label={t("settings:defaultProvider")}
            onClick={() => updateSettings({ defaultProvider: defaults.defaultProvider })}
          />
        ) : null
      }
      control={
        <SettingsSelectControl
          value={settings.defaultProvider}
          onValueChange={(value) => {
            if (!isProviderSelectOption(value)) return;
            updateSettings({ defaultProvider: value });
          }}
          ariaLabel={t("settings:changed_defaultProvider")}
          valueContent={
            <ProviderOptionLabel
              provider={settings.defaultProvider}
              label={PROVIDER_DISPLAY_NAMES[settings.defaultProvider]}
            />
          }
        >
          {PROVIDER_SELECT_OPTIONS.map((provider) => (
            <SelectItem key={provider} value={provider}>
              <ProviderOptionLabel provider={provider} label={PROVIDER_DISPLAY_NAMES[provider]} />
            </SelectItem>
          ))}
        </SettingsSelectControl>
      }
    />
  );
}
