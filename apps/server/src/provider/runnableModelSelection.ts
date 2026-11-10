import {
  DEFAULT_DROID_GIT_TEXT_GENERATION_MODEL,
  PROVIDER_DISPLAY_NAMES,
  type ModelSelection,
  type ProviderKind,
  type ServerProviderStatus,
  type ServerSettings,
} from "@synara/contracts";
import { getDefaultModel, getDefaultModelForClaudeCliVersion } from "@synara/shared/model";
import {
  BUILT_IN_PROVIDER_KINDS,
  deriveProviderInstances,
  isProviderUsable,
  resolveModelSelectionInstanceId,
  type ResolvedProviderInstance,
} from "@synara/shared/providerInstances";

import { Duration, Effect, Option } from "effect";

import { GIT_TEXT_GENERATION_PROVIDER_ORDER } from "../git/textGenerationSelection.ts";
import { commandExistsOnPath } from "./providerBinaryResolution.ts";
import type { ProviderHealthShape } from "./Services/ProviderHealth.ts";

/**
 * Which providers can run an auxiliary model call, in fallback order. Text
 * generation (Lattice proofreading, Git writing) has a dedicated no-tools path
 * for only a few drivers; compile repair starts an ordinary agent thread, so
 * any built-in driver can take it.
 */
export type AuxiliaryModelPurpose = "text-generation" | "agent-turn";

const PROVIDER_ORDER_BY_PURPOSE: Record<AuxiliaryModelPurpose, ReadonlyArray<ProviderKind>> = {
  "text-generation": GIT_TEXT_GENERATION_PROVIDER_ORDER,
  "agent-turn": BUILT_IN_PROVIDER_KINDS,
};

export const CONNECT_PROVIDERS_LOCATION = "Agent panel → Settings → Providers";

/**
 * The model an auxiliary call actually runs on.
 *
 * - `selected`: the first Settings choice in `preferences` whose instance is
 *   enabled and not known to be unready; `preference` is its index.
 * - `fallback`: no Settings choice can run (not installed, signed out or
 *   disabled), so the first ready provider runs instead on its default model.
 * - `unavailable`: nothing can run; `message` names what to connect and where.
 */
export type RunnableModelSelection =
  | {
      readonly kind: "selected";
      readonly selection: ModelSelection;
      readonly preference: number;
    }
  | { readonly kind: "fallback"; readonly selection: ModelSelection }
  | { readonly kind: "unavailable"; readonly message: string };

function statusForInstance(
  statuses: ReadonlyArray<ServerProviderStatus>,
  instance: ResolvedProviderInstance,
): ServerProviderStatus | undefined {
  return statuses.find(
    (status) =>
      (status.driver ?? status.provider) === instance.driver &&
      (status.instanceId ?? status.provider) === instance.instanceId,
  );
}

function defaultModelFor(
  purpose: AuxiliaryModelPurpose,
  driver: ProviderKind,
  status: ServerProviderStatus | undefined,
): string | null {
  if (purpose === "text-generation" && driver === "droid") {
    return DEFAULT_DROID_GIT_TEXT_GENERATION_MODEL;
  }
  return status?.version
    ? getDefaultModelForClaudeCliVersion(driver, status.version)
    : getDefaultModel(driver);
}

