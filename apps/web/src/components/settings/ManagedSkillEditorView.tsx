import { t } from "~/i18n";
// FILE: ManagedSkillEditorView.tsx
// Purpose: Beginner-friendly in-app creation and editing for Lattice-managed Skills.
// Layer: Settings UI

import type { ProviderManagedSkillDetail, ProviderSaveManagedSkillResult } from "@synara/contracts";
import { useMemo, useState, type FormEvent } from "react";

import { SettingsCard, SettingsSectionShell } from "~/components/settings/SettingsPanelPrimitives";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { ChevronLeftIcon, Loader2Icon } from "~/lib/icons";
import { ensureNativeApi } from "~/nativeApi";
import { skillIdFromDisplayName, skillInstructionsFromMarkdown } from "./skillEditorModel";

export function ManagedSkillEditorView({
  mode,
  detail,
  onCancel,
  onSaved,
}: {
  mode: "create" | "update";
  detail?: ProviderManagedSkillDetail;
  onCancel: () => void;
  onSaved: (result: ProviderSaveManagedSkillResult) => void;
}) {
  const initialDisplayName = detail?.skill.interface?.displayName ?? detail?.skill.name ?? "";
  const initialDescription =
    detail?.skill.description ?? detail?.skill.interface?.shortDescription ?? "";
  const initialInstructions = detail ? skillInstructionsFromMarkdown(detail.markdown) : "";
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [description, setDescription] = useState(initialDescription);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const generatedId = useMemo(() => skillIdFromDisplayName(displayName), [displayName]);
  const id = mode === "update" ? detail?.skill.management?.id : generatedId;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) {
      setErrorMessage(t("lattice:thisSkillDoesNotHaveAnEditable"));
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const result = await ensureNativeApi().provider.saveManagedSkill({
        mode,
        id,
        displayName,
        description,
        instructions,
      });
      onSaved(result);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("lattice:theSkillCouldNotBeSaved"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className="[&>.settings-group]:mt-4!" onSubmit={(event) => void handleSubmit(event)}>
      <Button type="button" size="sm" variant="ghost" className="-ml-2" onClick={onCancel}>
        <ChevronLeftIcon className="size-3.5" aria-hidden="true" />
        {mode === "create" ? t("lattice:allSkills") : t("lattice:skillDetails")}
      </Button>

      <SettingsSectionShell
        title={mode === "create" ? t("lattice:createASkill") : t("lattice:editSkill")}
      >
        <SettingsCard divided={false} className="managed-skill-editor-fields space-y-5 pt-4">
          <div className="space-y-1.5">
            <label
              className="managed-skill-field-label font-system-ui font-medium text-foreground"
              htmlFor="managed-skill-name"
            >
              {t("lattice:skillName")}
            </label>
            <Input
              id="managed-skill-name"
              nativeInput
              value={displayName}
              maxLength={100}
              autoFocus
              placeholder={t("lattice:literatureReview")}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-describedby="managed-skill-name-help"
            />
            <p
              id="managed-skill-name-help"
              className="managed-skill-field-help text-muted-foreground"
            >
              {mode === "create"
                ? t("lattice:latticeWillSaveThisAs", { generatedId })
                : t("lattice:internalName", { internalName: detail?.skill.name ?? id })}
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              className="managed-skill-field-label font-system-ui font-medium text-foreground"
              htmlFor="managed-skill-description"
            >
              {t("lattice:whatShouldThisSkillDo")}
            </label>
            <Textarea
              id="managed-skill-description"
              value={description}
              maxLength={4_000}
              placeholder={t("lattice:explainWhatTheSkillDoesAndWhen")}
              className="[&_[data-slot=textarea]]:min-h-24"
              onChange={(event) => setDescription(event.target.value)}
            />
            <p className="managed-skill-field-help text-muted-foreground">
              {t("lattice:includeTheKindsOfRequestsThatShould")}
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              className="managed-skill-field-label font-system-ui font-medium text-foreground"
              htmlFor="managed-skill-instructions"
            >
              {t("lattice:instructions")}
            </label>
            <Textarea
              id="managed-skill-instructions"
              value={instructions}
              placeholder={t("lattice:writeTheWorkflowRulesExamplesOrGuidance")}
              className="[&_[data-slot=textarea]]:min-h-52"
              onChange={(event) => setInstructions(event.target.value)}
            />
            <p className="managed-skill-field-help text-muted-foreground">
              {t("lattice:plainTextWorksMarkdownFormattingIsOptional")}
            </p>
          </div>

          {errorMessage ? (
            <p role="alert" className="text-ui-xs leading-relaxed text-destructive">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border/65 pt-4">
            {mode === "update" ? (
              <Button type="button" size="sm" variant="outline" onClick={onCancel}>
                {t("common:form_cancel")}
              </Button>
            ) : null}
            <Button
              type="submit"
              size="sm"
              disabled={
                isSaving || !displayName.trim() || !description.trim() || !instructions.trim()
              }
            >
              {isSaving ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              {isSaving
                ? t("common:saving")
                : mode === "create"
                  ? t("lattice:createSkill")
                  : t("workspace:scripts_saveChanges")}
            </Button>
          </div>
        </SettingsCard>
      </SettingsSectionShell>
    </form>
  );
}
