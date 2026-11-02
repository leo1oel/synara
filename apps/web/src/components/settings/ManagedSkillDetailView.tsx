import { t } from "~/i18n";
// FILE: ManagedSkillDetailView.tsx
// Purpose: In-page preview for one Lattice-managed skill.
// Layer: Settings UI

import type { ProviderManagedSkillDetail, ProviderSkillDescriptor } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";

import ChatMarkdown from "~/components/ChatMarkdown";
import {
  SettingsCard,
  SettingsEmptyState,
  SettingsSectionShell,
} from "~/components/settings/SettingsPanelPrimitives";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ChevronLeftIcon, Loader2Icon, PencilIcon, SkillCubeIcon, Trash2 } from "~/lib/icons";
import { ensureNativeApi } from "~/nativeApi";

function skillBody(markdown: string): string {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "").trim();
}

export function ManagedSkillDetailView({
  skill,
  enabled,
  onBack,
  onEdit,
  onCustomize,
  isCustomizing,
  onRemove,
}: {
  skill: ProviderSkillDescriptor;
  enabled: boolean;
  onBack: () => void;
  onEdit: ((detail: ProviderManagedSkillDetail) => void) | null;
  onCustomize: ((skill: ProviderSkillDescriptor) => void) | null;
  isCustomizing: boolean;
  onRemove: ((skill: ProviderSkillDescriptor) => void) | null;
}) {
  const management = skill.management;
  const detailQuery = useQuery({
    queryKey: ["managed-skill-detail", management?.kind, management?.id],
    queryFn: () => {
      if (!management) {
        throw new Error(t("lattice:thisSkillIsNotManagedByLattice"));
      }
      return ensureNativeApi().provider.readManagedSkill({
        kind: management.kind,
        id: management.id,
      });
    },
    enabled: Boolean(management),
    staleTime: 30_000,
  });

  const included = management?.kind === "bundled";
  const displayName = skill.interface?.displayName ?? skill.name;
  const description =
    skill.interface?.shortDescription ??
    skill.description ??
    t("lattice:noDescriptionIsProvidedForThisSkill");

  return (
    <div className="space-y-5" data-slot="managed-skill-detail">
      <Button size="sm" variant="ghost" className="-ml-2" onClick={onBack}>
        <ChevronLeftIcon className="size-3.5" aria-hidden="true" />
        {t("lattice:allSkills")}
      </Button>

      <SettingsCard divided={false} className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/55">
              <SkillCubeIcon className="size-4.5 text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-heading text-ui-lg font-semibold">{displayName}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant={included ? "info" : "outline"}>
                  {included ? t("lattice:includedWithLattice") : t("lattice:installedByYou")}
                </Badge>
                <Badge variant={enabled ? "success" : "secondary"}>
                  {enabled ? t("lattice:enabled2") : t("chat:disabled")}
                </Badge>
                {detailQuery.data ? (
                  <span className="text-ui-sm text-muted-foreground">
                    {t("lattice:files2", {
                      fileCount: detailQuery.data.files.length,
                      count: detailQuery.data.files.length,
                    })}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 max-w-2xl text-ui leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 self-start">
            {onEdit && detailQuery.data ? (
              <Button size="sm" variant="outline" onClick={() => onEdit(detailQuery.data)}>
                <PencilIcon className="size-3.5" aria-hidden="true" />
                {t("git:profile_edit")}
              </Button>
            ) : null}
            {onCustomize ? (
              <Button
                size="sm"
                variant="outline"
                disabled={isCustomizing}
                onClick={() => onCustomize(skill)}
              >
                {isCustomizing ? (
                  <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <PencilIcon className="size-3.5" aria-hidden="true" />
                )}
                {isCustomizing ? t("lattice:creatingCopy") : t("lattice:customizeACopy")}
              </Button>
            ) : null}
            {onRemove ? (
              <Button size="sm" variant="destructive-outline" onClick={() => onRemove(skill)}>
                <Trash2 className="size-3.5" aria-hidden="true" />
                {t("lattice:remove")}
              </Button>
            ) : null}
          </div>
        </div>
        {included ? (
          <p className="mt-4 border-t border-border/65 pt-3 text-ui-sm leading-relaxed text-muted-foreground">
            {t("lattice:thisProtectedSkillShipsInsideLatticeSo")}
          </p>
        ) : null}
      </SettingsCard>

      <SettingsSectionShell title={t("lattice:instructions")}>
        {detailQuery.isLoading ? (
          <SettingsEmptyState layout="status">{t("lattice:loadingSkill")}</SettingsEmptyState>
        ) : detailQuery.isError ? (
          <SettingsEmptyState tone="destructive" layout="status">
            {detailQuery.error instanceof Error
              ? detailQuery.error.message
              : t("lattice:theSkillCouldNotBeLoaded")}
          </SettingsEmptyState>
        ) : detailQuery.data ? (
          <SettingsCard divided={false} className="px-4 py-3">
            <ChatMarkdown
              text={skillBody(detailQuery.data.markdown)}
              cwd={undefined}
              isStreaming={false}
              className="text-ui leading-relaxed"
            />
          </SettingsCard>
        ) : null}
      </SettingsSectionShell>
    </div>
  );
}
