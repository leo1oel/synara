import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  AutomationCancelRunInput,
  AutomationCancelRunResult,
  AutomationArchiveRunInput,
  AutomationCreateInput,
  AutomationDefinition,
  AutomationDeleteInput,
  AutomationGetMemoryInput,
  AutomationListInput,
  AutomationListResult,
  AutomationMarkRunReadInput,
  AutomationMemory,
  AutomationResolveProposalInput,
  AutomationResolveProposalResult,
  AutomationRunActionResult,
  AutomationRunNowInput,
  AutomationRunNowResult,
  AutomationStreamEvent,
  AutomationUpdateInput,
} from "./automation";
import { OpenInEditorInput } from "./editor";
import {
  ExternalMcpCreateIntegrationInput,
  ExternalMcpCreateIntegrationResult,
  ExternalMcpIntegration,
  ExternalMcpRefreshPairingInput,
  ExternalMcpRevokeIntegrationInput,
} from "./externalMcp";
import { FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem";
import {
  GitHubProjectProvisionInput,
  GitHubProjectProvisionProgressEvent,
} from "./githubProjectProvisioning";
import { StudioListThreadOutputsInput, StudioListThreadOutputsResult } from "./studio";
import {
  GitCheckoutInput,
  GitActionProgressEvent,
  GitCreateBranchInput,
  GitCreateDetachedWorktreeInput,
  GitCreateDetachedWorktreeResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitHubRepositoryInput,
  GitHubRepositoryResult,
  GitHandoffThreadInput,
  GitHandoffThreadResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullRequestSnapshotInput,
  GitPullRequestSnapshotResult,
  GitPullResult,
  GitReadWorkingTreeDiffInput,
  GitReadWorkingTreeDiffResult,
  GitWorkingTreeDiffStatsResult,
  GitRemoveIndexLockInput,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitStageFilesInput,
  GitStageFilesResult,
  GitStashAndCheckoutInput,
  GitStashDropInput,
  GitStashInfoInput,
  GitStashInfoResult,
  GitStatusInput,
  GitStatusResult,
  GitSummarizeDiffInput,
  GitSummarizeDiffResult,
  GitUnstageFilesInput,
  GitUnstageFilesResult,
} from "./git";
import {
  PullRequestActionInput,
  PullRequestCommentInput,
  PullRequestActionResult,
  PullRequestDetail,
  PullRequestDetailInput,
  PullRequestDiffResult,
  PullRequestReviewRequestCountInput,
  PullRequestReviewRequestCountResult,
  PullRequestSetPinnedInput,
  PullRequestSetPinnedResult,
  PullRequestsListInput,
  PullRequestsListResult,
  PullRequestsUnavailableError,
} from "./pullRequests";
import { KeybindingRule } from "./keybindings";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationEvent,
  OrchestrationImportThreadInput,
  OrchestrationImportThreadResult,
  OrchestrationRpcSchemas,
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "./orchestration";
import { ProviderCompactThreadInput } from "./provider";
import {
  ProviderGetComposerCapabilitiesInput,
  ProviderComposerCapabilities,
  ProviderListAgentsInput,
  ProviderListAgentsResult,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListModelsInput,
  ProviderListModelsResult,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
  ProviderListSkillsInput,
  ProviderListSkillsResult,
  ProviderSkillsCatalogInput,
  ProviderSkillsCatalogResult,
  ProviderReadPluginInput,
  ProviderReadPluginResult,
} from "./providerDiscovery";
import {
  ProjectCreateLocalFilePreviewGrantInput,
  ProjectCreateLocalFilePreviewGrantResult,
  ProjectDevServerEvent,
  ProjectDiscoverScriptsInput,
  ProjectDiscoverScriptsResult,
  ProjectListDevServersResult,
  ProjectListDirectoriesInput,
  ProjectListDirectoriesResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectResolveOutOfRootFileReferenceInput,
  ProjectResolveOutOfRootFileReferenceResult,
  ProjectRunDevServerInput,
  ProjectRunDevServerResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectSearchLocalEntriesInput,
  ProjectSearchLocalEntriesResult,
  ProjectStopDevServerInput,
  ProjectStopDevServerResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import {
  ServerConfig,
  ServerConfigStreamEvent,
  ServerDiagnosticsResult,
  ServerGenerateAutomationIntentInput,
  ServerGenerateAutomationIntentResult,
  ServerGenerateThreadRecapInput,
  ServerGenerateThreadRecapResult,
  ServerGetEnvironmentResult,
  ServerGetProviderUsageSnapshotInput,
  ServerGetProviderUsageSnapshotResult,
  ServerListProviderUsageInput,
  ServerListProviderUsageResult,
  ServerLifecycleStreamEvent,
  ServerGetSettingsResult,
  ServerListLocalServersResult,
  ServerListWorktreesResult,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerProviderUpdateResult,
  ServerRefreshProvidersResult,
  ServerStopLocalServerInput,
  ServerStopLocalServerResult,
  ServerUpdateSettingsInput,
  ServerUpdateSettingsResult,
  ServerUpsertKeybindingResult,
  ServerVoicePrewarmInput,
  ServerVoicePrewarmResult,
  ServerVoiceTranscriptionInput,
  ServerVoiceTranscriptionResult,
} from "./server";
import {
  TerminalAckOutputInput,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import {
  StatsGetProfileStatsInput,
  StatsGetProfileStatsResult,
  StatsGetProfileTokenStatsInput,
  StatsGetProfileTokenStatsResult,
} from "./stats";
import { WS_METHODS } from "./ws";
import {
  WS_BOOTSTRAP_METHOD,
  WsBootstrapNegotiateInput,
  WsBootstrapNegotiateResult,
  WsCompatibilityError,
} from "./wsCompatibility";

export class WsRpcError extends Schema.TaggedErrorClass<WsRpcError>()("WsRpcError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
  code: Schema.optional(Schema.String),
  retryable: Schema.optional(Schema.Boolean),
  retryAfterMs: Schema.optional(Schema.Number),
}) {}

// Every WS endpoint below carries WsRpcError unless it declares its own error schema.
const wsRpc = <
  const Tag extends string,
  Payload extends Schema.Struct.Fields | Schema.Top = Schema.Void,
  Success extends Schema.Top = Schema.Void,
  Error extends Schema.Top = typeof WsRpcError,
  const Stream extends boolean = false,
>(
  tag: Tag,
  options: {
    readonly payload?: Payload;
    readonly success?: Success;
    readonly error?: Error;
    readonly stream?: Stream;
  },
) => Rpc.make(tag, { ...options, error: options.error ?? WsRpcError });

export const WsBootstrapNegotiateRpc = wsRpc(WS_BOOTSTRAP_METHOD, {
  payload: WsBootstrapNegotiateInput,
  success: WsBootstrapNegotiateResult,
  error: WsCompatibilityError,
});

export const WsOrchestrationDispatchCommandRpc = wsRpc(ORCHESTRATION_WS_METHODS.dispatchCommand, {
  payload: ClientOrchestrationCommand,
  success: OrchestrationRpcSchemas.dispatchCommand.output,
});

export const WsOrchestrationImportThreadRpc = wsRpc(ORCHESTRATION_WS_METHODS.importThread, {
  payload: OrchestrationImportThreadInput,
  success: OrchestrationImportThreadResult,
});

export const WsOrchestrationGetSnapshotRpc = wsRpc(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationRpcSchemas.getSnapshot.input,
  success: OrchestrationRpcSchemas.getSnapshot.output,
});

export const WsOrchestrationGetShellSnapshotRpc = wsRpc(ORCHESTRATION_WS_METHODS.getShellSnapshot, {
  payload: OrchestrationRpcSchemas.getShellSnapshot.input,
  success: OrchestrationRpcSchemas.getShellSnapshot.output,
});

export const WsOrchestrationRepairStateRpc = wsRpc(ORCHESTRATION_WS_METHODS.repairState, {
  payload: OrchestrationRpcSchemas.repairState.input,
  success: OrchestrationRpcSchemas.repairState.output,
});

export const WsOrchestrationGetTurnDiffRpc = wsRpc(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationRpcSchemas.getTurnDiff.input,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
});

