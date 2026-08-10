// FILE: ComposerExtrasMenu.tsx
// Purpose: Hosts the composer `+` menu for file attachments.
// Layer: Chat composer presentation
// Depends on: shared menu primitives, icon buttons, and the caller-owned attachment callback.

import { useId, useRef, type ChangeEvent } from "react";

import { PaperclipIcon, PlusIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";

export const ComposerExtrasMenu = function ComposerExtrasMenu(props: {
  onAddAttachments: (files: File[]) => void;
  triggerClassName?: string | undefined;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset the hidden input so selecting the same file twice still emits a change event.
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      props.onAddAttachments(files);
    }
    event.target.value = "";
  };

  return (
    <>
      <input
        id={inputId}
        ref={fileInputRef}
        data-testid="composer-file-input"
        type="file"
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
              <span>Add files</span>
            </span>
          </MenuItem>
        </ComposerPickerMenuPopup>
      </Menu>
    </>
  );
};
