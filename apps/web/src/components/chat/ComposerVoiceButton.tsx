// FILE: ComposerVoiceButton.tsx
// Purpose: Renders the composer mic control for recording and transcribing a voice note.
// Layer: Chat composer presentation
// Depends on: shared button styling and caller-owned voice recording state callbacks.

import { i18n } from "~/i18n";
import { Loader2Icon, MicIcon } from "~/lib/icons";
import { Button } from "../ui/button";

export const ComposerVoiceButton = function ComposerVoiceButton(props: {
  disabled?: boolean;
  isRecording: boolean;
  isStarting?: boolean;
  isTranscribing: boolean;
  durationLabel: string;
  onClick: () => void;
}) {
  const isBusy = props.isTranscribing || props.isStarting === true;
  const label = props.isTranscribing
    ? i18n._("Transcribing voice note")
    : props.isStarting
      ? i18n._("Starting microphone")
      : props.isRecording
        ? `Stop voice note (${props.durationLabel})`
        : i18n._("Record voice note");

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="shrink-0 rounded-md"
      disabled={props.disabled || isBusy}
      aria-label={label}
      title={label}
      onClick={props.onClick}
    >
      {isBusy ? (
        <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        <MicIcon aria-hidden="true" className="size-4" />
      )}
    </Button>
  );
};
