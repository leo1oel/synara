const DESKTOP_PARENT_PID_ENV_KEY = "SYNARA_DESKTOP_PARENT_PID";
const DEFAULT_PARENT_CHECK_INTERVAL_MS = 750;

type Environment = Record<string, string | undefined>;

export function parseDesktopParentPid(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/u.test(value)) return undefined;
  const pid = Number(value);
  return Number.isSafeInteger(pid) ? pid : undefined;
}

export function processIsAlive(
  pid: number,
  signalProcess: (pid: number, signal: 0) => unknown = process.kill,
): boolean {
  try {
    signalProcess(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ESRCH");
  }
}

/**
 * Stops a desktop Synara backend if the application process that launched it
 * disappears. The environment variable is intentionally opt-in, so standalone
 * CLI and web deployments retain their normal lifecycle.
 */
export function startDesktopParentMonitor(options?: {
  readonly environment?: Environment;
  readonly intervalMs?: number;
  readonly isAlive?: (pid: number) => boolean;
  readonly requestStop?: () => void;
}): () => void {
  const environment = options?.environment ?? process.env;
  const parentPid = parseDesktopParentPid(environment[DESKTOP_PARENT_PID_ENV_KEY]);
  delete environment[DESKTOP_PARENT_PID_ENV_KEY];

  if (parentPid === undefined || parentPid === process.pid) {
    return () => undefined;
  }

  const isAlive = options?.isAlive ?? processIsAlive;
  const requestStop = options?.requestStop ?? (() => void process.kill(process.pid, "SIGTERM"));
  const intervalMs = options?.intervalMs ?? DEFAULT_PARENT_CHECK_INTERVAL_MS;
  let stopped = false;

  const interval = setInterval(() => {
    if (stopped || isAlive(parentPid)) return;
    stopped = true;
    clearInterval(interval);
    requestStop();
  }, intervalMs);
  interval.unref();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
  };
}
