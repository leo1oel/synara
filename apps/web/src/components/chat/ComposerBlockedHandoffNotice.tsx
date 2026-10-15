// FILE: ComposerBlockedHandoffNotice.tsx
// Purpose: Explains a same-thread handoff the source's background tasks refused, and
// offers to stop those tasks and switch now.
// Layer: Chat composer UI
// Exports: ComposerBlockedHandoffNotice

import { PROVIDER_DISPLAY_NAMES } from "@synara/contracts";
import { useState } from "react";

import { i18n } from "~/i18n";

import type { BlockedProviderHandoff } from "~/lib/threadHandoff";
import { ComposerActionNotice } from "./ComposerActionNotice";

export function ComposerBlockedHandoffNotice({
  blocked,
  onStopTasksAndSwitch,
  onDismiss,
}: {
  blocked: BlockedProviderHandoff;
  onStopTasksAndSwitch: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [switching, setSwitching] = useState(false);
  const sourceName =
    PROVIDER_DISPLAY_NAMES[blocked.info.sourceProvider] ?? blocked.info.sourceProvider;
  const targetName =
    PROVIDER_DISPLAY_NAMES[blocked.info.targetProvider] ?? blocked.info.targetProvider;
  const stopTasksAndSwitch = () => {
    setSwitching(true);
    void onStopTasksAndSwitch().finally(() => setSwitching(false));
  };
  return (
    <ComposerActionNotice
      data-testid="blocked-handoff-notice"
      message={i18n._(
        "{source} still has background tasks running in this thread, so it can't switch to {target} yet. Stop them to switch now, or wait for them to finish and send again.",
        { source: sourceName, target: targetName },
      )}
      actions={[
        {
          label: i18n._("Stop tasks and switch"),
          onClick: stopTasksAndSwitch,
          disabled: switching,
        },
        { label: i18n._("Dismiss"), onClick: onDismiss, disabled: switching },
      ]}
    />
  );
}
