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
import { useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { useLingui } from "@lingui/react";

import {
  SettingsCard,
  SettingsEmptyState,
  SettingsRow,
  SettingsSection,
  SettingsSectionShell,
} from "~/components/settings/SettingsPanelPrimitives";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { SearchInput } from "~/components/ui/search-input";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { readEmbedMode } from "~/embedMode";
import {
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
      group.description,
      ...group.sources.flatMap((source) => [source.originInfo.label, source.skill.path]),
    ].some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export function SkillsSettingsPanel() {
  const { i18n } = useLingui();
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

  const totalSkills = skillGroups.length;
  const enabledSkills = skillGroups.filter((group) => !disabledSkillNames.has(group.key)).length;
  const refreshSkillQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
  };

  const finishSkillImport = async (status: "imported" | "replaced", skillName: string) => {
    await refreshSkillQueries();
    toastManager.add({
      type: "success",
      title: status === "replaced" ? "Skill updated" : "Skill added",
      description: `${skillName} is ready to use in Lattice.`,
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
          `A skill named “${selection.folderName}” is already installed. Replace it?`,
        );
        if (!replace) return;
        const replacement = await api.provider.importSkill({
          folderName: selection.folderName,
          files: importFiles,
          overwrite: true,
        });
        if (replacement.status === "conflict") {
          throw new Error("The existing skill changed before it could be replaced. Try again.");
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
        title: "Could not add skill",
        description: error instanceof Error ? error.message : "The selected folder is not valid.",
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
        title: "Skill restored",
        description: `${result.skill.name} is available again.`,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not restore skill",
        description: error instanceof Error ? error.message : "The skill could not be restored.",
      });
    }
  };

  const removeSkill = async (skill: ProviderSkillDescriptor) => {
    const management = skill.management;
    if (!management?.canDelete) return;
    const displayName = skill.interface?.displayName ?? skill.name;
    const confirmed = await ensureNativeApi().dialogs.confirm(
      `Remove “${displayName}” from Lattice? You can undo this immediately afterward.`,
    );
    if (!confirmed) return;

    setRemovingSkillId(management.id);
    try {
      const result = await ensureNativeApi().provider.removeManagedSkill({ id: management.id });
      setSelectedSkill(null);
      await refreshSkillQueries();
      toastManager.add({
        type: "success",
        title: "Skill removed",
        description: `${displayName} was removed from Lattice.`,
        actionProps: {
          children: "Undo",
          onClick: () => {
            void restoreRemovedSkill(result.id, result.trashId);
          },
        },
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not remove skill",
        description: error instanceof Error ? error.message : "The skill could not be removed.",
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
      title: result.status === "created" ? "Skill created" : "Skill updated",
      description: `${result.detail.skill.interface?.displayName ?? result.detail.skill.name} is ready to use.`,
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
        title: "Editable copy created",
        description: "The copy is in your user skills folder. Your original is unchanged.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not create a copy",
        description: error instanceof Error ? error.message : "The skill could not be copied.",
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
                ? "Included"
                : management?.kind === "installed"
                  ? "Local"
                  : "Detected"}
            </Badge>
          </span>
        }
        description={group.description}
        status={
          <span className="flex min-w-0 flex-col gap-1">
            <span>
              {enabled ? "Enabled" : "Disabled"} · {sourceLabels}
            </span>
            {group.sources.map((source) => (
              <code
                key={`${source.origin}:${source.skill.path}`}
                className="break-all text-[11px] text-muted-foreground"
              >
                {source.skill.path}
              </code>
            ))}
          </span>
        }
        {...(management ? { onClick: () => setSelectedSkill(skill) } : {})}
        control={
          <div className="flex items-center gap-0.5">
            <div className="flex items-center gap-1" onClick={stopRowAction}>
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => setSkillEnabled(skill.name, Boolean(checked))}
                aria-label={`Enable the ${group.displayName} skill`}
              />
              {management?.canDelete ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={isRemoving}
                  aria-label={`Remove the ${group.displayName} skill`}
                  title="Remove skill"
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
                aria-label={`Open ${group.displayName} details`}
                title="Open skill details"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedSkill(skill);
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
      <ManagedSkillDetailView
        skill={selectedSkill}
        enabled={!disabledSkillNames.has(settingsSkillNameKey(selectedSkill.name))}
        onBack={() => setSelectedSkill(null)}
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
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSection title={i18n._("Skills Manager")}>
        <SettingsRow
          title={i18n._("Your skill library")}
          description={i18n._("Included and imported skills are managed by Lattice. Skills found in your provider and project folders are listed here too and remain managed by their original tools.")}
          status={
            catalogQuery.isLoading
              ? "Scanning your library…"
              : `${enabledSkills} of ${totalSkills} skill${totalSkills === 1 ? "" : "s"} enabled`
          }
          control={
            <div className="flex flex-wrap justify-end gap-2">
              <input
                ref={(element) => {
                  skillFolderInputRef.current = element;
                  element?.setAttribute("webkitdirectory", "");
                }}
                type="file"
                multiple
                className="hidden"
                onChange={handleSkillFolderSelection}
                aria-label={i18n._("Choose a skill folder")}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedSkill(null);
                  setSkillEditor({ mode: "create" });
                }}
              >
                <PlusIcon className="size-3.5" />
                New skill
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isImportingSkill}
                onClick={() => skillFolderInputRef.current?.click()}
              >
                {isImportingSkill ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <FolderOpenIcon className="size-3.5" />
                )}
                {isImportingSkill ? "Importing…" : "Import…"}
              </Button>
            </div>
          }
        />
      </SettingsSection>

      <SearchInput
        nativeInput
        placeholder={i18n._("Search skills...")}
        value={searchQuery}
        aria-label={i18n._("Search skills")}
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
        <SettingsSectionShell title={i18n._("Skills")}>
          <SettingsEmptyState tone="destructive" layout="status">
            Lattice could not scan the skill library. Check that the local service is running, then
            reopen Settings.
          </SettingsEmptyState>
        </SettingsSectionShell>
      ) : null}

      {!catalogQuery.isLoading && !catalogQuery.isError && !hasVisibleSkills ? (
        <SettingsSectionShell title={searchQuery.trim() ? i18n._("Search results") : i18n._("Skills")}>
          <SettingsEmptyState>
            {searchQuery.trim()
              ? `No skills match “${searchQuery.trim()}”.`
              : "No skills found. Create one here or import a folder containing SKILL.md."}
          </SettingsEmptyState>
        </SettingsSectionShell>
      ) : null}

      {visibleBundledGroups.length > 0 ? (
        <SettingsSectionShell title={i18n._("Included with Lattice")}>
          <SettingsCard>{visibleBundledGroups.map(renderSkillRow)}</SettingsCard>
        </SettingsSectionShell>
      ) : null}

      {visibleInstalledGroups.length > 0 ? (
        <SettingsSectionShell title={i18n._("Installed by you")}>
          <SettingsCard>{visibleInstalledGroups.map(renderSkillRow)}</SettingsCard>
        </SettingsSectionShell>
      ) : null}

      {visibleDetectedSections.length > 0 ? (
        <SettingsSectionShell title={i18n._("Detected from your environment")}>
          <div className="space-y-5">
            {visibleDetectedSections.map((section) => (
              <div key={section.key} className="space-y-1.5">
                <h3 className="px-0.5 text-xs font-medium text-foreground">{section.title}</h3>
                <SettingsCard>{section.groups.map(renderSkillRow)}</SettingsCard>
              </div>
            ))}
          </div>
        </SettingsSectionShell>
      ) : null}
    </div>
  );
}