export const WsOrchestrationGetFullThreadDiffRpc = wsRpc(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationRpcSchemas.getFullThreadDiff.input,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
  },
);

export const WsOrchestrationGetThreadDetailSnapshotRpc = wsRpc(
  ORCHESTRATION_WS_METHODS.getThreadDetailSnapshot,
  {
    payload: OrchestrationRpcSchemas.getThreadDetailSnapshot.input,
    success: OrchestrationRpcSchemas.getThreadDetailSnapshot.output,
  },
);

export const WsOrchestrationReplayEventsRpc = wsRpc(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationRpcSchemas.replayEvents.input,
  success: OrchestrationRpcSchemas.replayEvents.output,
});

export const WsOrchestrationListProviderDeliveryBlockersRpc = wsRpc(
  ORCHESTRATION_WS_METHODS.listProviderDeliveryBlockers,
  {
    payload: OrchestrationRpcSchemas.listProviderDeliveryBlockers.input,
    success: OrchestrationRpcSchemas.listProviderDeliveryBlockers.output,
  },
);

export const WsOrchestrationReconcileProviderDeliveryRpc = wsRpc(
  ORCHESTRATION_WS_METHODS.reconcileProviderDelivery,
  {
    payload: OrchestrationRpcSchemas.reconcileProviderDelivery.input,
    success: OrchestrationRpcSchemas.reconcileProviderDelivery.output,
  },
);

