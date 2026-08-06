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
      setErrorMessage("This skill does not have an editable identifier.");
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
      setErrorMessage(error instanceof Error ? error.message : "The skill could not be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
      <Button type="button" size="sm" variant="ghost" className="-ml-2" onClick={onCancel}>
        <ChevronLeftIcon className="size-3.5" aria-hidden="true" />
        {mode === "create" ? "All skills" : "Skill details"}
      </Button>

      <SettingsSectionShell title={mode === "create" ? "Create a skill" : "Edit skill"}>
        <SettingsCard divided={false} className="space-y-5 p-4">
          <div className="space-y-1.5">
            <label
              className="font-system-ui text-xs font-medium text-foreground"
              htmlFor="managed-skill-name"
            >
              Skill name
            </label>
            <Input
              id="managed-skill-name"
              nativeInput
              value={displayName}
              maxLength={100}
              autoFocus
              placeholder="Literature Review"
              onChange={(event) => setDisplayName(event.target.value)}
              aria-describedby="managed-skill-name-help"
            />
            <p
              id="managed-skill-name-help"
              className="text-[11px] leading-relaxed text-muted-foreground"
            >
              {mode === "create"
                ? `Lattice will save this as “${generatedId}”.`
                : `Internal name: ${detail?.skill.name ?? id}`}
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              className="font-system-ui text-xs font-medium text-foreground"
              htmlFor="managed-skill-description"
            >
              What should this skill do?
            </label>
            <Textarea
              id="managed-skill-description"
              value={description}
              maxLength={4_000}
              placeholder="Explain what the skill does and when Lattice should use it."
              className="[&_[data-slot=textarea]]:min-h-24"
              onChange={(event) => setDescription(event.target.value)}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Include the kinds of requests that should activate this skill.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              className="font-system-ui text-xs font-medium text-foreground"
              htmlFor="managed-skill-instructions"
            >
              Instructions
            </label>
            <Textarea
              id="managed-skill-instructions"
              value={instructions}
              placeholder="Write the workflow, rules, examples, or guidance Lattice should follow."
              className="[&_[data-slot=textarea]]:min-h-52"
              onChange={(event) => setInstructions(event.target.value)}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Plain text works. Markdown formatting is optional, and everything wraps inside the
              editor.
            </p>
          </div>

          {errorMessage ? (
            <p role="alert" className="text-xs leading-relaxed text-destructive">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border/65 pt-4">
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                isSaving || !displayName.trim() || !description.trim() || !instructions.trim()
              }
            >
              {isSaving ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              {isSaving ? "Saving…" : mode === "create" ? "Create skill" : "Save changes"}
            </Button>
          </div>
        </SettingsCard>
      </SettingsSectionShell>
    </form>
  );
}
