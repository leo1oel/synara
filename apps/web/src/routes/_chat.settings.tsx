// FILE: _chat.settings.tsx
// Purpose: Render the dedicated settings experience with its own section sidebar and grouped panels.
// Layer: Route screen
// Exports: Settings route component for `/settings`

import type { ProviderKind } from "@synara/contracts";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAppSettings } from "../appSettings";
import { APP_VERSION } from "../branding";
import { RouteInsetSurface } from "../components/RouteInsetSurface";
import ReleaseHistoryDialog from "../components/ReleaseHistoryDialog";
import { SidebarHeaderNavigationControls } from "../components/SidebarHeaderNavigationControls";
import {
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "../components/chat/chatHeaderControls";
import {
  CHAT_CONTENT_CARD_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "../components/chat/composerPickerStyles";
import { SettingsComputerPicker } from "../components/hosts/ComputerPicker";
import {
  AdvancedSettingsPanel,
  KeybindingsFileSettingsSection,
} from "../components/settings/AdvancedSettingsPanel";
import { AccountsSettingsPanel } from "../components/settings/accounts/AccountsSettingsPanel";
import { ComputerSettingsPanel } from "../components/settings/ComputerSettingsPanel";
import { ConnectionsSettingsPanel } from "../components/settings/ConnectionsSettingsPanel";
import {
  ArchivedSettingsPanel,
  WorktreesSettingsPanel,
} from "../components/settings/ConversationStorageSettingsPanels";
import {
  AppSnapSettingsPanel,
  NotificationsSettingsPanel,
} from "../components/settings/DesktopSettingsPanels";
import { ExternalMcpSettingsPanel } from "../components/settings/ExternalMcpSettingsPanel";
import {
  KeyboardShortcutsResetButton,
  KeyboardShortcutsSettingsPanel,
} from "../components/settings/KeyboardShortcutsSettingsPanel";
import { McpConnectorsSettingsPanel } from "../components/settings/McpConnectorsSettingsPanel";
import { ModelsSettingsPanel } from "../components/settings/ModelsSettingsPanel";
import { ProfileSettingsPanel } from "../components/settings/ProfileSettingsPanel";
import { ProvidersSettingsPanel } from "../components/settings/providers/ProvidersSettingsPanel";
import { SkillsSettingsPanel } from "../components/settings/SkillsSettingsPanel";
import { UsageSettingsPanel } from "../components/settings/UsageSettingsPanel";
import { AboutSettingsView } from "../components/settings/views/AboutSettingsView";
import { AppearanceSettingsView } from "../components/settings/views/AppearanceSettingsView";
import { ChatsSettingsView } from "../components/settings/views/ChatsSettingsView";
import { GeneralSettingsView } from "../components/settings/views/GeneralSettingsView";
import { LayoutSettingsView } from "../components/settings/views/LayoutSettingsView";
import { PrivacySettingsView } from "../components/settings/views/PrivacySettingsView";
import { UsageLimitSettingsSection } from "../components/settings/views/UsageLimitSettingsSection";
import { WorktreeDefaultsSection } from "../components/settings/views/WorktreeDefaultsSection";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useDesktopTopBarTrafficLightGutterClassName } from "../hooks/useDesktopTopBarGutter";
import { useSettingsRestoreDefaults } from "../hooks/useSettingsRestoreDefaults";
import { useTranslation } from "../i18n";
import { ACCOUNT_BILLING_ENABLED } from "../lib/accountBillingFlag";
import { useSettingsComputerRoute } from "../lib/hosts/settingsComputer";
import { readWorkspaceFrame } from "../lib/hosts/workspaceFrame";
import { ResetIcon } from "../lib/icons";
import { cn } from "../lib/utils";
import {
  isSynaraEmbedMode,
  postEmbedReadyToLattice,
  postSettingsContentHeightToLattice,
  postSettingsRevealToLattice,
  postSettingsSectionReadyToLattice,
  postSettingsWheelToLattice,
  readEmbedMode,
  readLatticeSettingsLayoutMessage,
  readLatticeSettingsSectionMessage,
} from "../embedMode";
import {
  createEmbeddedSettingsHeightReporter,
  measureEmbeddedSettingsHeight,
} from "../embeddedSettingsHeight";
import { watchEmbeddedSettingsSectionReady } from "../embeddedSettingsSectionReady";
import { listenForEmbeddedSettingsWheel } from "../lib/embeddedSettingsWheel";
import { isProviderKind } from "../providerOrdering";
import {
  normalizeSettingsSection,
  providerAccountsSectionId,
  resolveSettingsTarget,
  SETTINGS_NAV_ITEMS,
} from "../settingsNavigation";
import { SETTINGS_PAGE_BACKGROUND_CLASS_NAME } from "../settingsPanelStyles";

// ── Route screen ───────────────────────────────────────────────────────────

/** A deep link's place: a field's whole label (its name above the control), else the element. */
function settingsTargetPlace(elementId: string): HTMLElement | null {
  const element = document.getElementById(elementId);
  return element?.closest("label") ?? element;
}

function SettingsRoute() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const redirecting = useSettingsComputerRoute(normalizeSettingsSection(search.section), search);
  return redirecting ? null : <SettingsRouteView />;
}