export const WsOrchestrationSubscribeShellRpc = wsRpc(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationShellStreamItem,
  stream: true,
});

export const WsOrchestrationUnsubscribeShellRpc = wsRpc(ORCHESTRATION_WS_METHODS.unsubscribeShell, {
  payload: OrchestrationRpcSchemas.unsubscribeShell.input,
  success: Schema.Void,
});

export const WsOrchestrationSubscribeThreadRpc = wsRpc(ORCHESTRATION_WS_METHODS.subscribeThread, {
  payload: OrchestrationRpcSchemas.subscribeThread.input,
  success: OrchestrationThreadStreamItem,
  stream: true,
});

export const WsOrchestrationSubscribeDomainEventsRpc = wsRpc(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  { payload: Schema.Struct({}), success: OrchestrationEvent, stream: true },
);

export const WsOrchestrationUnsubscribeThreadRpc = wsRpc(
  ORCHESTRATION_WS_METHODS.unsubscribeThread,
  { payload: OrchestrationRpcSchemas.unsubscribeThread.input, success: Schema.Void },
);

export const WsProjectsListDirectoriesRpc = wsRpc(WS_METHODS.projectsListDirectories, {
  payload: ProjectListDirectoriesInput,
  success: ProjectListDirectoriesResult,
});

export const WsProjectsDiscoverScriptsRpc = wsRpc(WS_METHODS.projectsDiscoverScripts, {
  payload: ProjectDiscoverScriptsInput,
  success: ProjectDiscoverScriptsResult,
});

export const WsProjectsSearchEntriesRpc = wsRpc(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
});

export const WsProjectsSearchLocalEntriesRpc = wsRpc(WS_METHODS.projectsSearchLocalEntries, {
  payload: ProjectSearchLocalEntriesInput,
  success: ProjectSearchLocalEntriesResult,
});

export const WsProjectsReadFileRpc = wsRpc(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
});

export const WsProjectsResolveOutOfRootFileReferenceRpc = wsRpc(
  WS_METHODS.projectsResolveOutOfRootFileReference,
  {
    payload: ProjectResolveOutOfRootFileReferenceInput,
    success: ProjectResolveOutOfRootFileReferenceResult,
  },
);

export const WsProjectsCreateLocalFilePreviewGrantRpc = wsRpc(
  WS_METHODS.projectsCreateLocalFilePreviewGrant,
  {
    payload: ProjectCreateLocalFilePreviewGrantInput,
    success: ProjectCreateLocalFilePreviewGrantResult,
  },
);

export const WsProjectsWriteFileRpc = wsRpc(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
});

export const WsProjectsRunDevServerRpc = wsRpc(WS_METHODS.projectsRunDevServer, {
  payload: ProjectRunDevServerInput,
  success: ProjectRunDevServerResult,
});

