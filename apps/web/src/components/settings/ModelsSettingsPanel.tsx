// FILE: ModelsSettingsPanel.tsx
// Purpose: Own model-setting discovery, selection, and custom-model editing workflows.
// Layer: Settings panel

import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  GIT_TEXT_GENERATION_PROVIDERS,
  PROVIDER_DISPLAY_NAMES,
  MAX_SOURCE_CONTROL_CUSTOM_INSTRUCTIONS_LENGTH,
  type GitTextGenerationProvider,
  type ProviderKind,
  type SourceControlWritingStyle,
} from "@synara/contracts";
import { getModelOptions, normalizeModelSlug } from "@synara/shared/model";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import type { I18n, MessageDescriptor } from "@lingui/core";

import {
  CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS,
  type AppSettingsBinding,
  MAX_CUSTOM_MODEL_LENGTH,
  getAppModelOptions,
  getCustomModelsForProvider,
  getDefaultCustomModelsForProvider,
  getProviderInstanceOptions,
  isGitTextGenerationSettingsDirty,
  patchCustomModels,
} from "~/appSettings";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { PlusIcon, XIcon } from "~/lib/icons";
import { resolveProviderDiscoveryCwd } from "~/lib/providerDiscovery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { SETTINGS_INSET_LIST_CLASS_NAME } from "~/settingsPanelStyles";

import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import {
  SettingResetButton,
  SettingsSelectControl,
  useSettingsRestoreSignal,
} from "./SettingControls";
import { SettingsRow, SettingsSection, SettingsSelectPopup } from "./SettingsPanelPrimitives";
import { DebouncedSettingTextarea } from "./DebouncedSettingTextInput";

const SOURCE_CONTROL_WRITING_OPTIONS: readonly {
  value: SourceControlWritingStyle;
  label: MessageDescriptor;
  description: MessageDescriptor;
}[] = [
  {
    value: "repository",
    label: msg`Repository conventions`,
    description: msg`In each project, matches recent change descriptions and change request titles.`,
  },
  {
    value: "conventional",
    label: msg`Conventional Commits`,
    description: msg`Use Conventional Commit prefixes and keep change request text concise.`,
  },
  {
    value: "custom",
    label: msg`Custom instructions`,
    description: msg`Use your instructions for change descriptions and change requests in every project.`,
  },
];

// Picker values are "instance:provider:model"; this one has no colon, so it
// never collides with a model choice.
const PROOFREAD_INHERIT_VALUE = "inherit";

type CustomModelValidationResult =
  | { readonly model: string; readonly error?: never }
  | { readonly model?: never; readonly error: string };

export function validateCustomModelInput(
  input: {
    readonly provider: ProviderKind;
    readonly value: string;
    readonly savedModels: readonly string[];
  },
  i18n: I18n,
): CustomModelValidationResult {
  const normalized = normalizeModelSlug(input.value, input.provider);
  if (!normalized) {
    return { error: i18n._(msg`Enter a model slug.`) };
  }
  if (getModelOptions(input.provider).some((option) => option.slug === normalized)) {
    return { error: i18n._(msg`That model is already built in.`) };
  }
  if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
    const max = MAX_CUSTOM_MODEL_LENGTH;
    return { error: i18n._(msg`Model slugs must be ${max} characters or less.`) };
  }
  if (input.savedModels.includes(normalized)) {
    return { error: i18n._(msg`That custom model is already saved.`) };
  }
  return { model: normalized };
}

function isCustomModelEditorProvider(value: string | null): value is ProviderKind {
  return CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS.some((config) => config.provider === value);
}

