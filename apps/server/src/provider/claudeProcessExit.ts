/**
 * claudeProcessExit - Explains a Claude Code process that exits nonzero.
 *
 * Synara spawns Claude Code itself, so the Agent SDK never sees its stderr and
 * reports only "Claude Code process exited with code N". A CLI that dies at
 * startup (an outdated Claude Code rejecting a launch flag, a corrupted config)
 * writes its only explanation to stderr, before any stream-json output. This
 * module keeps a bounded stderr tail per process and turns it into a one-line,
 * redacted reason plus a stable error code the web maps to a next step.
 */
import { redactDiagnosticText } from "@synara/shared/diagnosticsRedaction";

/** Error codes the web maps to a localized next step (see workLog). */
export const CLAUDE_FAILURE_ERROR_CODES = {
  cliOutdated: "claude_cli_outdated",
  authRequired: "claude_auth_required",
  modelUnavailable: "claude_model_unavailable",
  cliFailed: "claude_cli_failed",
} as const;

export type ClaudeFailureErrorCode =
  (typeof CLAUDE_FAILURE_ERROR_CODES)[keyof typeof CLAUDE_FAILURE_ERROR_CODES];

// Enough for a usage error or a short stack; the reason is cut to one line anyway.
const STDERR_TAIL_CHARS = 8 * 1024;
const REASON_MAX_CHARS = 300;
// Exit can be observed before the last stderr chunk; wait this long for it.
const STDERR_SETTLE_MS = 250;

/** The part of a child's stderr stream the capture needs. */
export interface ClaudeStderrStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  once(event: "close" | "error", listener: () => void): unknown;
}

export interface ClaudeStderrCapture {
  /** The retained tail of everything the process wrote to stderr. */
  readonly text: () => string;
  /** Resolves when stderr has closed, or after a short bound once it exits. */
  readonly settled: () => Promise<void>;
}

/**
 * Tees a child's stderr to `forward` (the sidecar's own stderr, which Lattice
 * logs) while keeping its tail. Always consumes the stream, so a chatty child
 * can never block on a full pipe.
 */
export function captureClaudeStderr(
  stderr: ClaudeStderrStream | null | undefined,
  forward: (chunk: Buffer | string) => void,
): ClaudeStderrCapture | undefined {
  if (!stderr || typeof stderr.on !== "function") return undefined;
  let tail = "";
  let closed = false;
  const waiters: Array<() => void> = [];
  const close = () => {
    closed = true;
    for (const resolve of waiters.splice(0)) resolve();
  };
  stderr.on("data", (chunk: Buffer | string) => {
    try {
      forward(chunk);
    } catch {
      // Logging must never stop the capture.
    }
    tail += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (tail.length > 2 * STDERR_TAIL_CHARS) tail = tail.slice(-STDERR_TAIL_CHARS);
  });
  stderr.once("close", close);
  stderr.once("error", close);
  return {
    text: () => tail.slice(-STDERR_TAIL_CHARS),
    settled: () =>
      closed
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, STDERR_SETTLE_MS);
            waiters.push(() => {
              clearTimeout(timer);
              resolve();
            });
          }),
  };
}

const PROCESS_EXIT_PATTERN =
  /Claude Code process (?:exited with code \d+|terminated by signal \S+)/i;
const STACK_FRAME = /^\s*at\s/;
// Node's own runtime chatter, not Claude Code's reason.
const NODE_NOISE = /^\(node:\d+\)|^\(Use `node --trace-/;
const REASON_LINE =
  /error|invalid|unknown|corrupt|requires|denied|not found|no such|failed|cannot|can't|unable|not logged|login|expired|unsupported|not available|in use/i;
const OPTION_NAME = /--[a-z][a-z0-9-]*/g;
// eslint-disable-next-line no-control-regex -- stripping terminal colour codes is the point
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** The most telling stderr line: the first that names a problem, else the last. */
export function claudeStderrReason(stderr: string, homeDir?: string): string | undefined {
  const lines = stderr
    .replace(ANSI, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !STACK_FRAME.test(line) && !NODE_NOISE.test(line));
  const line = lines.find((candidate) => REASON_LINE.test(candidate)) ?? lines.at(-1);
  if (!line) return undefined;
  // The rejected option is the whole point of an outdated-CLI reason, but long
  // option names look like opaque tokens to the redactor; keep them verbatim.
  const options: Array<string> = [];
  const masked = line.replace(OPTION_NAME, (name) => `__OPTION${options.push(name) - 1}__`);
  const redacted = redactDiagnosticText(masked, {
    ...(homeDir ? { homeDir } : {}),
    maxLength: 4 * REASON_MAX_CHARS,
  })
    .replace(
      /__OPTION(\d+)__/g,
      (placeholder, index: string) => options[Number(index)] ?? placeholder,
    )
    .trim();
  if (redacted.length === 0) return undefined;
  return redacted.length > REASON_MAX_CHARS
    ? `${redacted.slice(0, REASON_MAX_CHARS - 1).trimEnd()}…`
    : redacted;
}

/** Classifies a Claude failure text (stderr reason or provider message). */
export function classifyClaudeFailure(text: string): ClaudeFailureErrorCode | undefined {
  if (
    /unknown option|unknown command|too many arguments|option '[^']*' argument '[^']*' is invalid/i.test(
      text,
    )
  ) {
    return CLAUDE_FAILURE_ERROR_CODES.cliOutdated;
  }
  if (
    /not logged in|please run \/login|invalid api key|oauth token|authentication[_ ]failed|credentials? (?:are |is )?(?:missing|invalid|expired)/i.test(
      text,
    )
  ) {
    return CLAUDE_FAILURE_ERROR_CODES.authRequired;
  }
  if (
    /issue with the selected model|model_not_found|model[^.]*(?:not found|not available|does not exist)/i.test(
      text,
    )
  ) {
    return CLAUDE_FAILURE_ERROR_CODES.modelUnavailable;
  }
  return undefined;
}

export interface ClaudeProcessExitDescription {
  readonly message: string;
  readonly errorCode?: ClaudeFailureErrorCode;
}

/**
 * Adds Claude Code's own stderr reason to an SDK process-exit message, with a
 * code for the card's plain-language help. An exit with nothing on stderr keeps
 * the generic text (and the generic "stopped unexpectedly" help); a message
 * that is not a process exit comes back unchanged and without a code.
 */
export function describeClaudeProcessExit(input: {
  readonly message: string;
  readonly stderr: string | undefined;
  readonly homeDir?: string;
}): ClaudeProcessExitDescription {
  const exit = input.message.match(PROCESS_EXIT_PATTERN)?.[0];
  if (!exit) return { message: input.message };
  // The SDK appends its own ". stderr: …" when it owned the spawn; prefer ours.
  const reason =
    (input.stderr ? claudeStderrReason(input.stderr, input.homeDir) : undefined) ??
    claudeStderrReason(input.message.split(/\. stderr: /u)[1] ?? "", input.homeDir);
  // Nothing on stderr: keep the generic text, but still say what to try.
  if (!reason) return { message: input.message, errorCode: CLAUDE_FAILURE_ERROR_CODES.cliFailed };
  return {
    message: `${exit}: ${reason}`,
    errorCode: classifyClaudeFailure(reason) ?? CLAUDE_FAILURE_ERROR_CODES.cliFailed,
  };
}
