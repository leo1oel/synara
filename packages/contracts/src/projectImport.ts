import { Schema } from "effect";
import {
  IsoDateTime,
  MessageId,
  ProjectId,
  SpaceId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { ProviderInstanceId } from "./providerInstance";

export const ProjectImportProvider = Schema.Literals(["codex", "claudeAgent"]);
export type ProjectImportProvider = typeof ProjectImportProvider.Type;

export const ProjectImportThread = Schema.Struct({
  key: TrimmedNonEmptyString,
  provider: ProjectImportProvider,
  /** Account the conversation was found in and will be copied into. */
  providerInstanceId: Schema.optional(ProviderInstanceId),
  /** Display name of a non-default account; absent for the default account. */
  accountLabel: Schema.optional(Schema.String),
  title: Schema.String,
  cwd: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archived: Schema.Boolean,
  alreadyImported: Schema.Boolean,
});
export type ProjectImportThread = typeof ProjectImportThread.Type;

export const ProjectImportProject = Schema.Struct({
  key: TrimmedNonEmptyString,
  title: Schema.String,
  workspaceRoot: Schema.String,
  directoryExists: Schema.Boolean,
  existingProjectId: Schema.NullOr(ProjectId),
  providers: Schema.Array(ProjectImportProvider),
  threads: Schema.Array(ProjectImportThread),
});
export type ProjectImportProject = typeof ProjectImportProject.Type;

export const ListProjectImportsInput = Schema.Struct({
  providers: Schema.Array(ProjectImportProvider),
});
export type ListProjectImportsInput = typeof ListProjectImportsInput.Type;

export const ListProjectImportsResult = Schema.Struct({
  projects: Schema.Array(ProjectImportProject),
  sources: Schema.Array(
    Schema.Struct({
      provider: ProjectImportProvider,
      providerInstanceId: Schema.optional(ProviderInstanceId),
      accountLabel: Schema.optional(Schema.String),
      error: Schema.NullOr(Schema.String),
    }),
  ),
});
export type ListProjectImportsResult = typeof ListProjectImportsResult.Type;

// One item per request gives progress and cancellation between durable imports.
// A null thread key links an empty project without creating any conversation.
export const ImportProjectInput = Schema.Struct({
  projectKey: TrimmedNonEmptyString,
  threadKey: Schema.NullOr(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  spaceId: Schema.optional(Schema.NullOr(SpaceId)),
});
export type ImportProjectInput = typeof ImportProjectInput.Type;

export const ImportProjectResult = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  status: Schema.Literals(["imported", "already-present", "project-linked"]),
});
export type ImportProjectResult = typeof ImportProjectResult.Type;

export const LoadProjectImportHistoryInput = Schema.Struct({
  threadId: ThreadId,
  /** Omit to inspect availability; echo the returned cursor to load one older page. */
  cursor: Schema.optional(TrimmedNonEmptyString),
});
export type LoadProjectImportHistoryInput = typeof LoadProjectImportHistoryInput.Type;

export const LoadProjectImportHistoryResult = Schema.Struct({
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
  messages: Schema.Array(
    Schema.Struct({
      messageId: MessageId,
      role: Schema.Literals(["user", "assistant"]),
      text: Schema.String,
      createdAt: IsoDateTime,
      updatedAt: IsoDateTime,
    }),
  ),
});
export type LoadProjectImportHistoryResult = typeof LoadProjectImportHistoryResult.Type;

// Lattice: an open folder's existing Claude Code and Codex sessions from other
// editors (VS Code, a terminal), listed beside its chats so one can be continued.
export const ListFolderSessionsInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListFolderSessionsInput = typeof ListFolderSessionsInput.Type;

export const FolderSession = Schema.Struct({
  provider: ProjectImportProvider,
  /** Account whose session store holds it; the continuation runs in that account. */
  providerInstanceId: ProviderInstanceId,
  externalId: TrimmedNonEmptyString,
  title: Schema.String,
  updatedAt: IsoDateTime,
});
export type FolderSession = typeof FolderSession.Type;

export const ListFolderSessionsResult = Schema.Struct({
  sessions: Schema.Array(FolderSession),
});
export type ListFolderSessionsResult = typeof ListFolderSessionsResult.Type;

export const OpenFolderSessionInput = Schema.Struct({
  projectId: ProjectId,
  provider: ProjectImportProvider,
  providerInstanceId: ProviderInstanceId,
  externalId: TrimmedNonEmptyString,
});
export type OpenFolderSessionInput = typeof OpenFolderSessionInput.Type;

export const OpenFolderSessionResult = Schema.Struct({
  threadId: ThreadId,
});
export type OpenFolderSessionResult = typeof OpenFolderSessionResult.Type;

// Lattice: "Continue in terminal" — the shell command that continues a chat's native
// Codex thread (`codex resume`) or Claude Code session (`claude --resume`) outside Synara.
export const GetNativeSessionHandoffInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetNativeSessionHandoffInput = typeof GetNativeSessionHandoffInput.Type;

export const NativeSessionHandoffUnavailableReason = Schema.Literals([
  /** The chat runs on an agent with no resumable terminal session of its own. */
  "unsupportedProvider",
  /** A Codex or Claude chat whose native session has not started yet. */
  "noNativeSession",
]);
export type NativeSessionHandoffUnavailableReason =
  typeof NativeSessionHandoffUnavailableReason.Type;

export const NativeSessionHandoff = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    provider: ProjectImportProvider,
    nativeId: TrimmedNonEmptyString,
    /** The folder the session runs in; the command changes into it first. */
    cwd: TrimmedNonEmptyString,
    /** Ready to paste into the platform's default shell. */
    command: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    reason: NativeSessionHandoffUnavailableReason,
  }),
]);
export type NativeSessionHandoff = typeof NativeSessionHandoff.Type;