export function ModelsSettingsPanel({
  settings,
  defaults,
  updateSettings,
  resetEpoch,
  active,
}: AppSettingsBinding & { readonly resetEpoch: number; readonly active: boolean }) {
  const { i18n } = useLingui();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const [selectedCustomModelProvider, setSelectedCustomModelProvider] =
    useState<ProviderKind>("codex");
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Partial<Record<ProviderKind, string>>
  >({});
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});
  const [showAllCustomModels, setShowAllCustomModels] = useState(false);

  useSettingsRestoreSignal(resetEpoch, () => {
    setSelectedCustomModelProvider("codex");
    setCustomModelInputByProvider({});
    setCustomModelErrorByProvider({});
    setShowAllCustomModels(false);
  });

  const { textGenerationModel, textGenerationProvider, textGenerationProviderInstanceId } =
    settings;
  const currentGitTextGenerationProvider = textGenerationProvider ?? "codex";
  const currentGitTextGenerationInstanceId =
    textGenerationProviderInstanceId ?? currentGitTextGenerationProvider;
  const currentGitTextGenerationModel = textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL;
  const currentCompileRepairProvider = settings.compileRepairProvider ?? "codex";
  const currentCompileRepairModel =
    settings.compileRepairModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL;
  const gitWritingModelHintByProvider = useMemo<Partial<Record<ProviderKind, string | null>>>(
    () => ({ [currentGitTextGenerationProvider]: currentGitTextGenerationModel }),
    [currentGitTextGenerationModel, currentGitTextGenerationProvider],
  );
  const providerModelDiscoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: null,
    activeProjectCwd: null,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });
  const { modelOptionsByProviderInstance: gitWritingCatalogOptionsByInstance } =
    useProviderModelCatalog({
      selectedProvider: currentGitTextGenerationProvider,
      selectedProviderInstanceId: currentGitTextGenerationInstanceId,
      discoveryEnabled: active,
      cwd: providerModelDiscoveryCwd,
      modelHintByProvider: gitWritingModelHintByProvider,
      prefetchProviders: GIT_TEXT_GENERATION_PROVIDERS,
    });
  const providerInstanceOptions = useMemo(() => getProviderInstanceOptions(settings), [settings]);
  const gitTextGenerationPickerOptions = useMemo(
    () =>
      providerInstanceOptions.flatMap((instance) =>
        (instance.enabled || instance.instanceId === currentGitTextGenerationInstanceId) &&
        GIT_TEXT_GENERATION_PROVIDERS.includes(instance.provider as GitTextGenerationProvider)
          ? (gitWritingCatalogOptionsByInstance[instance.instanceId] ?? []).map((option) => ({
              key: `${instance.instanceId}:${instance.provider}:${option.slug}`,
              value: `${instance.instanceId}:${instance.provider}:${option.slug}`,
              instance,
              option: { ...option, provider: instance.provider },
            }))
          : [],
      ),
    [
      currentGitTextGenerationInstanceId,
      gitWritingCatalogOptionsByInstance,
      providerInstanceOptions,
    ],
  );
  const currentGitTextGenerationValue = `${currentGitTextGenerationInstanceId}:${currentGitTextGenerationProvider}:${currentGitTextGenerationModel}`;
  const repairProviders = useMemo(
    () => CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS.map((config) => config.provider),
    [],
  );
  const repairModelHintByProvider = useMemo(
    () => ({ [currentCompileRepairProvider]: currentCompileRepairModel }),
    [currentCompileRepairProvider, currentCompileRepairModel],
  );
  const { modelOptionsByProvider: repairCatalogOptionsByProvider } = useProviderModelCatalog({
    selectedProvider: currentCompileRepairProvider,
    discoveryEnabled: active,
    cwd: providerModelDiscoveryCwd,
    modelHintByProvider: repairModelHintByProvider,
    prefetchProviders: repairProviders,
  });
  const compileRepairModelOptions = repairProviders.flatMap((provider) => {
    const options = repairCatalogOptionsByProvider[provider];
    const fallback = getAppModelOptions(
      provider,
      getCustomModelsForProvider(settings, provider),
      provider === currentCompileRepairProvider ? currentCompileRepairModel : null,
    );
    return [
      ...options.map((option) => ({ ...option, provider })),
      ...fallback.filter((option) => !options.some((known) => known.slug === option.slug)),
    ];
  });
  const isGitTextGenerationModelDirty = isGitTextGenerationSettingsDirty(settings, defaults);
  const selectedGitTextGenerationPickerOption = gitTextGenerationPickerOptions.find(
    (entry) => entry.value === currentGitTextGenerationValue,
  );
  const selectedGitTextGenerationModelName =
    selectedGitTextGenerationPickerOption?.option.name ??
    gitWritingCatalogOptionsByInstance[currentGitTextGenerationInstanceId]?.find(
      (option) => option.slug === currentGitTextGenerationModel,
    )?.name ??
    currentGitTextGenerationModel;
  const selectedGitTextGenerationInstanceLabel =
    selectedGitTextGenerationPickerOption?.instance.label ??
    providerInstanceOptions.find(
      (option) => option.instanceId === currentGitTextGenerationInstanceId,
    )?.label;
  const selectedGitTextGenerationModelLabel =
    selectedGitTextGenerationInstanceLabel &&
    selectedGitTextGenerationInstanceLabel !==
      PROVIDER_DISPLAY_NAMES[currentGitTextGenerationProvider]
      ? `${selectedGitTextGenerationInstanceLabel} · ${selectedGitTextGenerationModelName}`
      : selectedGitTextGenerationModelName;
  // Proofreading offers the Git writing choices, since both run on the same
  // tool-free text-generation path, plus inheriting whatever Git writing uses.
  const proofreadOverrideValue = settings.proofreadModel
    ? `${settings.proofreadProviderInstanceId ?? settings.proofreadProvider ?? "codex"}:${settings.proofreadProvider ?? "codex"}:${settings.proofreadModel}`
    : null;
  const selectedProofreadPickerOption = proofreadOverrideValue
    ? gitTextGenerationPickerOptions.find((entry) => entry.value === proofreadOverrideValue)
    : undefined;
  const inheritedProofreadLabel = i18n._("Same as Git writing ({model})", {
    model: selectedGitTextGenerationModelLabel,
  });
  const selectedProofreadModelLabel = !proofreadOverrideValue
    ? inheritedProofreadLabel
    : selectedProofreadPickerOption
      ? `${selectedProofreadPickerOption.instance.label} / ${selectedProofreadPickerOption.option.name}`
      : (settings.proofreadModel ?? "");
  const selectedCustomModelProviderSettings = CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS.find(
    (config) => config.provider === selectedCustomModelProvider,
  )!;
  const selectedCustomModelInput = customModelInputByProvider[selectedCustomModelProvider] ?? "";
  const selectedCustomModelError = customModelErrorByProvider[selectedCustomModelProvider] ?? null;
  const savedCustomModelRows = useMemo(
    () =>
      CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS.flatMap((config) =>
        getCustomModelsForProvider(settings, config.provider).map((slug) => ({
          key: `${config.provider}:${slug}`,
          provider: config.provider,
          providerTitle: config.title,
          slug,
        })),
      ),
    [settings],
  );
  const visibleCustomModelRows = savedCustomModelRows.slice(0, 5);
  const overflowCustomModelRows = savedCustomModelRows.slice(5);

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      const result = validateCustomModelInput(
        {
          provider,
          value: customModelInputByProvider[provider] ?? "",
          savedModels: customModels,
        },
        i18n,
      );
      if ("error" in result) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: result.error,
        }));
        return;
      }

      updateSettings(patchCustomModels(provider, [...customModels, result.model]));
      setCustomModelInputByProvider((existing) => ({ ...existing, [provider]: "" }));
      setCustomModelErrorByProvider((existing) => ({ ...existing, [provider]: null }));
    },
    [customModelInputByProvider, i18n, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(
        patchCustomModels(
          provider,
          customModels.filter((model) => model !== slug),
        ),
      );
      setCustomModelErrorByProvider((existing) => ({ ...existing, [provider]: null }));
    },
    [settings, updateSettings],
  );

  const resetCustomModels = useCallback(() => {
    const patch = Object.assign(
      {},
      ...CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS.map((config) =>
        patchCustomModels(config.provider, [
          ...getDefaultCustomModelsForProvider(defaults, config.provider),
        ]),
      ),
    );
    updateSettings(patch);
    setCustomModelErrorByProvider({});
    setShowAllCustomModels(false);
  }, [defaults, updateSettings]);

  const renderCustomModelRow = (
    row: (typeof savedCustomModelRows)[number],
    removeFirstBorder: boolean,
  ) => (
    <div
      key={row.key}
      className={cn(
        "group grid grid-cols-[minmax(5rem,6rem)_minmax(0,1fr)_auto] items-center gap-3 border-t border-[color:var(--color-border)] px-4 py-2",
        removeFirstBorder && "first:border-t-0",
      )}
    >
      <span className="truncate text-ui leading-snug text-muted-foreground">
        {row.providerTitle}
      </span>
      <code className="min-w-0 truncate text-ui-lg leading-snug text-foreground">{row.slug}</code>
      <button
        type="button"
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
        aria-label={i18n._("Remove {model}", { model: row.slug })}
        onClick={() => removeCustomModel(row.provider, row.slug)}
      >
        <XIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
      </button>
    </div>
  );

  if (!active) return null;

  const writingOption = SOURCE_CONTROL_WRITING_OPTIONS.find(
    (option) => option.value === settings.sourceControlWritingStyle,
  )!;
  const isWritingStyleDirty =
    settings.sourceControlWritingStyle !== defaults.sourceControlWritingStyle ||
    settings.sourceControlCustomInstructions !== defaults.sourceControlCustomInstructions;

  return (
    <div className="space-y-6">
      <SettingsSection title={i18n._("Generation defaults")}>
        <SettingsRow
          title={i18n._("Source control writing style")}
          description={i18n._(writingOption.description)}
          resetAction={
            isWritingStyleDirty ? (
              <SettingResetButton
                label="source control writing style"
                onClick={() =>
                  updateSettings({
                    sourceControlWritingStyle: defaults.sourceControlWritingStyle,
                    sourceControlCustomInstructions: defaults.sourceControlCustomInstructions,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={settings.sourceControlWritingStyle}
              onValueChange={(value) => {
                const option = SOURCE_CONTROL_WRITING_OPTIONS.find(
                  (option) => option.value === value,
                );
                if (option) updateSettings({ sourceControlWritingStyle: option.value });
              }}
              ariaLabel={i18n._("Source control writing style")}
              triggerClassName="w-full sm:w-60"
              valueContent={i18n._(writingOption.label)}
            >
              {SOURCE_CONTROL_WRITING_OPTIONS.map((option) => (
                <SelectItem hideIndicator key={option.value} value={option.value}>
                  {i18n._(option.label)}
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        >
          <DisclosureRegion open={settings.sourceControlWritingStyle === "custom"}>
            <DebouncedSettingTextarea
              key={resetEpoch}
              className="mt-3 [&_textarea]:min-h-28 [&_textarea]:resize-y"
              aria-label={i18n._("Custom source control writing instructions")}
              placeholder={i18n._("Keep titles concise. Use short bullet points in descriptions.")}
              maxLength={MAX_SOURCE_CONTROL_CUSTOM_INSTRUCTIONS_LENGTH}
              value={settings.sourceControlCustomInstructions}
              onCommit={(value) => updateSettings({ sourceControlCustomInstructions: value })}
            />
          </DisclosureRegion>
        </SettingsRow>
        <SettingsRow
          title={i18n._("Git writing model")}
          description={i18n._(
            "Used for generated commit messages, PR titles, and branch names. Lattice proofreading follows it unless a proofreading model is chosen.",
          )}
          resetAction={
            isGitTextGenerationModelDirty ? (
              <SettingResetButton
                label="git writing model"
                onClick={() =>
                  updateSettings({
                    textGenerationProvider: defaults.textGenerationProvider,
                    textGenerationProviderInstanceId: defaults.textGenerationProviderInstanceId,
                    textGenerationModel: defaults.textGenerationModel,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={currentGitTextGenerationValue}
              onValueChange={(value) => {
                if (!value) return;
                const [instanceId, provider, ...modelParts] = value.split(":");
                const model = modelParts.join(":");
                if (!instanceId || !provider || !model) return;
                updateSettings({
                  textGenerationProvider: provider as ProviderKind,
                  textGenerationProviderInstanceId: instanceId,
                  textGenerationModel: model,
                });
              }}
              ariaLabel={i18n._("Git text generation model")}
              triggerClassName="w-full sm:w-52"
              valueContent={selectedGitTextGenerationModelLabel}
            >
              {gitTextGenerationPickerOptions.map(({ instance, key, option, value }) => (
                <SelectItem hideIndicator key={key} value={value}>
                  {instance.label} / {option.name}
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />
        <SettingsRow
          title={i18n._("Proofreading model")}
          description={i18n._(
            "Used by Lattice to proofread a selection, without tools or file access. Follows the Git writing model until you choose one.",
          )}
          resetAction={
            proofreadOverrideValue ? (
              <SettingResetButton
                label="proofreading model"
                onClick={() =>
                  updateSettings({
                    proofreadProvider: undefined,
                    proofreadProviderInstanceId: undefined,
                    proofreadModel: undefined,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={proofreadOverrideValue ?? PROOFREAD_INHERIT_VALUE}
              onValueChange={(value) => {
                if (!value) return;
                if (value === PROOFREAD_INHERIT_VALUE) {
                  updateSettings({
                    proofreadProvider: undefined,
                    proofreadProviderInstanceId: undefined,
                    proofreadModel: undefined,
                  });
                  return;
                }
                const [instanceId, provider, ...modelParts] = value.split(":");
                const model = modelParts.join(":");
                if (!instanceId || !provider || !model) return;
                updateSettings({
                  proofreadProvider: provider as ProviderKind,
                  proofreadProviderInstanceId: instanceId,
                  proofreadModel: model,
                });
              }}
              ariaLabel={i18n._("Proofreading model")}
              triggerClassName="w-full sm:w-52"
              valueContent={selectedProofreadModelLabel}
            >
              <SelectItem hideIndicator value={PROOFREAD_INHERIT_VALUE}>
                {inheritedProofreadLabel}
              </SelectItem>
              {gitTextGenerationPickerOptions.map(({ instance, key, option, value }) => (
                <SelectItem hideIndicator key={key} value={value}>
                  {instance.label} / {option.name}
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />
        <SettingsRow
          title={i18n._("Compile repair model")}
          description={i18n._(
            "Used by Lattice to repair one compile diagnostic in an independent background task.",
          )}
          resetAction={
            settings.compileRepairProvider !== defaults.compileRepairProvider ||
            settings.compileRepairModel !== defaults.compileRepairModel ? (
              <SettingResetButton
                label="compile repair model"
                onClick={() =>
                  updateSettings({
                    compileRepairProvider: defaults.compileRepairProvider,
                    compileRepairModel: defaults.compileRepairModel,
                  })
                }
              />
            ) : null
          }
          control={
            <SettingsSelectControl
              value={`${currentCompileRepairProvider}:${currentCompileRepairModel}`}
              onValueChange={(value) => {
                if (!value) return;
                const separatorIndex = value.indexOf(":");
                const provider = value.slice(0, separatorIndex) as ProviderKind;
                const model = value.slice(separatorIndex + 1);
                if (!provider || !model) return;
                updateSettings({ compileRepairProvider: provider, compileRepairModel: model });
              }}
              ariaLabel={i18n._("Compile repair model")}
              triggerClassName="w-full sm:w-52"
              valueContent={
                compileRepairModelOptions.find(
                  (option) =>
                    option.provider === currentCompileRepairProvider &&
                    option.slug === currentCompileRepairModel,
                )?.name ?? currentCompileRepairModel
              }
            >
              {compileRepairModelOptions.map((option) => (
                <SelectItem
                  key={`${option.provider}:${option.slug}`}
                  value={`${option.provider}:${option.slug}`}
                >
                  {PROVIDER_DISPLAY_NAMES[option.provider]} / {option.name}
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <SettingsSection title={i18n._("Custom models")}>
        <SettingsRow
          title={i18n._("Add models manually")}
          description={i18n._(
            "If a model does not appear automatically, choose its provider and enter its model ID. It will then be available in model pickers.",
          )}
          resetAction={
            savedCustomModelRows.length > 0 ? (
              <SettingResetButton label="custom models" onClick={resetCustomModels} />
            ) : null
          }
        >
          <div className="mt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                value={selectedCustomModelProvider}
                onValueChange={(value) => {
                  if (isCustomModelEditorProvider(value)) {
                    setSelectedCustomModelProvider(value);
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={i18n._("Custom model provider")}
                >
                  <SelectValue>{selectedCustomModelProviderSettings.title}</SelectValue>
                </SelectTrigger>
                <SettingsSelectPopup align="start">
                  {CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS.map((config) => (
                    <SelectItem key={config.provider} value={config.provider}>
                      {config.title}
                    </SelectItem>
                  ))}
                </SettingsSelectPopup>
              </Select>
              <Input
                id="custom-model-slug"
                size="sm"
                variant="soft"
                value={selectedCustomModelInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomModelInputByProvider((existing) => ({
                    ...existing,
                    [selectedCustomModelProvider]: value,
                  }));
                  if (selectedCustomModelError) {
                    setCustomModelErrorByProvider((existing) => ({
                      ...existing,
                      [selectedCustomModelProvider]: null,
                    }));
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addCustomModel(selectedCustomModelProvider);
                }}
                placeholder={selectedCustomModelProviderSettings.example}
                spellCheck={false}
              />
              <Button
                className="shrink-0"
                variant="outline"
                onClick={() => addCustomModel(selectedCustomModelProvider)}
              >
                <PlusIcon className="size-3.5" />
                {i18n._("Add")}
              </Button>
            </div>

            {selectedCustomModelError ? (
              <p className="mt-2 text-ui leading-snug text-destructive">
                {selectedCustomModelError}
              </p>
            ) : null}

            {savedCustomModelRows.length > 0 ? (
              <div className={cn("mt-3", SETTINGS_INSET_LIST_CLASS_NAME)}>
                {visibleCustomModelRows.map((row) => renderCustomModelRow(row, true))}
                {overflowCustomModelRows.length > 0 ? (
                  <>
                    <DisclosureRegion open={showAllCustomModels}>
                      <div>
                        {overflowCustomModelRows.map((row) => renderCustomModelRow(row, false))}
                      </div>
                    </DisclosureRegion>
                    <button
                      type="button"
                      className="mt-2 text-ui leading-snug text-muted-foreground transition-colors hover:text-foreground"
                      aria-expanded={showAllCustomModels}
                      onClick={() => setShowAllCustomModels((value) => !value)}
                    >
                      {showAllCustomModels
                        ? i18n._("Show less")
                        : i18n._("Show more ({count})", {
                            count: overflowCustomModelRows.length,
                          })}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
