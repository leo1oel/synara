import { postLayoutMetricsToLattice, readEmbedMode } from "../../embedMode";
import {
  EMBED_COMPOSER_SEND_EDGE_INSET_PX,
  embedComposerMinimumSidebarWidth,
  embedHorizontalContentMinimumSidebarWidth,
} from "../composerFooterLayout";

function intrinsicFlexRowWidth(row: HTMLElement): number {
  const style = window.getComputedStyle(row);
  const gap = Number.parseFloat(style.columnGap || style.gap) || 0;
  const children = Array.from(row.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && getComputedStyle(child).display !== "none",
  );
  return children.reduce(
    (width, child) => width + Math.max(child.scrollWidth, child.getBoundingClientRect().width),
    gap * Math.max(0, children.length - 1),
  );
}

// DOM measurement owns no React state. Keep its observer and RAF closures outside
// ChatView so React Compiler need not infer effects through this imperative loop.
export function observeLatticeComposerLayout(
  composerForm: HTMLFormElement | null,
  showComposerModelBootstrapSkeleton: boolean,
): (() => void) | undefined {
  const config = readEmbedMode();
  if (!config?.hostOrigin || !composerForm) return;
  const footer = composerForm.querySelector<HTMLElement>("[data-chat-composer-footer]");
  const leading = footer?.querySelector<HTMLElement>("[data-chat-composer-leading]");
  const actions = footer?.querySelector<HTMLElement>("[data-chat-composer-actions='right']");
  if (!footer || !leading || !actions) return;
  const composerSurface = composerForm.querySelector<HTMLElement>(".chat-composer-surface");
  let frame = 0;
  const publishMinimumWidth = () => {
    if (footer.clientWidth <= 0) return;
    const style = window.getComputedStyle(footer);
    const intrinsicMinimum = embedComposerMinimumSidebarWidth({
      viewportWidth: window.innerWidth,
      footerWidth: footer.clientWidth,
      footerPaddingLeft: Number.parseFloat(style.paddingLeft) || 0,
      footerPaddingRight: Number.parseFloat(style.paddingRight) || 0,
      footerGap: Number.parseFloat(style.columnGap || style.gap) || 0,
      // The v0.8.4 footer allocates spare space to this flex row; scrollWidth
      // describes allocated width rather than the intrinsic controls.
      leadingIntrinsicWidth: intrinsicFlexRowWidth(leading),
      actionsIntrinsicWidth: intrinsicFlexRowWidth(actions),
    });
    let horizontalContentMinimum = 0;
    if (composerSurface) {
      const surfaceRect = composerSurface.getBoundingClientRect();
      const cards = composerForm.querySelectorAll<HTMLElement>(
        "[data-composer-reference-attachments='true'] [data-slot='attachment-card']",
      );
      for (const card of cards) {
        const cardRect = card.getBoundingClientRect();
        if (cardRect.width <= 0) continue;
        horizontalContentMinimum = Math.max(
          horizontalContentMinimum,
          embedHorizontalContentMinimumSidebarWidth({
            viewportWidth: window.innerWidth,
            surfaceWidth: surfaceRect.width,
            contentRightOffset: cardRect.right - surfaceRect.left,
            endInset: EMBED_COMPOSER_SEND_EDGE_INSET_PX,
          }),
        );
      }
    }
    const sendControl =
      actions.lastElementChild instanceof HTMLElement ? actions.lastElementChild : null;
    let sendInsetMinimum = 0;
    if (composerSurface && sendControl) {
      const currentInset =
        composerSurface.getBoundingClientRect().right - sendControl.getBoundingClientRect().right;
      const missingInset = Math.max(0, EMBED_COMPOSER_SEND_EDGE_INSET_PX - currentInset);
      if (missingInset > 0) sendInsetMinimum = window.innerWidth + missingInset;
    }
    postLayoutMetricsToLattice(
      config,
      Math.max(
        showComposerModelBootstrapSkeleton ? 0 : intrinsicMinimum,
        horizontalContentMinimum,
        showComposerModelBootstrapSkeleton ? 0 : sendInsetMinimum,
      ),
    );
  };
  const reportMinimumWidth = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(publishMinimumWidth);
  };
  publishMinimumWidth();
  if (typeof ResizeObserver === "undefined") {
    return () => window.cancelAnimationFrame(frame);
  }
  const observer = new ResizeObserver(reportMinimumWidth);
  observer.observe(composerForm);
  observer.observe(footer);
  observer.observe(leading);
  observer.observe(actions);
  return () => {
    observer.disconnect();
    window.cancelAnimationFrame(frame);
  };
}
