// FILE: SkillsSettingsPanel.tsx
// Purpose: Lattice's Skills Manager: bundled, user-installed, provider, and project skills;
//          in-app management for Lattice-owned skills; and source-transparent discovery.
// Layer: Settings UI

import type {
  ProviderManagedSkillDetail,
  ProviderSaveManagedSkillResult,
  ProviderSkillDescriptor,
  ServerSettings,
} from "@synara/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";

import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import {
  SettingsCard,
  SettingsEmptyState,
  SettingsRow,
  SettingsSection,
  SettingsSectionShell,
} from "~/components/settings/SettingsPanelPrimitives";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuTrigger } from "~/components/ui/menu";
import { SearchInput } from "~/components/ui/search-input";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { postSettingsNavigationToLattice, readEmbedMode } from "~/embedMode";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  Loader2Icon,
  PlusIcon,
  SkillCubeIcon,
  Trash2,
} from "~/lib/icons";
import { ensureNativeApi } from "~/nativeApi";
import {
  providerDiscoveryQueryKeys,
  skillsCatalogQueryOptions,
} from "~/lib/providerDiscoveryReactQuery";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { encodeSkillSelection, prepareSkillSelection } from "~/lib/skillImport";
import { ManagedSkillDetailView } from "./ManagedSkillDetailView";
import { ManagedSkillEditorView } from "./ManagedSkillEditorView";
import {
  buildSettingsSkillGroups,
  groupSettingsSkillsBySection,
  settingsSkillNameKey,
  type SettingsSkillGroup,
} from "./skillsSettingsModel";
import { t, useTranslation } from "~/i18n";

