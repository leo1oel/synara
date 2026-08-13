// FILE: TranscriptSelectionActionLayer.tsx
// Purpose: Renders the transcript selection floating action from controller state.
// Layer: Chat transcript interaction UI

import { type PendingTranscriptSelectionAction } from "./useTranscriptAssistantSelectionAction";
import { TranscriptSelectionAction } from "./TranscriptSelectionAction";

interface TranscriptSelectionActionLayerProps {
  action: PendingTranscriptSelectionAction | null;
  showMarkerActions: boolean;
  onHighlight: () => void;
  onUnderline: () => void;
  onAddToChat: () => void;
}

export function TranscriptSelectionActionLayer(props: TranscriptSelectionActionLayerProps) {
  if (!props.action) {
    return null;
  }

  return (
    <TranscriptSelectionAction
      left={props.action.left}
      top={props.action.top}
      placement={props.action.placement}
      onHighlight={props.showMarkerActions ? props.onHighlight : undefined}
      onUnderline={props.showMarkerActions ? props.onUnderline : undefined}
      onAddToChat={props.onAddToChat}
    />
  );
}