export const WsProjectsStopDevServerRpc = wsRpc(WS_METHODS.projectsStopDevServer, {
  payload: ProjectStopDevServerInput,
  success: ProjectStopDevServerResult,
});

export const WsProjectsListDevServersRpc = wsRpc(WS_METHODS.projectsListDevServers, {
  payload: Schema.Struct({}),
  success: ProjectListDevServersResult,
});

export const WsSubscribeProjectDevServerEventsRpc = wsRpc(
  WS_METHODS.subscribeProjectDevServerEvents,
  { payload: Schema.Struct({}), success: ProjectDevServerEvent, stream: true },
);

export const WsProjectsProvisionFromGitHubRpc = wsRpc(WS_METHODS.projectsProvisionFromGitHub, {
  payload: GitHubProjectProvisionInput,
  success: GitHubProjectProvisionProgressEvent,
  stream: true,
});

export const WsStudioListThreadOutputsRpc = wsRpc(WS_METHODS.studioListThreadOutputs, {
  payload: StudioListThreadOutputsInput,
  success: StudioListThreadOutputsResult,
});

export const WsFilesystemBrowseRpc = wsRpc(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
});

export const WsShellOpenInEditorRpc = wsRpc(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  success: Schema.Void,
});

export const WsGitStatusRpc = wsRpc(WS_METHODS.gitStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
});

export const WsGitGithubRepositoryRpc = wsRpc(WS_METHODS.gitGithubRepository, {
  payload: GitHubRepositoryInput,
  success: GitHubRepositoryResult,
});

export const WsGitReadWorkingTreeDiffRpc = wsRpc(WS_METHODS.gitReadWorkingTreeDiff, {
  payload: GitReadWorkingTreeDiffInput,
  success: GitReadWorkingTreeDiffResult,
});

export const WsGitWorkingTreeDiffStatsRpc = wsRpc(WS_METHODS.gitWorkingTreeDiffStats, {
  payload: GitReadWorkingTreeDiffInput,
  success: GitWorkingTreeDiffStatsResult,
});

export const WsGitSummarizeDiffRpc = wsRpc(WS_METHODS.gitSummarizeDiff, {
  payload: GitSummarizeDiffInput,
  success: GitSummarizeDiffResult,
});

export const WsGitPullRpc = wsRpc(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
});

export const WsGitRunStackedActionRpc = wsRpc(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  stream: true,
});

export const WsGitResolvePullRequestRpc = wsRpc(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
});

export const WsGitPullRequestSnapshotRpc = wsRpc(WS_METHODS.gitPullRequestSnapshot, {
  payload: GitPullRequestSnapshotInput,
  success: GitPullRequestSnapshotResult,
});

export const WsGitPreparePullRequestThreadRpc = wsRpc(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
});

const PullRequestsRpcError = Schema.Union([PullRequestsUnavailableError, WsRpcError]);

export const WsPullRequestsListRpc = wsRpc(WS_METHODS.pullRequestsList, {
  payload: PullRequestsListInput,
  success: PullRequestsListResult,
  error: PullRequestsRpcError,
});

export const WsPullRequestsReviewRequestCountRpc = wsRpc(
  WS_METHODS.pullRequestsReviewRequestCount,
  {
    payload: PullRequestReviewRequestCountInput,
    success: PullRequestReviewRequestCountResult,
    error: PullRequestsRpcError,
  },
);

export const WsPullRequestsDetailRpc = wsRpc(WS_METHODS.pullRequestsDetail, {
  payload: PullRequestDetailInput,
  success: PullRequestDetail,
  error: PullRequestsRpcError,
});

export const WsPullRequestsDiffRpc = wsRpc(WS_METHODS.pullRequestsDiff, {
  payload: PullRequestDetailInput,
  success: PullRequestDiffResult,
  error: PullRequestsRpcError,
});

export const WsPullRequestsActionRpc = wsRpc(WS_METHODS.pullRequestsAction, {
  payload: PullRequestActionInput,
  success: PullRequestActionResult,
  error: PullRequestsRpcError,
});