function joinNames(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/**
 * Resolve the Settings selection for an auxiliary call against live provider
 * health, so a writer who connected only Claude is not sent to Codex because
 * Codex is the settings default.
 *
 * `preferences` are the Settings choices in priority order (for example the
 * proofreading override, then the Git writing model it inherits). A choice
 * wins whenever its instance is enabled, can serve `purpose`, and health does
 * not say it is unusable; a missing status (health not probed yet) keeps the
 * choice rather than failing a provider that may well work. Fallback
 * candidates must be confirmed usable, because nobody chose them.
 *
 * `cliFound` (see `readProviderHealthForAuxiliaryModel`) answers for an
 * instance health has not probed yet: `false` drops it like an unusable
 * status, and when no probed provider is ready, the first unprobed one whose
 * CLI is found stands in, which is the best guess left before the probe ends.
 */
export function resolveRunnableModelSelection(input: {
  readonly settings: ServerSettings;
  readonly preferences: ReadonlyArray<ModelSelection>;
  readonly statuses: ReadonlyArray<ServerProviderStatus>;
  readonly purpose: AuxiliaryModelPurpose;
  readonly cliFound?: ProviderCliFound | undefined;
}): RunnableModelSelection {
  const { settings, preferences, statuses, purpose, cliFound } = input;
  const order = PROVIDER_ORDER_BY_PURPOSE[purpose];
  const instances = deriveProviderInstances(settings);

  for (const [preference, selection] of preferences.entries()) {
    const selectionInstanceId = resolveModelSelectionInstanceId(selection);
    const selected = instances.find((instance) => instance.instanceId === selectionInstanceId);
    if (!selected?.enabled || !order.includes(selected.driver)) continue;
    const status = statusForInstance(statuses, selected);
    if (status ? !isProviderUsable(status) : cliFound?.(selected) === false) continue;
    return {
      kind: "selected",
      preference,
      selection:
        selected.driver === selection.provider
          ? selection
          : ({
              provider: selected.driver,
              instanceId: selected.instanceId,
              model: selection.model,
            } as ModelSelection),
    };
  }

  const isConfirmedReady = (instance: ResolvedProviderInstance) =>
    isProviderUsable(statusForInstance(statuses, instance));
  const isUnprobedWithCli = (instance: ResolvedProviderInstance) =>
    statusForInstance(statuses, instance) === undefined && cliFound?.(instance) === true;
  for (const canRun of [isConfirmedReady, isUnprobedWithCli]) {
    for (const driver of order) {
      for (const instance of instances) {
        if (!instance.enabled || instance.driver !== driver || !canRun(instance)) continue;
        const model = defaultModelFor(purpose, driver, statusForInstance(statuses, instance));
        if (!model) continue;
        return {
          kind: "fallback",
          selection: { provider: driver, instanceId: instance.instanceId, model } as ModelSelection,
        };
      }
    }
  }

  const enabledDrivers = new Set(
    instances.filter((instance) => instance.enabled).map((instance) => instance.driver),
  );
  const connectable = order.filter((driver) => enabledDrivers.has(driver));
  const names = (connectable.length > 0 ? connectable : order).map(
    (driver) => PROVIDER_DISPLAY_NAMES[driver],
  );
  return {
    kind: "unavailable",
    message: `No AI provider is connected. Connect ${joinNames(names)} in the ${CONNECT_PROVIDERS_LOCATION}.`,
  };
}

/**
 * Whether an instance health has not probed yet has its CLI where a spawn
 * would find it; `undefined` when there is no cheap check for that driver.
 */
export type ProviderCliFound = (instance: ResolvedProviderInstance) => boolean | undefined;

/**
 * The command each health probe spawns first when the instance sets no binary
 * path. Only these drivers are judged by their CLI before their first probe;
 * every other driver keeps "no status yet" as unknown.
 */
const PROBED_CLI_COMMAND: Partial<Record<ProviderKind, string>> = {
  codex: "codex",
  claudeAgent: "claude",
};

/**
 * The same PATH lookup a spawn does (`commandExistsOnPath`, with the instance's
 * own environment over the server's, as the probe passes it), so a CLI that is
 * not installed is known without spawning anything. The server put the usual
 * install folders on PATH at startup, and each probe refresh adds new ones.
 */
export const providerCliFound: ProviderCliFound = (instance) => {
  const defaultCommand = PROBED_CLI_COMMAND[instance.driver];
  if (!defaultCommand) return undefined;
  const configured = instance.config.binaryPath;
  const command = (typeof configured === "string" && configured.trim()) || defaultCommand;
  return commandExistsOnPath(command, { env: { ...process.env, ...instance.environment } });
};

/**
 * How long an auxiliary call waits for the first provider probe of the process
 * when its choice depends on a provider with no status yet. Long enough for the
 * CLI version checks that decide most cases, short enough that Proofread right
 * after launch does not feel stuck; past it, `providerCliFound` decides.
 */
export const FIRST_PROBE_WAIT = Duration.seconds(3);

/**
 * `cliFound` is set only when the first probe was still running at the wait's
 * bound; a finished probe's statuses decide on their own.
 */
export type AuxiliaryProviderHealth = {
  readonly statuses: ReadonlyArray<ServerProviderStatus>;
  readonly cliFound?: ProviderCliFound | undefined;
};

/**
 * Whether the choice for these inputs rests on a provider health has not
 * probed: a Settings choice kept only because it has no status, or nothing
 * runnable while some candidate is unprobed. A choice backed by a status, or
 * a fallback to a confirmed ready provider, does not wait.
 */
export function dependsOnUnprobedHealth(input: {
  readonly settings: ServerSettings;
  readonly preferences: ReadonlyArray<ModelSelection>;
  readonly statuses: ReadonlyArray<ServerProviderStatus>;
  readonly purpose: AuxiliaryModelPurpose;
}): boolean {
  const runnable = resolveRunnableModelSelection(input);
  if (runnable.kind === "fallback") return false;
  const instances = deriveProviderInstances(input.settings);
  if (runnable.kind === "selected") {
    const instanceId = resolveModelSelectionInstanceId(runnable.selection);
    const instance = instances.find((candidate) => candidate.instanceId === instanceId);
    return !instance || statusForInstance(input.statuses, instance) === undefined;
  }
  const order = PROVIDER_ORDER_BY_PURPOSE[input.purpose];
  return instances.some(
    (instance) =>
      instance.enabled &&
      order.includes(instance.driver) &&
      statusForInstance(input.statuses, instance) === undefined,
  );
}

/**
 * The provider health an auxiliary call (proofreading, compile repair, Git
 * writing) resolves its model against. Right after launch, before anything
 * opened the Agent panel, no probe may have run, so a Claude-only writer's
 * Proofread would keep the default Codex choice for lack of a status. When the
 * choice depends on such a status this joins ProviderHealth's shared refresh
 * (starting the first probe if none is running) for at most `wait`; the probe
 * keeps running past it and later calls read its result. When health is
 * already known it returns at once.
 */
export function readProviderHealthForAuxiliaryModel(input: {
  readonly providerHealth: Pick<ProviderHealthShape, "getStatuses" | "refresh">;
  readonly settings: ServerSettings;
  readonly preferences: ReadonlyArray<ModelSelection>;
  readonly purpose: AuxiliaryModelPurpose;
  readonly wait?: Duration.Input | undefined;
  readonly cliFound?: ProviderCliFound | undefined;
}): Effect.Effect<AuxiliaryProviderHealth> {
  const { providerHealth, settings, preferences, purpose } = input;
  return Effect.gen(function* () {
    const statuses = yield* providerHealth.getStatuses;
    if (!dependsOnUnprobedHealth({ settings, preferences, statuses, purpose })) {
      return { statuses };
    }
    // Interrupting the join at the bound leaves the shared refresh fiber running.
    const probed = yield* providerHealth.refresh.pipe(
      Effect.timeoutOption(input.wait ?? FIRST_PROBE_WAIT),
    );
    if (Option.isSome(probed)) return { statuses: probed.value };
    return {
      statuses: yield* providerHealth.getStatuses,
      cliFound: input.cliFound ?? providerCliFound,
    };
  });
}