function SettingsRouteView() {
  // The hook's t re-renders the page when the language changes; the module t does not.
  const { t } = useTranslation();
  const isEmbed = isSynaraEmbedMode();
  const isController = !readWorkspaceFrame();
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const activeSection = normalizeSettingsSection(routeSearch.section);
  const [embedUiReady, setEmbedUiReady] = useState(!isEmbed);
  // The latest section request from Lattice; every request is answered, even
  // one for the section already shown.
  const [sectionRequest, setSectionRequest] = useState<{ id: number | undefined }>({
    id: undefined,
  });
  const queryClient = useQueryClient();
  const embeddedSettingsHeightReporterRef = useRef<{
    flush: () => number | null;
    schedule: () => void;
  } | null>(null);
  const settingsTarget = typeof routeSearch.target === "string" ? routeSearch.target : null;
  const settingsProviderTarget =
    typeof routeSearch.provider === "string" && isProviderKind(routeSearch.provider)
      ? routeSearch.provider
      : null;
  const resolvedSettingsTarget = useMemo(
    () => resolveSettingsTarget(settingsTarget, settingsProviderTarget),
    [settingsProviderTarget, settingsTarget],
  );
  const settingsAccountTarget =
    activeSection === "accounts" && typeof routeSearch.account === "string"
      ? routeSearch.account
      : null;
  const activeSectionItem = SETTINGS_NAV_ITEMS.find((item) => item.id === activeSection)!;
  const navigate = useNavigate();
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const openAccount = (instanceId: string | null) => {
    void navigate({
      to: "/settings",
      search: (previous) => ({
        ...previous,
        section: "accounts",
        account: instanceId ?? undefined,
        provider: undefined,
        target: undefined,
      }),
    });
  };
  const manageAccounts = (provider: ProviderKind) => {
    void navigate({
      to: "/settings",
      search: (previous) => ({
        ...previous,
        section: "accounts",
        account: undefined,
        provider: undefined,
        target: providerAccountsSectionId(provider),
      }),
    });
  };

  const { settings, defaults, updateSettings, updateSettingsAndWait, resetSettings } =
    useAppSettings();
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);

  const { changedSettingLabels, restoreDefaults, resetEpoch } = useSettingsRestoreDefaults({
    settings,
    defaults,
    updateSettings,
    resetSettings,
  });

  const binding = { settings, defaults, updateSettings };

  // Opening or leaving an account shows its view from the top, like a new page.
  useEffect(() => {
    if (settingsTarget) return;
    contentScrollRef.current?.scrollTo({ top: 0 });
  }, [settingsAccountTarget, settingsTarget]);

  useEffect(() => {
    if (!isEmbed) return;
    const embedConfig = readEmbedMode();
    if (!embedConfig?.hostOrigin) return;
    const receiveHostMessage = (event: MessageEvent) => {
      const layout = readLatticeSettingsLayoutMessage(event, embedConfig);
      if (layout) {
        document.documentElement.toggleAttribute("data-lattice-settings-compact", layout.compact);
        return;
      }
      const message = readLatticeSettingsSectionMessage(event, embedConfig);
      if (!message || !SETTINGS_NAV_ITEMS.some((item) => item.id === message.section)) return;
      setSectionRequest({ id: message.request });
      void navigate({
        to: "/settings",
        search: { section: message.section, ...(message.target ? { target: message.target } : {}) },
        replace: true,
      });
    };
    window.addEventListener("message", receiveHostMessage);
    return () => window.removeEventListener("message", receiveHostMessage);
  }, [isEmbed, navigate]);

  useEffect(() => {
    if (!isEmbed) return;
    const embedConfig = readEmbedMode();
    if (!embedConfig?.hostOrigin) return;
    let cancelled = false;
    const settleEmbeddedUi = async () => {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fonts && typeof fonts.load === "function") {
        try {
          await Promise.all([
            fonts.load('400 12px "Inter Variable"'),
            fonts.load('600 18px "Inter Variable"'),
          ]);
        } catch {
          // A missing FontFaceSet or failed font request must not strand Settings.
        }
      }
      if (cancelled) return;
      document.documentElement.dataset.synaraSettingsReady = "true";
      setEmbedUiReady(true);
      postEmbedReadyToLattice(embedConfig);
    };
    document.documentElement.dataset.synaraSettingsReady = "false";
    void settleEmbeddedUi();
    return () => {
      cancelled = true;
      delete document.documentElement.dataset.synaraSettingsReady;
    };
  }, [isEmbed]);

  useLayoutEffect(() => {
    if (!isEmbed || !embedUiReady) return;
    const embedConfig = readEmbedMode();
    const content = document.querySelector<HTMLElement>(".synara-settings-content");
    if (!embedConfig?.hostOrigin || !content) return;
    const reporter = createEmbeddedSettingsHeightReporter({
      measure: () => measureEmbeddedSettingsHeight(content),
      publish: (height) => postSettingsContentHeightToLattice(embedConfig, height, activeSection),
    });
    embeddedSettingsHeightReporterRef.current = reporter;
    reporter.flush();

    const resizeObserver = new ResizeObserver(reporter.schedule);
    resizeObserver.observe(content);
    const mutationObserver = new MutationObserver(reporter.schedule);
    mutationObserver.observe(content, {
      attributes: true,
      attributeFilter: ["aria-expanded", "class", "data-state", "hidden", "style"],
      characterData: true,
      childList: true,
      subtree: true,
    });
    const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
    const reportAfterFonts = () => reporter.schedule();
    void fontSet?.ready.then(reportAfterFonts);
    fontSet?.addEventListener?.("loadingdone", reportAfterFonts);
    content.addEventListener("load", reporter.schedule, true);
    content.addEventListener("transitionend", reporter.schedule, true);
    window.addEventListener("resize", reporter.schedule);
    return () => {
      if (embeddedSettingsHeightReporterRef.current === reporter) {
        embeddedSettingsHeightReporterRef.current = null;
      }
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      fontSet?.removeEventListener?.("loadingdone", reportAfterFonts);
      content.removeEventListener("load", reporter.schedule, true);
      content.removeEventListener("transitionend", reporter.schedule, true);
      window.removeEventListener("resize", reporter.schedule);
      reporter.dispose();
    };
  }, [activeSection, embedUiReady, isEmbed]);

  useEffect(() => {
    // Lattice keeps this frame hidden from a section request until the section
    // answers it: switching sections otherwise showed the previous section, then
    // empty rows ("No projects are available", a Skills page without its library)
    // that filled in a moment later.
    if (!isEmbed || !embedUiReady) return;
    const embedConfig = readEmbedMode();
    if (!embedConfig?.hostOrigin) return;
    const targetElementId = resolvedSettingsTarget.elementId;
    let revealFrame: number | null = null;
    const stopWatching = watchEmbeddedSettingsSectionReady({
      queryClient,
      onReady: () => {
        postSettingsSectionReadyToLattice(embedConfig, activeSection, sectionRequest.id);
        if (!targetElementId) return;
        // A frame later, once the rows the target opened have laid out. This page has no
        // scrolling of its own, so Lattice scrolls its viewport to the place.
        revealFrame = window.requestAnimationFrame(() => {
          revealFrame = null;
          const element = settingsTargetPlace(targetElementId);
          if (!element) return;
          postSettingsRevealToLattice(embedConfig, {
            section: activeSection,
            top: element.getBoundingClientRect().top + window.scrollY,
            contentHeight: embeddedSettingsHeightReporterRef.current?.flush() ?? null,
          });
        });
      },
    });
    return () => {
      stopWatching();
      if (revealFrame !== null) window.cancelAnimationFrame(revealFrame);
    };
  }, [
    activeSection,
    embedUiReady,
    isEmbed,
    queryClient,
    resolvedSettingsTarget.elementId,
    sectionRequest,
  ]);

  useEffect(() => {
    if (!isEmbed) return;
    const embedConfig = readEmbedMode();
    if (!embedConfig) return;
    return listenForEmbeddedSettingsWheel((event) => {
      // Include the current height in the wheel message itself. Sending height
      // and wheel as separate postMessage tasks let the host clamp the first
      // gesture against the previous section's stale scroll range.
      const height = embeddedSettingsHeightReporterRef.current?.flush();
      postSettingsWheelToLattice(
        embedConfig,
        event,
        height === null || height === undefined ? undefined : { height, section: activeSection },
      );
    });
  }, [activeSection, isEmbed]);

  // Deep links and sidebar search targets all resolve to stable DOM ids in the active panel.
  useEffect(() => {
    const elementId = resolvedSettingsTarget.elementId;
    if (!elementId) return;
    const frame = window.requestAnimationFrame(() => {
      settingsTargetPlace(elementId)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, resolvedSettingsTarget.elementId]);

  // Lattice has no Synara account, so the Alto plan never shows in its panel.
  const billingEnabled = ACCOUNT_BILLING_ENABLED && !isEmbed;

  const renderRouteOwnedPanel = () => {
    switch (activeSection) {
      case "general":
        return <GeneralSettingsView {...binding} />;
      case "appearance":
        return <AppearanceSettingsView {...binding} />;
      case "layout":
        return <LayoutSettingsView {...binding} />;
      case "behavior":
        return <ChatsSettingsView {...binding} />;
      case "privacy":
        return <PrivacySettingsView />;
      case "about":
        return <AboutSettingsView onOpenReleaseHistory={() => setReleaseHistoryOpen(true)} />;
      case "worktrees":
        return isController ? (
          <div className="mb-6">
            <WorktreeDefaultsSection {...binding} />
          </div>
        ) : null;
      case "shortcuts":
        return (
          <div className="space-y-6">
            <KeyboardShortcutsSettingsPanel />
            <KeybindingsFileSettingsSection resetEpoch={resetEpoch} />
          </div>
        );
      case "profile":
        return <ProfileSettingsPanel />;
      case "skills":
        return <SkillsSettingsPanel />;
      case "usage":
        // The plan lives with usage ("Usage and billing"), never above the profile.
        // Keyed by target so a plan deep link reopens the Billing tab.
        return (
          <UsageSettingsPanel
            key={settingsTarget ?? ""}
            billingEnabled={billingEnabled && isController}
            target={settingsTarget}
            // Lattice's Agent page carries usage-limit recovery; its Usage page stays quota only.
            overviewExtra={isEmbed ? undefined : <UsageLimitSettingsSection {...binding} />}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
        SETTINGS_PAGE_BACKGROUND_CLASS_NAME,
        CHAT_CONTENT_CARD_CLASS_NAME,
      )}
    >
      <RouteInsetSurface surfaceClassName={SETTINGS_PAGE_BACKGROUND_CLASS_NAME}>
        {/* Companion sidebar trigger so settings is reachable-and-exitable even when the
          sidebar is collapsed (web/mobile have no global Back arrow). Pinned to the
          card's top-left — at the same header height + traffic-light gutter as the
          chat and route headers — so the collapsed-state toggle sits by the traffic
          lights instead of floating in the centered settings body. It renders nothing
          while the sidebar is open (SidebarHeaderNavigationControls returns null), so it
          adds no navigation chrome in the common (open) state and never shifts the centered
          content (hence absolute, not a layout-occupying header row). The strip stays a
          drag-region so the Windows frameless window can be moved by its top edge; the
          caption buttons themselves are a separate fixed cluster (see root route). */}
        {!isEmbed ? (
          <div
            className={cn(
              "drag-region absolute inset-x-0 top-0 z-10 flex items-center",
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              CHAT_SURFACE_HEADER_HEIGHT_CLASS,
              desktopTopBarTrafficLightGutterClassName,
            )}
          >
            <div className="pointer-events-auto">
              <SidebarHeaderNavigationControls />
            </div>
          </div>
        ) : null}
        <div className="synara-settings-shell flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <div ref={contentScrollRef} className="synara-settings-scroll flex-1 overflow-y-auto">
            <div
              className={cn(
                "synara-settings-content",
                "mx-auto w-full px-6 py-8",
                activeSection === "connectors" || activeSection === "usage"
                  ? "max-w-4xl"
                  : activeSection === "profile"
                    ? "max-w-3xl"
                    : "max-w-2xl",
              )}
            >
              <SettingsComputerPicker section={activeSection} />
              {activeSection !== "profile" ? (
                <div className="synara-settings-heading mb-8 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-xl font-medium tracking-tight text-foreground">
                      {t(activeSectionItem.label)}
                      {activeSectionItem.badge && !isEmbed ? (
                        <Badge
                          variant="outline"
                          className="rounded-full px-2 font-normal tracking-normal text-muted-foreground"
                        >
                          {t(activeSectionItem.badge)}
                        </Badge>
                      ) : null}
                    </h1>
                    <p className="mt-1.5 text-ui leading-relaxed text-muted-foreground">
                      {t(activeSectionItem.description)}
                    </p>
                  </div>
                  {isEmbed ? null : activeSection === "shortcuts" ? (
                    <KeyboardShortcutsResetButton />
                  ) : isController ? (
                    <Button
                      size="xs"
                      variant="outline"
                      className="shrink-0"
                      disabled={changedSettingLabels.length === 0}
                      onClick={() => void restoreDefaults()}
                    >
                      <ResetIcon className="size-3.5" />
                      {t("settings:advanced_restoreDefaults")}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {renderRouteOwnedPanel()}
              {/* These workflow owners stay mounted so drafts, request guards, and pending
                  mutations retain route lifetime while inactive panels render no DOM. */}
              <div className="contents">
                <NotificationsSettingsPanel
                  active={activeSection === "notifications"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                />
                <AppSnapSettingsPanel
                  active={activeSection === "appsnap"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                />
                <ComputerSettingsPanel
                  active={activeSection === "computer"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                />
                <WorktreesSettingsPanel active={activeSection === "worktrees"} />
                <ArchivedSettingsPanel active={activeSection === "archived"} />
                {/* Models are folded into the Agent page; only Lattice's embed shows them, above it. */}
                <ModelsSettingsPanel
                  active={isEmbed && activeSection === "providers"}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                  resetEpoch={resetEpoch}
                />
                <AccountsSettingsPanel
                  active={activeSection === "accounts"}
                  accountId={settingsAccountTarget}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                  updateSettingsAndWait={updateSettingsAndWait}
                  onOpenAccount={openAccount}
                />
                <ProvidersSettingsPanel
                  active={activeSection === "providers"}
                  providerTarget={settingsProviderTarget}
                  providerTargets={resolvedSettingsTarget.openProviders}
                  settings={settings}
                  defaults={defaults}
                  updateSettings={updateSettings}
                  updateSettingsAndWait={updateSettingsAndWait}
                  resetEpoch={resetEpoch}
                  onManageAccounts={manageAccounts}
                />
                <McpConnectorsSettingsPanel active={activeSection === "connectors"} />
                <ExternalMcpSettingsPanel active={activeSection === "integrations"} />
                <ConnectionsSettingsPanel
                  active={activeSection === "connections"}
                  billingEnabled={billingEnabled}
                />
                <AdvancedSettingsPanel
                  active={activeSection === "advanced"}
                  resetEpoch={resetEpoch}
                />
              </div>
            </div>
          </div>
        </div>
        {/* Mounted at the route level (outside the scrollable panel) so the
          dialog portal can overlay the entire settings view without being
          clipped by the content wrapper's overflow. */}
        <ReleaseHistoryDialog
          open={releaseHistoryOpen}
          onOpenChange={setReleaseHistoryOpen}
          defaultExpandedVersion={APP_VERSION}
        />
      </RouteInsetSurface>
    </div>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRoute,
});