// Comments reuse the action acknowledgment shape: the mutation is confirmed independently of
// the follow-up detail refetch that surfaces the new comment.
export const WsPullRequestsCommentRpc = wsRpc(WS_METHODS.pullRequestsComment, {
  payload: PullRequestCommentInput,
  success: PullRequestActionResult,
  error: PullRequestsRpcError,
});

export const WsPullRequestsSetPinnedRpc = wsRpc(WS_METHODS.pullRequestsSetPinned, {
  payload: PullRequestSetPinnedInput,
  success: PullRequestSetPinnedResult,
});

export const WsGitListBranchesRpc = wsRpc(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
});

export const WsGitCreateWorktreeRpc = wsRpc(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
});

export const WsGitCreateDetachedWorktreeRpc = wsRpc(WS_METHODS.gitCreateDetachedWorktree, {
  payload: GitCreateDetachedWorktreeInput,
  success: GitCreateDetachedWorktreeResult,
});

export const WsGitRemoveWorktreeRpc = wsRpc(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  success: Schema.Void,
});

export const WsGitCreateBranchRpc = wsRpc(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  success: Schema.Void,
});

export const WsGitCheckoutRpc = wsRpc(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  success: Schema.Void,
});

export const WsGitStashAndCheckoutRpc = wsRpc(WS_METHODS.gitStashAndCheckout, {
  payload: GitStashAndCheckoutInput,
  success: Schema.Void,
});

export const WsGitStashDropRpc = wsRpc(WS_METHODS.gitStashDrop, {
  payload: GitStashDropInput,
  success: Schema.Void,
});

export const WsGitStashInfoRpc = wsRpc(WS_METHODS.gitStashInfo, {
  payload: GitStashInfoInput,
  success: GitStashInfoResult,
});

export const WsGitRemoveIndexLockRpc = wsRpc(WS_METHODS.gitRemoveIndexLock, {
  payload: GitRemoveIndexLockInput,
  success: Schema.Void,
});

export const WsGitInitRpc = wsRpc(WS_METHODS.gitInit, {
  payload: GitInitInput,
  success: Schema.Void,
});

export const WsGitStageFilesRpc = wsRpc(WS_METHODS.gitStageFiles, {
  payload: GitStageFilesInput,
  success: GitStageFilesResult,
});

export const WsGitUnstageFilesRpc = wsRpc(WS_METHODS.gitUnstageFiles, {
  payload: GitUnstageFilesInput,
  success: GitUnstageFilesResult,
});

export const WsGitHandoffThreadRpc = wsRpc(WS_METHODS.gitHandoffThread, {
  payload: GitHandoffThreadInput,
  success: GitHandoffThreadResult,
});

export const WsTerminalOpenRpc = wsRpc(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
});

export const WsTerminalWriteRpc = wsRpc(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  success: Schema.Void,
});

export const WsTerminalAckOutputRpc = wsRpc(WS_METHODS.terminalAckOutput, {
  payload: TerminalAckOutputInput,
  success: Schema.Void,
});

export const WsTerminalResizeRpc = wsRpc(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  success: Schema.Void,
});

export const WsTerminalClearRpc = wsRpc(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  success: Schema.Void,
});

export const WsTerminalRestartRpc = wsRpc(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
});

export const WsTerminalCloseRpc = wsRpc(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  success: Schema.Void,
});

export const WsSubscribeTerminalEventsRpc = wsRpc(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  stream: true,
});

export const WsServerGetConfigRpc = wsRpc(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
});

export const WsServerGetEnvironmentRpc = wsRpc(WS_METHODS.serverGetEnvironment, {
  payload: Schema.Struct({}),
  success: ServerGetEnvironmentResult,
});

export const WsServerGetSettingsRpc = wsRpc(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerGetSettingsResult,
});

export const WsServerUpdateSettingsRpc = wsRpc(WS_METHODS.serverUpdateSettings, {
  payload: ServerUpdateSettingsInput,
  success: ServerUpdateSettingsResult,
});

export const WsServerRefreshProvidersRpc = wsRpc(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerRefreshProvidersResult,
});

export const WsServerUpdateProviderRpc = wsRpc(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdateResult,
  error: ServerProviderUpdateError,
});

export const WsServerListExternalMcpIntegrationsRpc = wsRpc(
  WS_METHODS.serverListExternalMcpIntegrations,
  { payload: Schema.Struct({}), success: Schema.Array(ExternalMcpIntegration) },
);

