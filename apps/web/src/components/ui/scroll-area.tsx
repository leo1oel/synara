"use client";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";

import { cn } from "~/lib/utils";

function ScrollArea({
  className,
  children,
  viewportClassName,
  scrollFade: scrollFadeProp,
  scrollbarGutter: scrollbarGutterProp,
  hideScrollbars: hideScrollbarsProp,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string;
  scrollFade?: boolean;
  scrollbarGutter?: boolean;
  hideScrollbars?: boolean;
}) {
  const scrollFade = scrollFadeProp ?? false;
  const scrollbarGutter = scrollbarGutterProp ?? false;
  const hideScrollbars = hideScrollbarsProp ?? false;
  return (
    <ScrollAreaPrimitive.Root
      className={cn("relative size-full min-h-0 overflow-hidden", className)}
      data-slot="scroll-area"
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        className={cn(
          "h-full overscroll-contain rounded-[inherit] outline-none [-ms-overflow-style:none] [scrollbar-width:none] transition-shadows [&::-webkit-scrollbar]:hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-has-overflow-x:overscroll-x-contain",
          scrollFade &&
            "mask-t-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-start)))] mask-b-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-end)))] mask-l-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-start)))] mask-r-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-end)))] [--fade-size:1.5rem]",
          scrollbarGutter && "data-has-overflow-y:pe-2.5 data-has-overflow-x:pb-2.5",
          viewportClassName,
        )}
        data-slot="scroll-area-viewport"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {!hideScrollbars && (
        <>
          <ScrollBar orientation="vertical" />
          <ScrollBar orientation="horizontal" />
          <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
        </>
      )}
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({ className, orientation: orientationProp, ...props }: ScrollAreaPrimitive.Scrollbar.Props) {
  const orientation = orientationProp ?? "vertical";
  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cn("synara-scrollbar", className)}
      data-orientation={orientation}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className="synara-scrollbar-thumb" data-slot="scroll-area-thumb" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
