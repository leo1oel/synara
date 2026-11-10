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

import { GIT_TEXT_GENERATION_PROVIDER_ORDER } from "../git/textGenerationSelection.ts";

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
 */
export function resolveRunnableModelSelection(input: {
  readonly settings: ServerSettings;
  readonly preferences: ReadonlyArray<ModelSelection>;
  readonly statuses: ReadonlyArray<ServerProviderStatus>;
  readonly purpose: AuxiliaryModelPurpose;
}): RunnableModelSelection {
  const { settings, preferences, statuses, purpose } = input;
  const order = PROVIDER_ORDER_BY_PURPOSE[purpose];
  const instances = deriveProviderInstances(settings);

  for (const [preference, selection] of preferences.entries()) {
    const selectionInstanceId = resolveModelSelectionInstanceId(selection);
    const selected = instances.find((instance) => instance.instanceId === selectionInstanceId);
    if (!selected?.enabled || !order.includes(selected.driver)) continue;
    const status = statusForInstance(statuses, selected);
    if (status && !isProviderUsable(status)) continue;
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

  for (const driver of order) {
    for (const instance of instances) {
      if (!instance.enabled || instance.driver !== driver) continue;
      const status = statusForInstance(statuses, instance);
      if (!isProviderUsable(status)) continue;
      const model = defaultModelFor(purpose, driver, status);
      if (!model) continue;
      return {
        kind: "fallback",
        selection: { provider: driver, instanceId: instance.instanceId, model } as ModelSelection,
      };
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
