import {
  ProjectId,
  type ExternalMcpCapability,
  type ExternalMcpCreateIntegrationResult,
} from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react";

import { Button } from "~/components/ui/button";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn, getNavigatorPlatform } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import {
  buildExternalMcpClientConfiguration,
  buildExternalMcpExamplePrompt,
  buildExternalMcpSetupPrompt,
  describeExternalMcpPermissions,
  describeExternalMcpProjects,
  externalMcpSetupAction,
} from "./externalMcpSetup";
import { SettingsListRow, SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

const INTEGRATIONS_QUERY_KEY = ["server", "externalMcpIntegrations"] as const;
const PROJECTS_QUERY_KEY = ["orchestration", "externalMcpProjects"] as const;
const CORE_CAPABILITIES: ReadonlyArray<ExternalMcpCapability> = [
  "projects:read",
  "tasks:create",
  "tasks:wait",
  "tasks:read",
];

function dateMillis(value: string): number {
  return Date.parse(value);
}

function formatDate(value: string | null, locale: string, neverLabel: string): string {
  if (!value) return neverLabel;
  const milliseconds = dateMillis(value);
  return Number.isNaN(milliseconds)
    ? String(value)
    : new Date(milliseconds).toLocaleString(locale);
}

export function ExternalMcpSettingsPanel(props: { active: boolean }) {
  const { i18n } = useLingui();
  const queryClient = useQueryClient();
  const [name, setName] = useState<string>(() => i18n._("Coding agent"));
  const [allProjects, setAllProjects] = useState(true);
  const [selectedProjects, setSelectedProjects] = useState<ReadonlySet<string>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [revokedOpen, setRevokedOpen] = useState(false);
  const [allowProjectRead, setAllowProjectRead] = useState(false);
  const [allowLocal, setAllowLocal] = useState(false);
  const [allowFullAccess, setAllowFullAccess] = useState(false);
  const [setup, setSetup] = useState<ExternalMcpCreateIntegrationResult | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const displayLocale = i18n.locale === "zh-CN" ? "zh-CN" : "en";
  const neverLabel = i18n._("Never");

  const copyWithToast = (value: string, title: string): void => {
    void copyTextToClipboard(value).then(
      () => toastManager.add({ type: "success", title }),
      (error: unknown) =>
        toastManager.add({
          type: "error",
          title: i18n._("Could not copy"),
          description: error instanceof Error ? error.message : i18n._("Clipboard access failed."),
        }),
    );
  };

  useEffect(() => {
    if (!props.active) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [props.active]);

  const integrationsQuery = useQuery({
    queryKey: INTEGRATIONS_QUERY_KEY,
    queryFn: () => ensureNativeApi().server.listExternalMcpIntegrations(),
    enabled: props.active,
    staleTime: 5_000,
    refetchInterval: setup ? 2_000 : false,
  });
  const projectsQuery = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => ensureNativeApi().orchestration.getShellSnapshot(),
    enabled: props.active,
    staleTime: 5_000,
  });
  const capabilities = useMemo(() => {
    const next = [...CORE_CAPABILITIES];
    if (allowProjectRead) next.push("tasks:read-project");
    if (allowLocal) next.push("runtime:local");
    if (allowFullAccess) next.push("runtime:full-access");
    return next;
  }, [allowFullAccess, allowLocal, allowProjectRead]);

  const createMutation = useMutation({
    mutationFn: () =>
      ensureNativeApi().server.createExternalMcpIntegration({
        name: name.trim(),
        projectScope: allProjects ? "all" : "selected",
        ...(allProjects
          ? {}
          : {
              projectIds: [...selectedProjects].map((projectId) => ProjectId.makeUnsafe(projectId)),
            }),
        capabilities,
        expiresInDays: 30,
      }),
    onSuccess: (result) => {
      setManualOpen(false);
      setSetup(result);
      void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_QUERY_KEY });
      toastManager.add({
        type: "success",
        title: i18n._("Connection ready"),
        description: i18n._(
          "Give your agent the setup prompt before the one-time code expires.",
        ),
      });
    },
    onError: (error: unknown) =>
      toastManager.add({
        type: "error",
        title: i18n._("Could not create connection"),
        description:
          error instanceof Error ? error.message : i18n._("External MCP setup failed."),
      }),
  });

  const revokeMutation = useMutation({
    mutationFn: (integrationId: string) =>
      ensureNativeApi().server.revokeExternalMcpIntegration({ integrationId }),
    onSuccess: (_result, integrationId) => {
      setManualOpen(false);
      setRevokedOpen(false);
      setSetup((current) =>
        current?.integration.integrationId === integrationId ? null : current,
      );
      void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_QUERY_KEY });
      toastManager.add({
        type: "success",
        title: i18n._("Connection revoked"),
        description: i18n._("Its credential stops working immediately."),
      });
    },
    onError: (error: unknown) =>
      toastManager.add({
        type: "error",
        title: i18n._("Could not revoke connection"),
        description: error instanceof Error ? error.message : i18n._("Revocation failed."),
      }),
  });

  const refreshPairingMutation = useMutation({
    mutationFn: (integrationId: string) =>
      ensureNativeApi().server.refreshExternalMcpPairing({ integrationId }),
    onSuccess: (result) => {
      setSetup(result);
      void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_QUERY_KEY });
      toastManager.add({
        type: "success",
        title: i18n._("New pairing code ready"),
        description: i18n._(
          "Copy the refreshed setup prompt. The new one-time code lasts 10 minutes.",
        ),
      });
    },
    onError: (error: unknown) =>
      toastManager.add({
        type: "error",
        title: i18n._("Could not resume pairing"),
        description:
          error instanceof Error ? error.message : i18n._("Pairing refresh failed."),
      }),
  });

  const continuePairedSetup = (integration: NonNullable<typeof integrationsQuery.data>[number]) => {
    setManualOpen(false);
    setSetup({
      integration,
      pairingCode: "already-paired",
      pairingExpiresAt: integration.createdAt,
      setupCommand: i18n._("Pairing already completed"),
      stdio: integration.stdio,
    });
  };

  const closeSetup = () => {
    setManualOpen(false);
    setSetup(null);
  };

  const setupIntegration = setup
    ? (integrationsQuery.data?.find(
        (integration) => integration.integrationId === setup.integration.integrationId,
      ) ?? setup.integration)
    : null;

  if (!props.active) return null;

  const projects = projectsQuery.data?.projects ?? [];
  const canCreate =
    name.trim().length > 0 &&
    (allProjects || selectedProjects.size > 0) &&
    !createMutation.isPending;
  const paired = setupIntegration?.pairedAt != null;
  const connected = paired && setupIntegration?.lastUsedAt != null;
  const revoked = setupIntegration?.revokedAt != null;
  const integrationExpired = setupIntegration
    ? dateMillis(setupIntegration.expiresAt) <= nowMs
    : false;
  const pairingExpired = setup ? dateMillis(setup.pairingExpiresAt) <= nowMs : false;
  const setupUnavailable = revoked || integrationExpired || (!paired && pairingExpired);
  const setupAction = externalMcpSetupAction({
    revoked,
    integrationExpired,
    paired,
    pairingExpired,
  });
  const setupStatus = revoked
    ? i18n._("Revoked")
    : integrationExpired
      ? i18n._("Expired")
      : connected
        ? i18n._("Connected")
        : paired
          ? i18n._("Paired — waiting for first use")
          : pairingExpired
            ? i18n._("Pairing code expired")
            : i18n._("Waiting for pairing");
  const platform = getNavigatorPlatform();
  const setupPrompt = setup
    ? buildExternalMcpSetupPrompt({
        setupCommand: paired ? null : setup.setupCommand,
        stdio: setup.stdio,
        platform,
        locale: displayLocale,
      })
    : null;
  const manualConfiguration = setup
    ? buildExternalMcpClientConfiguration("other", setup.stdio, platform, displayLocale)
    : null;
  const examplePrompt = setup
    ? buildExternalMcpExamplePrompt(
        setup.integration.projectScope === "all"
          ? null
          : (setup.integration.allowedProjects[0]?.title ?? null),
        displayLocale,
      )
    : null;
  const integrations = integrationsQuery.data ?? [];
  const currentIntegrations = integrations.filter((integration) => integration.revokedAt === null);
  const revokedIntegrations = integrations.filter((integration) => integration.revokedAt !== null);
  const renderIntegrationRows = (items: typeof integrations) =>
    items.map((integration) => {
      const active =
        integration.revokedAt === null && dateMillis(integration.expiresAt) > nowMs;
      const status = active
        ? integration.lastUsedAt
          ? i18n._("Connected")
          : integration.pairedAt
            ? i18n._("Paired — not used yet")
            : i18n._("Waiting for pairing")
        : integration.revokedAt
          ? i18n._("Revoked")
          : i18n._("Expired");
      return (
        <SettingsListRow
          key={integration.integrationId}
          align="start"
          title={integration.name}
          description={
            <div className="space-y-1">
              <div>{status}</div>
              <div>
                {i18n._("Projects: {projects}", {
                  projects: describeExternalMcpProjects(integration, displayLocale),
                })}
              </div>
              <div>
                {i18n._("Permissions: {permissions}", {
                  permissions: describeExternalMcpPermissions(
                    integration.capabilities,
                    displayLocale,
                  ),
                })}
              </div>
              <div>
                {i18n._("Created {created} · Last used {lastUsed} · Expires {expires}", {
                  created: formatDate(integration.createdAt, i18n.locale, neverLabel),
                  lastUsed: formatDate(integration.lastUsedAt, i18n.locale, neverLabel),
                  expires: formatDate(integration.expiresAt, i18n.locale, neverLabel),
                })}
              </div>
            </div>
          }
          actions={
            active ? (
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={refreshPairingMutation.isPending}
                  onClick={() => {
                    if (integration.pairedAt) continuePairedSetup(integration);
                    else refreshPairingMutation.mutate(integration.integrationId);
                  }}
                >
                  {integration.pairedAt
                    ? i18n._("Continue setup")
                    : i18n._("Resume pairing")}
                </Button>
                <Button
                  size="xs"
                  variant="destructive-outline"
                  disabled={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate(integration.integrationId)}
                >
                  {i18n._("Revoke")}
                </Button>
              </div>
            ) : null
          }
        />
      );
    });

  return (
    <div className="space-y-6">
      {!setup ? (
        <SettingsSection title={i18n._("Connect a coding agent")}>
          <SettingsRow
            title={i18n._("Name")}
            description={i18n._(
              "How this connection appears in Lattice. Works with Codex, Claude, and any other MCP-capable agent.",
            )}
            control={
              <Input
                className="w-full sm:w-64"
                value={name}
                maxLength={120}
                placeholder={i18n._("Coding agent")}
                onChange={(event) => setName(event.target.value)}
              />
            }
          />
          <SettingsRow
            title={i18n._("Access all Lattice projects")}
            description={i18n._("The agent can discover and work in every project, including ones you add later. Turn off to pick specific projects.")}
            control={<Switch checked={allProjects} onCheckedChange={setAllProjects} />}
          >
            <DisclosureRegion open={!allProjects} contentClassName="mt-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {projects.map((project) => {
                  const checked = selectedProjects.has(project.id);
                  return (
                    <label
                      key={project.id}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs transition-colors",
                        checked ? "border-foreground/30 bg-muted/70" : "border-border/70",
                      )}
                    >
                      <span className="min-w-0 truncate">{project.title}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedProjects((current) => {
                            const next = new Set(current);
                            if (checked) next.delete(project.id);
                            else next.add(project.id);
                            return next;
                          })
                        }
                      />
                    </label>
                  );
                })}
                {projects.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {i18n._("No projects are available.")}
                  </span>
                ) : null}
              </div>
            </DisclosureRegion>
          </SettingsRow>
          <SettingsRow
            title={i18n._("Advanced permissions")}
            description={i18n._(
              "Optional access for existing tasks, shared checkouts, or execution without approvals. The safe defaults are recommended.",
            )}
            control={
              <Button
                size="xs"
                variant="ghost"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((current) => !current)}
              >
                {i18n._("Review")}
                <DisclosureChevron open={advancedOpen} className="ml-1 size-3.5" />
              </Button>
            }
          >
            <DisclosureRegion
              open={advancedOpen}
              className="[overflow-anchor:none]"
              contentClassName="mt-3 space-y-4 border-t border-border/70 pt-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-medium">
                    {i18n._("Read other project tasks")}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {i18n._(
                      "Without this permission, the agent can read only tasks it creates.",
                    )}
                  </div>
                </div>
                <Switch
                  checked={allowProjectRead}
                  onCheckedChange={setAllowProjectRead}
                  aria-label={i18n._("Read other project tasks")}
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-medium">
                    {i18n._("Use the shared local checkout")}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {i18n._(
                      "High impact. Tasks may modify the checkout you are actively using instead of an isolated worktree.",
                    )}
                  </div>
                </div>
                <Switch
                  checked={allowLocal}
                  onCheckedChange={setAllowLocal}
                  aria-label={i18n._("Use the shared local checkout")}
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-medium">
                    {i18n._("Run without approval prompts")}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {i18n._(
                      "High impact. The external agent may start full-access execution without asking you to approve tool actions.",
                    )}
                  </div>
                </div>
                <Switch
                  checked={allowFullAccess}
                  onCheckedChange={setAllowFullAccess}
                  aria-label={i18n._("Run without approval prompts")}
                />
              </div>
            </DisclosureRegion>
          </SettingsRow>
          <SettingsRow
            title={i18n._("Create connection")}
            description={i18n._(
              "The connection lasts 30 days and can be revoked at any time. The next screen gives you one prompt to paste into your agent.",
            )}
            control={
              <Button size="sm" disabled={!canCreate} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? i18n._("Creating...") : i18n._("Create connection")}
              </Button>
            }
          />
        </SettingsSection>
      ) : null}

      {setup && setupIntegration && setupPrompt && manualConfiguration && examplePrompt ? (
        <SettingsSection title={i18n._("Connect {name}", { name: setupIntegration.name })}>
          <SettingsRow
            title={
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 rounded-full",
                    setupUnavailable
                      ? "bg-destructive"
                      : connected
                        ? "bg-green-500"
                        : "bg-amber-500",
                  )}
                />
                {setupStatus}
              </span>
            }
            description={
              revoked
                ? i18n._("This connection has been revoked and can no longer access Lattice.")
                : integrationExpired
                  ? i18n._("This connection has expired and can no longer access Lattice.")
                  : connected
                    ? i18n._("Lattice received a request from this agent. Setup is complete.")
                    : paired
                      ? i18n._(
                          "The private credential is stored locally. If the agent has not registered Lattice yet, give it the setup prompt below.",
                        )
                      : pairingExpired
                        ? i18n._(
                            "The one-time pairing code was not used in time. Resume pairing to issue a fresh code without replacing this connection.",
                          )
                        : i18n._(
                            "Paste the setup prompt into your agent. This page updates automatically when pairing succeeds.",
                          )
            }
            status={
              connected
                ? i18n._("Last connected {date}.", {
                    date: formatDate(setupIntegration.lastUsedAt, i18n.locale, neverLabel),
                  })
                : i18n._("Connection expires {date}.", {
                    date: formatDate(setupIntegration.expiresAt, i18n.locale, neverLabel),
                  })
            }
            control={
              setupAction === "revoke" ? (
                <Button
                  size="xs"
                  variant="destructive-outline"
                  disabled={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate(setupIntegration.integrationId)}
                >
                  {i18n._("Revoke and start over")}
                </Button>
              ) : setupAction === "resume-pairing" ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={refreshPairingMutation.isPending}
                    onClick={() => refreshPairingMutation.mutate(setupIntegration.integrationId)}
                  >
                    {refreshPairingMutation.isPending
                      ? i18n._("Resuming...")
                      : i18n._("Resume pairing")}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={closeSetup}>
                    {i18n._("Back")}
                  </Button>
                </div>
              ) : setupAction === "done" ? (
                <Button size="xs" variant="ghost" onClick={closeSetup}>
                  {i18n._("Done")}
                </Button>
              ) : null
            }
          />
          <SettingsRow
            title={i18n._("1. Give your agent this prompt")}
            description={i18n._(
              "Copy the prompt and paste it into the agent you want to connect (Codex, Claude Code, or any MCP-capable app). The agent pairs this computer, registers Lattice in its own configuration, and verifies the connection by itself.",
            )}
            status={
              paired
                ? i18n._("Paired. The prompt now covers only registration and verification.")
                : i18n._("Pairing code expires {date}.", {
                    date: formatDate(setup.pairingExpiresAt, i18n.locale, neverLabel),
                  })
            }
            control={
              <Button
                size="xs"
                variant="outline"
                disabled={setupUnavailable}
                onClick={() => copyWithToast(setupPrompt, i18n._("Setup prompt copied"))}
              >
                {i18n._("Copy setup prompt")}
              </Button>
            }
          >
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-muted/30 p-3 text-[11px] leading-relaxed">
              {setupPrompt}
            </pre>
          </SettingsRow>
          <SettingsRow
            title={i18n._("Set up by hand instead")}
            description={i18n._(
              "For apps without a terminal or chat, like Claude Desktop: run the pairing command in Terminal, then add the JSON below to the app's MCP configuration.",
            )}
            control={
              <Button
                size="xs"
                variant="ghost"
                aria-expanded={manualOpen}
                onClick={() => setManualOpen((current) => !current)}
              >
                {i18n._("Show")}
                <DisclosureChevron open={manualOpen} className="ml-1 size-3.5" />
              </Button>
            }
          >
            <DisclosureRegion
              open={manualOpen}
              contentClassName="mt-3 space-y-3 border-t border-border/70 pt-3"
            >
              {!paired ? (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium">
                      {i18n._("Pairing command (run in Terminal)")}
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={setupUnavailable}
                      onClick={() =>
                        copyWithToast(setup.setupCommand, i18n._("Pairing command copied"))
                      }
                    >
                      {i18n._("Copy")}
                    </Button>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-border/70 bg-muted/30 p-3 text-[11px] leading-relaxed">
                    {setup.setupCommand}
                  </pre>
                </div>
              ) : null}
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium">
                    {i18n._("MCP configuration (JSON)")}
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={revoked || integrationExpired}
                    onClick={() =>
                      copyWithToast(manualConfiguration.value, i18n._("Configuration copied"))
                    }
                  >
                    {i18n._("Copy")}
                  </Button>
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-muted/30 p-3 text-[11px] leading-relaxed">
                  {manualConfiguration.value}
                </pre>
              </div>
            </DisclosureRegion>
          </SettingsRow>
          <SettingsRow
            title={i18n._("2. Try it")}
            description={i18n._(
              "Open a new chat in the agent you just connected and send this editable example. You never need to copy project IDs, model IDs, or request IDs yourself.",
            )}
            status={
              connected
                ? i18n._("Connection verified by Lattice.")
                : i18n._(
                    "Lattice will show Connected after the agent makes its first request.",
                  )
            }
            control={
              <Button
                size="xs"
                variant="outline"
                disabled={!paired || revoked || integrationExpired}
                onClick={() => copyWithToast(examplePrompt, i18n._("Example prompt copied"))}
              >
                {i18n._("Copy example prompt")}
              </Button>
            }
          >
            {paired ? (
              <div className="mt-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                {examplePrompt}
              </div>
            ) : null}
          </SettingsRow>
        </SettingsSection>
      ) : null}

      <SettingsSection title={i18n._("Connected agents")}>
        {integrationsQuery.isLoading ? (
          <SettingsListRow title={i18n._("Loading connections...")} />
        ) : currentIntegrations.length ? (
          renderIntegrationRows(currentIntegrations)
        ) : (
          <SettingsListRow
            title={i18n._("No connected agents")}
            description={i18n._(
              "Connect Codex, Claude, or another local MCP agent to create and follow Lattice tasks.",
            )}
          />
        )}
        {revokedIntegrations.length > 0 ? (
          <>
            <SettingsListRow
              title={i18n._("Revoked connections ({count})", {
                count: revokedIntegrations.length,
              })}
              description={i18n._(
                "Revoked connections are hidden by default. Their credentials no longer work.",
              )}
              actions={
                <Button
                  size="xs"
                  variant="ghost"
                  aria-expanded={revokedOpen}
                  onClick={() => setRevokedOpen((current) => !current)}
                >
                  {revokedOpen ? i18n._("Hide") : i18n._("Show")}
                  <DisclosureChevron open={revokedOpen} className="ml-1 size-3.5" />
                </Button>
              }
            />
            <DisclosureRegion open={revokedOpen} contentClassName="divide-y divide-border/70">
              {renderIntegrationRows(revokedIntegrations)}
            </DisclosureRegion>
          </>
        ) : null}
      </SettingsSection>
    </div>
  );
}