export const WsServerCreateExternalMcpIntegrationRpc = wsRpc(
  WS_METHODS.serverCreateExternalMcpIntegration,
  { payload: ExternalMcpCreateIntegrationInput, success: ExternalMcpCreateIntegrationResult },
);

export const WsServerRevokeExternalMcpIntegrationRpc = wsRpc(
  WS_METHODS.serverRevokeExternalMcpIntegration,
  {
    payload: ExternalMcpRevokeIntegrationInput,
    success: Schema.Struct({ revoked: Schema.Boolean }),
  },
);

export const WsServerRefreshExternalMcpPairingRpc = wsRpc(
  WS_METHODS.serverRefreshExternalMcpPairing,
  { payload: ExternalMcpRefreshPairingInput, success: ExternalMcpCreateIntegrationResult },
);

export const WsServerListWorktreesRpc = wsRpc(WS_METHODS.serverListWorktrees, {
  payload: Schema.Struct({}),
  success: ServerListWorktreesResult,
});

export const WsServerListLocalServersRpc = wsRpc(WS_METHODS.serverListLocalServers, {
  payload: Schema.Struct({}),
  success: ServerListLocalServersResult,
});

export const WsServerStopLocalServerRpc = wsRpc(WS_METHODS.serverStopLocalServer, {
  payload: ServerStopLocalServerInput,
  success: ServerStopLocalServerResult,
});

export const WsServerGetProviderUsageSnapshotRpc = wsRpc(
  WS_METHODS.serverGetProviderUsageSnapshot,
  { payload: ServerGetProviderUsageSnapshotInput, success: ServerGetProviderUsageSnapshotResult },
);

export const WsServerListProviderUsageRpc = wsRpc(WS_METHODS.serverListProviderUsage, {
  payload: ServerListProviderUsageInput,
  success: ServerListProviderUsageResult,
});

export const WsStatsGetProfileStatsRpc = wsRpc(WS_METHODS.statsGetProfileStats, {
  payload: StatsGetProfileStatsInput,
  success: StatsGetProfileStatsResult,
});

export const WsStatsGetProfileTokenStatsRpc = wsRpc(WS_METHODS.statsGetProfileTokenStats, {
  payload: StatsGetProfileTokenStatsInput,
  success: StatsGetProfileTokenStatsResult,
});

export const WsServerGetDiagnosticsRpc = wsRpc(WS_METHODS.serverGetDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerDiagnosticsResult,
});

export const WsServerPrewarmVoiceRpc = wsRpc(WS_METHODS.serverPrewarmVoice, {
  payload: ServerVoicePrewarmInput,
  success: ServerVoicePrewarmResult,
});

export const WsServerTranscribeVoiceRpc = wsRpc(WS_METHODS.serverTranscribeVoice, {
  payload: ServerVoiceTranscriptionInput,
  success: ServerVoiceTranscriptionResult,
});

export const WsServerGenerateThreadRecapRpc = wsRpc(WS_METHODS.serverGenerateThreadRecap, {
  payload: ServerGenerateThreadRecapInput,
  success: ServerGenerateThreadRecapResult,
});

export const WsServerGenerateAutomationIntentRpc = wsRpc(
  WS_METHODS.serverGenerateAutomationIntent,
  { payload: ServerGenerateAutomationIntentInput, success: ServerGenerateAutomationIntentResult },
);

export const WsServerUpsertKeybindingRpc = wsRpc(WS_METHODS.serverUpsertKeybinding, {
  payload: KeybindingRule,
  success: ServerUpsertKeybindingResult,
});

export const WsSubscribeServerLifecycleRpc = wsRpc(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

export const WsSubscribeServerConfigRpc = wsRpc(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  stream: true,
});

export const WsSubscribeServerProviderStatusesRpc = wsRpc(
  WS_METHODS.subscribeServerProviderStatuses,
  { payload: Schema.Struct({}), success: ServerRefreshProvidersResult, stream: true },
);

export const WsSubscribeServerSettingsRpc = wsRpc(WS_METHODS.subscribeServerSettings, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ settings: ServerGetSettingsResult }),
  stream: true,
});

