// FILE: QueuedComposerActions.tsx
// Purpose: Inline action cluster (Steer / Delete / Menu) rendered on each queued
// composer row. Used in both the compact and expanded composer layouts so the
// action chrome stays in lockstep across surfaces.
// Layer: Chat composer UI primitive
// Exports: QueuedComposerActions

import { useLingui } from "@lingui/react";
import { EllipsisIcon, SteerIcon, Trash2 } from "~/lib/icons";

import type { QueuedComposerTurn } from "../../composerDraftStore";

import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";

type QueuedComposerActionsProps = {
  queuedTurn: QueuedComposerTurn;
  onSteer: (queuedTurn: QueuedComposerTurn) => void;
  onRemove: (queuedTurnId: string) => void;
  onEdit: (queuedTurn: QueuedComposerTurn) => void;
};

function QueuedComposerActions({
  queuedTurn,
  onSteer,
  onRemove,
  onEdit,
}: QueuedComposerActionsProps) {
  const { i18n } = useLingui();
  return (
    <div className="flex shrink-0 items-center gap-0">
      <Button variant="ghost" size="chip" onClick={() => void onSteer(queuedTurn)}>
        <SteerIcon />
        <span>{i18n._("Steer")}</span>
      </Button>
      <IconButton
        variant="ghost"
        size="icon-chip"
        label={i18n._("Delete queued follow-up")}
        onClick={() => onRemove(queuedTurn.id)}
      >
        <Trash2 />
      </IconButton>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-chip"
              aria-label={i18n._("Queued follow-up actions")}
              className="[&_svg]:mx-0"
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="end" side="top" sideOffset={6}>
          <MenuItem onClick={() => onEdit(queuedTurn)}>{i18n._("Edit queued prompt")}</MenuItem>
          <MenuItem onClick={() => onRemove(queuedTurn.id)}>
            {i18n._("Delete queued prompt")}
          </MenuItem>
        </ComposerPickerMenuPopup>
      </Menu>
    </div>
  );
}

export { QueuedComposerActions };