function filterSkillGroups(
  groups: ReadonlyArray<SettingsSkillGroup>,
  query: string,
): SettingsSkillGroup[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return [...groups];
  }
  return groups.filter((group) =>
    [
      group.displayName,
      group.primarySkill.name,
      group.description ?? "",
      ...group.sources.flatMap((source) => [source.originInfo.label, source.skill.path]),
    ].some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export function SkillsSettingsPanel() {
  const { t } = useTranslation();

  const queryClient = useQueryClient();
  const skillFolderInputRef = useRef<HTMLInputElement>(null);
  const [isImportingSkill, setIsImportingSkill] = useState(false);
  const [removingSkillId, setRemovingSkillId] = useState<string | null>(null);
  const [customizingSkillId, setCustomizingSkillId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<ProviderSkillDescriptor | null>(null);
  const [skillEditor, setSkillEditor] = useState<{
    readonly mode: "create" | "update";
    readonly detail?: ProviderManagedSkillDetail;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const listScrollTopRef = useRef(0);
  const pendingScrollRef = useRef<"detail-top" | "list-position" | null>(null);
  const workspaceRoot = readEmbedMode()?.workspaceRoot ?? null;
  const catalogQuery = useQuery(skillsCatalogQueryOptions({ cwd: workspaceRoot }));
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());

  const disabledSkillNames = new Set(
    (serverSettingsQuery.data?.skills.disabled ?? []).map((name) => settingsSkillNameKey(name)),
  );

  const skillGroups = useMemo(
    () => buildSettingsSkillGroups(catalogQuery.data?.skills ?? []),
    [catalogQuery.data?.skills],
  );
  const bundledGroups = skillGroups.filter(
    (group) => group.primarySkill.management?.kind === "bundled",
  );
  const installedGroups = skillGroups.filter(
    (group) => group.primarySkill.management?.kind === "installed",
  );
  const detectedGroups = skillGroups.filter((group) => group.primarySkill.management === undefined);
  const visibleBundledGroups = filterSkillGroups(bundledGroups, searchQuery);
  const visibleInstalledGroups = filterSkillGroups(installedGroups, searchQuery);
  const visibleDetectedGroups = filterSkillGroups(detectedGroups, searchQuery);
  const visibleDetectedSections = groupSettingsSkillsBySection(visibleDetectedGroups);

  useLayoutEffect(() => {
    const pendingScroll = pendingScrollRef.current;
    const scrollOwner = panelRef.current?.closest<HTMLElement>(".synara-settings-scroll");
    if (!pendingScroll || !scrollOwner) return;

    scrollOwner.scrollTop = pendingScroll === "detail-top" ? 0 : listScrollTopRef.current;
    pendingScrollRef.current = null;
  }, [selectedSkill]);

  const openSkillDetail = (skill: ProviderSkillDescriptor) => {
    const scrollOwner = panelRef.current?.closest<HTMLElement>(".synara-settings-scroll");
    listScrollTopRef.current = scrollOwner?.scrollTop ?? 0;
    pendingScrollRef.current = "detail-top";
    const embedConfig = readEmbedMode();
    if (embedConfig) postSettingsNavigationToLattice(embedConfig, "skills", "detail");
    setSelectedSkill(skill);
  };

  const closeSkillDetail = () => {
    pendingScrollRef.current = "list-position";
    const embedConfig = readEmbedMode();
    if (embedConfig) postSettingsNavigationToLattice(embedConfig, "skills", "list");
    setSelectedSkill(null);
  };

  const setSkillEnabled = (skillName: string, enabled: boolean) => {
    // Read through the query cache so rapid toggles build on each other instead
    // of overwriting the previous optimistic patch.
    const latestSettings = queryClient.getQueryData<ServerSettings>(serverQueryKeys.settings());
    const currentDisabled = latestSettings?.skills.disabled ?? [...disabledSkillNames];
    const key = settingsSkillNameKey(skillName);
    const next = new Set(currentDisabled.map((name) => settingsSkillNameKey(name)));
    if (enabled) {
      next.delete(key);
    } else {
      next.add(key);
    }
    const disabled = [...next].sort();
    if (latestSettings) {
      queryClient.setQueryData(serverQueryKeys.settings(), {
        ...latestSettings,
        skills: { disabled },
      });
    }
    void ensureNativeApi()
      .server.updateSettings({ skills: { disabled } })
      .then((nextSettings) => {
        queryClient.setQueryData(serverQueryKeys.settings(), nextSettings);
        void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
      })
      .catch(() => {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() });
      });
  };

  const refreshSkillQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
  };

  const finishSkillImport = async (status: "imported" | "replaced", skillName: string) => {
    await refreshSkillQueries();
    toastManager.add({
      type: "success",
      title: status === "replaced" ? t("lattice:skillUpdated") : t("lattice:skillAdded"),
      description: t("lattice:isReadyToUseInLattice", { skillName }),
    });
  };

  const importSelectedSkill = async (files: File[]) => {
    setIsImportingSkill(true);
    try {
      const selection = prepareSkillSelection(files);
      const importFiles = await encodeSkillSelection(selection);
      const api = ensureNativeApi();
      const result = await api.provider.importSkill({
        folderName: selection.folderName,
        files: importFiles,
      });
      if (result.status === "conflict") {
        const replace = await api.dialogs.confirm(
          t("lattice:aSkillNamedIsAlreadyInstalledReplace", { folderName: selection.folderName }),
        );
        if (!replace) return;
        const replacement = await api.provider.importSkill({
          folderName: selection.folderName,
          files: importFiles,
          overwrite: true,
        });
        if (replacement.status === "conflict") {
          throw new Error(t("lattice:theExistingSkillChangedBeforeItCould"));
        }
        await finishSkillImport(
          replacement.status,
          replacement.skill?.name ?? selection.folderName,
        );
        return;
      }
      await finishSkillImport(result.status, result.skill?.name ?? selection.folderName);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: t("lattice:couldNotAddSkill"),
        description:
          error instanceof Error ? error.message : t("lattice:theSelectedFolderIsNotValid"),
      });
    } finally {
      setIsImportingSkill(false);
    }
  };

  const handleSkillFolderSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length > 0) {
      void importSelectedSkill(files);
    }
  };

  const restoreRemovedSkill = async (id: string, trashId: string) => {
    try {
      const result = await ensureNativeApi().provider.restoreManagedSkill({ id, trashId });
      await refreshSkillQueries();
      toastManager.add({
        type: "success",
        title: t("lattice:skillRestored"),
        description: t("lattice:isAvailableAgain", { skillName: result.skill.name }),
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: t("lattice:couldNotRestoreSkill"),
        description:
          error instanceof Error ? error.message : t("lattice:theSkillCouldNotBeRestored"),
      });
    }
  };

  const removeSkill = async (skill: ProviderSkillDescriptor) => {
    const management = skill.management;
    if (!management?.canDelete) return;
    const displayName = skill.interface?.displayName ?? skill.name;
    const confirmed = await ensureNativeApi().dialogs.confirm(
      t("lattice:removeFromLatticeYouCanUndoThis", { displayName }),
    );
    if (!confirmed) return;

    setRemovingSkillId(management.id);
    try {
      const result = await ensureNativeApi().provider.removeManagedSkill({ id: management.id });
      setSelectedSkill(null);
      await refreshSkillQueries();
      toastManager.add({
        type: "success",
        title: t("lattice:skillRemoved"),
        description: t("lattice:wasRemovedFromLattice", { displayName }),
        actionProps: {
          children: t("workspace:toast_undo"),
          onClick: () => {
            void restoreRemovedSkill(result.id, result.trashId);
          },
        },
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: t("lattice:couldNotRemoveSkill"),
        description:
          error instanceof Error ? error.message : t("lattice:theSkillCouldNotBeRemoved"),
      });
    } finally {
      setRemovingSkillId(null);
    }
  };

  const stopRowAction = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const finishSkillSave = async (result: ProviderSaveManagedSkillResult) => {
    queryClient.setQueryData(
      [
        "managed-skill-detail",
        result.detail.skill.management?.kind,
        result.detail.skill.management?.id,
      ],
      result.detail,
    );
    await refreshSkillQueries();
    setSkillEditor(null);
    setSelectedSkill(result.detail.skill);
    toastManager.add({
      type: "success",
      title: result.status === "created" ? t("lattice:skillCreated") : t("lattice:skillUpdated"),
      description: t("lattice:isReadyToUse", {
        displayName: result.detail.skill.interface?.displayName ?? result.detail.skill.name,
      }),
    });
  };

  const customizeSkill = async (skill: ProviderSkillDescriptor) => {
    const management = skill.management;
    if (!management) return;
    setCustomizingSkillId(management.id);
    try {
      const result = await ensureNativeApi().provider.duplicateManagedSkill({
        kind: management.kind,
        id: management.id,
      });
      queryClient.setQueryData(
        [
          "managed-skill-detail",
          result.detail.skill.management?.kind,
          result.detail.skill.management?.id,
        ],
        result.detail,
      );
      await refreshSkillQueries();
      setSelectedSkill(null);
      setSkillEditor({ mode: "update", detail: result.detail });
      toastManager.add({
        type: "success",
        title: t("lattice:editableCopyCreated"),
        description: t("lattice:theCopyIsInYourUserSkills"),
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: t("lattice:couldNotCreateACopy"),
        description: error instanceof Error ? error.message : t("lattice:theSkillCouldNotBeCopied"),
      });
    } finally {
      setCustomizingSkillId(null);
    }
  };

  const renderSkillRow = (group: SettingsSkillGroup) => {
    const skill = group.primarySkill;
    const management = skill.management;
    const enabled = !disabledSkillNames.has(group.key);
    const isRemoving = management?.id === removingSkillId;
    const sourceLabels = [...new Set(group.sources.map((source) => source.originInfo.label))].join(
      " · ",
    );
    return (
      <SettingsRow
        key={group.key}
        title={
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/50">
              <SkillCubeIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
            </span>
            <span className="truncate">{group.displayName}</span>
            <Badge
              size="sm"
              variant={
                management?.kind === "bundled"
                  ? "info"
                  : management?.kind === "installed"
                    ? "outline"
                    : "secondary"
              }
            >
              {management?.kind === "bundled"
                ? t("lattice:included")
                : management?.kind === "installed"
                  ? t("computer:worktreeMode_local")
                  : t("lattice:detected")}
            </Badge>
          </span>
        }
        {...(group.description !== undefined ? { description: group.description } : {})}
        status={
          <span className="flex min-w-0 flex-col gap-1">
            <span>
              {enabled ? t("lattice:enabled2") : t("chat:disabled")} · {sourceLabels}
            </span>
            {group.sources.map((source) => (
              <code
                key={`${source.origin}:${source.skill.path}`}
                className="break-all text-ui-sm text-muted-foreground"
              >
                {source.skill.path}
              </code>
            ))}
          </span>
        }
        {...(management ? { onClick: () => openSkillDetail(skill) } : {})}
        control={
          <div className="flex items-center gap-0.5">
            <div className="flex items-center gap-1" onClick={stopRowAction}>
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => setSkillEnabled(skill.name, Boolean(checked))}
                aria-label={t("settings:enableTheSkill", { value0: group.displayName })}
              />
              {management?.canDelete ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={isRemoving}
                  aria-label={t("lattice:removeTheSkill", { displayName: group.displayName })}
                  title={t("lattice:removeSkill")}
                  onClick={() => void removeSkill(skill)}
                >
                  {isRemoving ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              ) : null}
            </div>
            {management ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t("lattice:openDetails", { displayName: group.displayName })}
                title={t("lattice:openSkillDetails")}
                onClick={(event) => {
                  event.stopPropagation();
                  openSkillDetail(skill);
                }}
              >
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground/65"
                />
              </Button>
            ) : null}
          </div>
        }
      />
    );
  };

  const hasVisibleSkills =
    visibleBundledGroups.length + visibleInstalledGroups.length + visibleDetectedGroups.length > 0;

  if (skillEditor) {
    return (
      <ManagedSkillEditorView
        mode={skillEditor.mode}
        {...(skillEditor.detail ? { detail: skillEditor.detail } : {})}
        onCancel={() => {
          setSkillEditor(null);
          if (skillEditor.detail) {
            setSelectedSkill(skillEditor.detail.skill);
          }
        }}
        onSaved={(result) => void finishSkillSave(result)}
      />
    );
  }

  if (selectedSkill) {
    return (
      <div ref={panelRef}>
        <ManagedSkillDetailView
          skill={selectedSkill}
          enabled={!disabledSkillNames.has(settingsSkillNameKey(selectedSkill.name))}
          onBack={closeSkillDetail}
          onEdit={
            selectedSkill.management?.kind === "installed"
              ? (detail) => {
                  setSelectedSkill(null);
                  setSkillEditor({ mode: "update", detail });
                }
              : null
          }
          onCustomize={
            selectedSkill.management?.kind === "bundled"
              ? (skill) => void customizeSkill(skill)
              : null
          }
          isCustomizing={customizingSkillId === selectedSkill.management?.id}
          onRemove={selectedSkill.management?.canDelete ? (skill) => void removeSkill(skill) : null}
        />
      </div>
    );
  }

  return (
    <div ref={panelRef} className="space-y-6">
      <SettingsSection title={t("lattice:skillsManager")}>
        <SettingsRow
          id="setting-synara-skills-folder"
          title={t("lattice:yourSkillLibrary")}
          description={t("lattice:manageSkillsIncludedWithLatticeImportedBy")}
          control={
            <div className="skills-library-actions w-full sm:w-52">
              <input
                ref={(element) => {
                  skillFolderInputRef.current = element;
                  element?.setAttribute("webkitdirectory", "");
                }}
                type="file"
                multiple
                className="hidden"
                onChange={handleSkillFolderSelection}
                aria-label={t("lattice:chooseASkillFolder")}
              />
              <Menu>
                <MenuTrigger
                  render={<Button size="sm" variant="outline" className="w-full" />}
                  disabled={isImportingSkill}
                >
                  {isImportingSkill ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <PlusIcon className="size-3.5" />
                  )}
                  {isImportingSkill
                    ? t("workspace:searchPalette_importing")
                    : t("lattice:newSkill")}
                  {!isImportingSkill ? (
                    <ChevronDownIcon aria-hidden="true" className="ml-auto size-3 opacity-60" />
                  ) : null}
                </MenuTrigger>
                <ComposerPickerMenuPopup align="end" className="skills-library-menu w-52 min-w-52">
                  <MenuItem
                    onClick={() => {
                      setSelectedSkill(null);
                      setSkillEditor({ mode: "create" });
                    }}
                  >
                    <PlusIcon className="size-4 shrink-0" />
                    {t("lattice:createSkill")}
                  </MenuItem>
                  <MenuItem onClick={() => skillFolderInputRef.current?.click()}>
                    <FolderOpenIcon className="size-4 shrink-0" />
                    {t("lattice:importSkill")}
                  </MenuItem>
                </ComposerPickerMenuPopup>
              </Menu>
            </div>
          }
        />
      </SettingsSection>

      <SearchInput
        nativeInput
        placeholder={t("lattice:searchSkills")}
        value={searchQuery}
        aria-label={t("common:searchSkills")}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && searchQuery.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            setSearchQuery("");
          }
        }}
      />

      {catalogQuery.isError ? (
        <SettingsSectionShell title={t("common:plugin_skillsSection")}>
          <SettingsEmptyState tone="destructive" layout="status">
            {t("lattice:latticeCouldNotScanTheSkillLibrary")}
          </SettingsEmptyState>
        </SettingsSectionShell>
      ) : null}

      {!catalogQuery.isLoading && !catalogQuery.isError && !hasVisibleSkills ? (
        <SettingsSectionShell
          title={searchQuery.trim() ? t("lattice:searchResults") : t("common:plugin_skillsSection")}
        >
          <SettingsEmptyState>
            {searchQuery.trim()
              ? t("lattice:noSkillsMatch", { query: searchQuery.trim() })
              : t("lattice:noSkillsFoundCreateOneHereOr")}
          </SettingsEmptyState>
        </SettingsSectionShell>
      ) : null}

      {visibleBundledGroups.length > 0 ? (
        <SettingsSectionShell title={t("lattice:includedWithLattice")}>
          <SettingsCard>{visibleBundledGroups.map(renderSkillRow)}</SettingsCard>
        </SettingsSectionShell>
      ) : null}

      {visibleInstalledGroups.length > 0 ? (
        <SettingsSectionShell title={t("lattice:installedByYou")}>
          <SettingsCard>{visibleInstalledGroups.map(renderSkillRow)}</SettingsCard>
        </SettingsSectionShell>
      ) : null}

      {visibleDetectedSections.length > 0 ? (
        <SettingsSectionShell title={t("lattice:detectedFromYourEnvironment")}>
          <div className="space-y-4">
            {visibleDetectedSections.map((section) => {
              const skillCountLabel = t("lattice:skills", {
                skillCount: section.groups.length,
                count: section.groups.length,
              });
              return (
                <section
                  key={section.key}
                  aria-label={section.title}
                  className="overflow-hidden rounded-xl border border-[color:var(--lattice-settings-line-strong,var(--color-border))] bg-[var(--color-background-elevated-primary-opaque)]"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-[color:var(--lattice-settings-line-strong,var(--color-border))] bg-[var(--lattice-settings-accent-soft,var(--color-background-elevated-secondary))] px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-[color:var(--lattice-settings-line-strong,var(--color-border))] bg-[var(--color-background-elevated-primary-opaque)]">
                        <FolderOpenIcon
                          aria-hidden="true"
                          className="size-3.5 text-muted-foreground"
                        />
                      </span>
                      <span
                        role="heading"
                        aria-level={3}
                        className="truncate text-ui-lg font-semibold text-foreground"
                      >
                        {section.title}
                      </span>
                    </div>
                    <Badge
                      size="lg"
                      variant="outline"
                      aria-label={skillCountLabel}
                      title={skillCountLabel}
                      className="rounded-md bg-background/70 tabular-nums text-muted-foreground"
                    >
                      {section.groups.length}
                    </Badge>
                  </div>
                  <SettingsCard className="px-3">{section.groups.map(renderSkillRow)}</SettingsCard>
                </section>
              );
            })}
          </div>
        </SettingsSectionShell>
      ) : null}
    </div>
  );
}