export const WsProviderGetComposerCapabilitiesRpc = wsRpc(
  WS_METHODS.providerGetComposerCapabilities,
  { payload: ProviderGetComposerCapabilitiesInput, success: ProviderComposerCapabilities },
);

export const WsProviderCompactThreadRpc = wsRpc(WS_METHODS.providerCompactThread, {
  payload: ProviderCompactThreadInput,
  success: Schema.Void,
});

export const WsProviderListCommandsRpc = wsRpc(WS_METHODS.providerListCommands, {
  payload: ProviderListCommandsInput,
  success: ProviderListCommandsResult,
});

export const WsProviderListSkillsRpc = wsRpc(WS_METHODS.providerListSkills, {
  payload: ProviderListSkillsInput,
  success: ProviderListSkillsResult,
});

export const WsProviderListSkillsCatalogRpc = wsRpc(WS_METHODS.providerListSkillsCatalog, {
  payload: ProviderSkillsCatalogInput,
  success: ProviderSkillsCatalogResult,
});

export const WsProviderListPluginsRpc = wsRpc(WS_METHODS.providerListPlugins, {
  payload: ProviderListPluginsInput,
  success: ProviderListPluginsResult,
});

export const WsProviderReadPluginRpc = wsRpc(WS_METHODS.providerReadPlugin, {
  payload: ProviderReadPluginInput,
  success: ProviderReadPluginResult,
});

export const WsProviderListModelsRpc = wsRpc(WS_METHODS.providerListModels, {
  payload: ProviderListModelsInput,
  success: ProviderListModelsResult,
});

export const WsProviderListAgentsRpc = wsRpc(WS_METHODS.providerListAgents, {
  payload: ProviderListAgentsInput,
  success: ProviderListAgentsResult,
});

export const WsAutomationListRpc = wsRpc(WS_METHODS.automationList, {
  payload: AutomationListInput,
  success: AutomationListResult,
});

export const WsAutomationGetMemoryRpc = wsRpc(WS_METHODS.automationGetMemory, {
  payload: AutomationGetMemoryInput,
  success: Schema.NullOr(AutomationMemory),
});

export const WsAutomationCreateRpc = wsRpc(WS_METHODS.automationCreate, {
  payload: AutomationCreateInput,
  success: AutomationDefinition,
});

export const WsAutomationUpdateRpc = wsRpc(WS_METHODS.automationUpdate, {
  payload: AutomationUpdateInput,
  success: AutomationDefinition,
});

export const WsAutomationDeleteRpc = wsRpc(WS_METHODS.automationDelete, {
  payload: AutomationDeleteInput,
  success: Schema.Void,
});

export const WsAutomationRunNowRpc = wsRpc(WS_METHODS.automationRunNow, {
  payload: AutomationRunNowInput,
  success: AutomationRunNowResult,
});

export const WsAutomationCancelRunRpc = wsRpc(WS_METHODS.automationCancelRun, {
  payload: AutomationCancelRunInput,
  success: AutomationCancelRunResult,
});

export const WsAutomationMarkRunReadRpc = wsRpc(WS_METHODS.automationMarkRunRead, {
  payload: AutomationMarkRunReadInput,
  success: AutomationRunActionResult,
});

export const WsAutomationArchiveRunRpc = wsRpc(WS_METHODS.automationArchiveRun, {
  payload: AutomationArchiveRunInput,
  success: AutomationRunActionResult,
});

export const WsAutomationResolveProposalRpc = wsRpc(WS_METHODS.automationResolveProposal, {
  payload: AutomationResolveProposalInput,
  success: AutomationResolveProposalResult,
});

export const WsSubscribeAutomationEventsRpc = wsRpc(WS_METHODS.subscribeAutomationEvents, {
  payload: Schema.Struct({}),
  success: AutomationStreamEvent,
  stream: true,
});

export const WsBootstrapRpcGroup = RpcGroup.make(WsBootstrapNegotiateRpc);

