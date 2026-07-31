// FILE: search-input.tsx
// Purpose: General-purpose search input — the standard Input with a leading
//          magnifier icon (e.g. "Search files...", "Search settings...").
// Layer: UI primitives

import { forwardRef } from "react";

import { SearchIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Input, type InputProps } from "./input";

export type SearchInputProps = InputProps & {
  containerClassName?: string;
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { className, containerClassName, type: typeProp, size: sizeProp, variant: variantProp, ...props },
  ref,
) {
  const type = typeProp ?? "search";
  const size = sizeProp ?? "default";
  const variant = variantProp ?? "soft";
  return (
    <div className={cn("relative w-full", containerClassName)} data-slot="search-field">
      <Input
        ref={ref}
        type={type}
        size={size}
        variant={variant}
        className={cn("[&>[data-slot=input]]:pl-8", className)}
        {...props}
      />
      <SearchIcon
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
        aria-hidden="true"
      />
    </div>
  );
});
