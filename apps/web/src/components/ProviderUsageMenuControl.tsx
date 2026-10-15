// FILE: ProviderUsageMenuControl.tsx
// Purpose: Shared provider-usage chip/menu used in the chat header and Environment panel.

import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerCodexResetCredits,
  type ServerGetProviderUsageSnapshotResult,
} from "@synara/contracts";
import { providerUsageNeedsAuthDetail } from "@synara/shared/providerUsage";
import { useLingui } from "@lingui/react";
import { type ReactNode, useEffect, useState } from "react";

import { useAppSettings } from "~/appSettings";
import {
  type ProviderUsageSummaryData,
  useProviderUsageSummary,
} from "~/hooks/useProviderUsageSummary";
import {
  deriveProviderUsageDisplayRows,
  localizeProviderUsageDisplayText,
  selectPrimaryProviderUsageDisplayRow,
  type ProviderUsageDisplayRow,
} from "~/lib/providerUsageDisplay";
import type { OpenUsageUsageLine } from "~/lib/openUsageRateLimits";
import type { ProviderRateLimit } from "~/lib/rateLimits";
import { useStore } from "~/store";
import { createAccountRateLimitThreadsSelector } from "~/storeSelectors";

import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { ChatHeaderButton } from "./chat/chatHeaderControls";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderUsagePanelContent } from "./ProviderUsagePanelContent";
import { Menu, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export interface ProviderUsageMenuModel {
  menuTitle: string;
  primaryRow: ProviderUsageDisplayRow | null;
  rows: ReadonlyArray<ProviderUsageDisplayRow>;
  rateLimits: ReadonlyArray<ProviderRateLimit>;
  usageLines: ReadonlyArray<OpenUsageUsageLine>;
  notice: string | undefined;
  emptyMessage: string | undefined;
  isLoading: boolean;
  resetCredits?: ServerCodexResetCredits | undefined;
}

export function buildProviderUsageMenuModel(input: {
  provider: ProviderKind;
  providerSnapshot?: ServerGetProviderUsageSnapshotResult | undefined;
  usageSummary: ProviderUsageSummaryData & { readonly isLoading: boolean };
}): ProviderUsageMenuModel {
  const rows = deriveProviderUsageDisplayRows(input.usageSummary.rateLimits);

  return {
    menuTitle: `${PROVIDER_DISPLAY_NAMES[input.provider]} usage`,
    primaryRow: selectPrimaryProviderUsageDisplayRow(rows),
    rows,
    rateLimits: input.usageSummary.rateLimits,
    usageLines: input.usageSummary.usageLines,
    notice: input.usageSummary.usageNotice,
    emptyMessage: providerUsageEmptyMessage(input.provider, input.providerSnapshot),
    isLoading: input.usageSummary.isLoading,
    resetCredits: input.usageSummary.resetCredits,
  };
}

// Module-level: the selector memoizes on store slices, so recreating it per render would
// defeat the memo and rebuild every thread on each streaming flush.
const selectAccountRateLimitThreads = createAccountRateLimitThreadsSelector();

function providerUsageEmptyMessage(
  provider: ProviderKind,
  snapshot: ServerGetProviderUsageSnapshotResult | undefined,
): string | undefined {
  switch (snapshot?.status) {
    case "needs-auth":
      return snapshot.detail ?? providerUsageNeedsAuthDetail(provider);
    case "unsupported":
      return snapshot.detail ?? "Live usage is not available for this provider configuration.";
    case "error":
      return snapshot.detail ?? "Usage is currently unavailable.";
    default:
      return undefined;
  }
}

export function useProviderUsageMenuModel(
  provider: ProviderKind,
  input: {
    instanceId?: ProviderInstanceId | undefined;
    providerSnapshot?: ServerGetProviderUsageSnapshotResult | undefined;
    enabled?: boolean | undefined;
  } = {},
): ProviderUsageMenuModel {
  const { i18n } = useLingui();
  const { settings } = useAppSettings();
  const threads = useStore(selectAccountRateLimitThreads);
  const usageSummary = useProviderUsageSummary({
    provider,
    instanceId: input.instanceId,
    threads,
    codexHomePath: settings.codexHomePath || null,
    providerSnapshot: input.providerSnapshot,
    fetchOpenUsageData: false,
    enabled: input.enabled,
  });

  const model = buildProviderUsageMenuModel({
    provider,
    providerSnapshot: input.providerSnapshot,
    usageSummary,
  });
  return {
    ...model,
    menuTitle: i18n._("{provider} usage", { provider: PROVIDER_DISPLAY_NAMES[provider] }),
  };
}

export function ProviderUsageMenuPopup({
  provider,
  model,
  align: alignProp,
  showUsageLines = false,
  children,
}: {
  provider: ProviderKind;
  model: ProviderUsageMenuModel;
  align?: "start" | "end";
  showUsageLines?: boolean;
  children: ReactNode;
}) {
  const align = alignProp ?? "end";
  return (
    <Menu modal={false}>
      {children}
      <ComposerPickerMenuPopup align={align} side="bottom" className="w-64 min-w-64">
        <ProviderUsagePanelContent
          provider={provider}
          rateLimits={model.rateLimits}
          usageLines={model.usageLines}
          notice={model.notice}
          emptyMessage={model.emptyMessage}
          isLoading={model.isLoading}
          resetCredits={model.resetCredits}
          resetCreditsSurface="popover"
          showUsageLines={showUsageLines}
          showTitle={false}
          className="px-2 pb-1 pt-1"
        />
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

// The header mounts with the chat, and a usage read can start a provider CLI on the server
// (Claude's /usage when its login is out of the server's reach). Starting it after the chat has
// painted keeps that process from competing with the panel's own startup.
const HEADER_USAGE_READ_DELAY_MS = 2_000;

function useDelayedStart(delayMs: number): boolean {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStarted(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);
  return started;
}

export function ProviderUsageMenuControl({ provider }: { provider: ProviderKind }) {
  const { i18n } = useLingui();
  const model = useProviderUsageMenuModel(provider, {
    enabled: useDelayedStart(HEADER_USAGE_READ_DELAY_MS),
  });

  if (!model.primaryRow) {
    return null;
  }

  return (
    <ProviderUsageMenuPopup provider={provider} model={model}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ChatHeaderButton
                  type="button"
                  tone="plain"
                  className="gap-1.5 px-2"
                  aria-label={model.menuTitle}
                />
              }
            >
              <ProviderIcon provider={provider} tone="header" className="size-3.5 shrink-0" />
              <span className="truncate font-normal">{model.primaryRow.remainingLabel}</span>
            </MenuTrigger>
          }
        />
        {/* The chip shows the tightest window; hovering names every window and when it resets. */}
        <TooltipPopup side="bottom">
          <div className="flex flex-col gap-0.5">
            <span>{model.menuTitle}</span>
            {model.rows.map((row) => {
              const text = localizeProviderUsageDisplayText(i18n, row);
              return (
                // The reset sits under its window, so a narrow panel never breaks a phrase.
                <span key={row.id} className="flex flex-col tabular-nums">
                  <span className="whitespace-nowrap opacity-80">
                    {text.label} · {text.leftText}
                  </span>
                  {text.resetText ? (
                    <span className="whitespace-nowrap opacity-60">{text.resetText}</span>
                  ) : null}
                </span>
              );
            })}
          </div>
        </TooltipPopup>
      </Tooltip>
    </ProviderUsageMenuPopup>
  );
}