export const WsFeatureRpcGroup = RpcGroup.make(
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationImportThreadRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationGetShellSnapshotRpc,
  WsOrchestrationGetThreadDetailSnapshotRpc,
  WsOrchestrationRepairStateRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationListProviderDeliveryBlockersRpc,
  WsOrchestrationReconcileProviderDeliveryRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationUnsubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsOrchestrationUnsubscribeThreadRpc,
  WsOrchestrationSubscribeDomainEventsRpc,
  WsProjectsDiscoverScriptsRpc,
  WsProjectsListDirectoriesRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsSearchLocalEntriesRpc,
  WsProjectsReadFileRpc,
  WsProjectsResolveOutOfRootFileReferenceRpc,
  WsProjectsCreateLocalFilePreviewGrantRpc,
  WsProjectsWriteFileRpc,
  WsProjectsRunDevServerRpc,
  WsProjectsStopDevServerRpc,
  WsProjectsListDevServersRpc,
  WsSubscribeProjectDevServerEventsRpc,
  WsProjectsProvisionFromGitHubRpc,
  WsStudioListThreadOutputsRpc,
  WsFilesystemBrowseRpc,
  WsShellOpenInEditorRpc,
  WsGitGithubRepositoryRpc,
  WsGitStatusRpc,
  WsGitReadWorkingTreeDiffRpc,
  WsGitWorkingTreeDiffStatsRpc,
  WsGitSummarizeDiffRpc,
  WsGitPullRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPullRequestSnapshotRpc,
  WsGitPreparePullRequestThreadRpc,
  WsPullRequestsListRpc,
  WsPullRequestsReviewRequestCountRpc,
  WsPullRequestsDetailRpc,
  WsPullRequestsDiffRpc,
  WsPullRequestsActionRpc,
  WsPullRequestsCommentRpc,
  WsPullRequestsSetPinnedRpc,
  WsGitListBranchesRpc,
  WsGitCreateWorktreeRpc,
  WsGitCreateDetachedWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitStashAndCheckoutRpc,
  WsGitStashDropRpc,
  WsGitStashInfoRpc,
  WsGitRemoveIndexLockRpc,
  WsGitInitRpc,
  WsGitStageFilesRpc,
  WsGitUnstageFilesRpc,
  WsGitHandoffThreadRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalAckOutputRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsServerGetConfigRpc,
  WsServerGetEnvironmentRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsServerListExternalMcpIntegrationsRpc,
  WsServerCreateExternalMcpIntegrationRpc,
  WsServerRevokeExternalMcpIntegrationRpc,
  WsServerRefreshExternalMcpPairingRpc,
  WsServerListWorktreesRpc,
  WsServerListLocalServersRpc,
  WsServerStopLocalServerRpc,
  WsServerGetProviderUsageSnapshotRpc,
  WsServerListProviderUsageRpc,
  WsStatsGetProfileStatsRpc,
  WsStatsGetProfileTokenStatsRpc,
  WsServerGetDiagnosticsRpc,
  WsServerPrewarmVoiceRpc,
  WsServerTranscribeVoiceRpc,
  WsServerGenerateThreadRecapRpc,
  WsServerGenerateAutomationIntentRpc,
  WsServerUpsertKeybindingRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerProviderStatusesRpc,
  WsSubscribeServerSettingsRpc,
  WsProviderGetComposerCapabilitiesRpc,
  WsProviderCompactThreadRpc,
  WsProviderListCommandsRpc,
  WsProviderListSkillsRpc,
  WsProviderListSkillsCatalogRpc,
  WsProviderListPluginsRpc,
  WsProviderReadPluginRpc,
  WsProviderListModelsRpc,
  WsProviderListAgentsRpc,
  WsAutomationListRpc,
  WsAutomationGetMemoryRpc,
  WsAutomationCreateRpc,
  WsAutomationUpdateRpc,
  WsAutomationDeleteRpc,
  WsAutomationRunNowRpc,
  WsAutomationCancelRunRpc,
  WsAutomationMarkRunReadRpc,
  WsAutomationArchiveRunRpc,
  WsAutomationResolveProposalRpc,
  WsSubscribeAutomationEventsRpc,
);

/** @deprecated Use WsFeatureRpcGroup. Bootstrap is intentionally a separate endpoint/group. */
export const WsRpcGroup = WsFeatureRpcGroup;
