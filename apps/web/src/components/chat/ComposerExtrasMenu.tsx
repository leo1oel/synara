// FILE: ComposerExtrasMenu.tsx
// Purpose: Hosts the composer `+` menu for attachments and quick composer mode toggles.
// Layer: Chat composer presentation
// Depends on: shared menu primitives, icon buttons, and caller-owned composer state callbacks.

import { type ProviderInteractionMode } from "@synara/contracts";
import { useId, useRef, type ChangeEvent } from "react";
import { GoTasklist } from "react-icons/go";

import { PaperclipIcon, PlusIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { Button } from "../ui/button";
import { Menu, MenuCheckboxItem, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";

export const ComposerExtrasMenu = function ComposerExtrasMenu(props: {
  interactionMode: ProviderInteractionMode;
  onAddPhotos: (files: File[]) => void;
  onSetPlanMode: (enabled: boolean) => void;
  triggerClassName?: string | undefined;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset the hidden input so selecting the same image twice still emits a change event.
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      props.onAddPhotos(files);
    }
    event.target.value = "";
  };

  return (
    <>
      <input
        id={inputId}
        ref={fileInputRef}
        data-testid="composer-photo-input"
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={handleFileInputChange}
      />
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="chrome"
              className={cn("shrink-0 rounded-md", props.triggerClassName)}
              aria-label="Composer extras"
            />
          }
        >
          <PlusIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="start">
          <MenuItem
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <span className="inline-flex items-center gap-2">
              <PaperclipIcon className="block size-4 shrink-0" />
              <span>Add image</span>
            </span>
          </MenuItem>

          <MenuSeparator />
          <MenuCheckboxItem
            checked={props.interactionMode === "plan"}
            className="composer-plan-mode-toggle items-center leading-4"
            variant="switch"
            onCheckedChange={(checked) => {
              props.onSetPlanMode(checked === true);
            }}
          >
            <span className="inline-flex h-4 translate-y-px items-center gap-2 leading-4">
              <GoTasklist className="block size-4 shrink-0 self-center" />
              <span className="leading-4">Plan mode</span>
            </span>
          </MenuCheckboxItem>
        </ComposerPickerMenuPopup>
      </Menu>
    </>
  );
};
