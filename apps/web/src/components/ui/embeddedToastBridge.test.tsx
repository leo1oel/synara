import { describe, expect, it } from "vitest";
import {
  embeddedNotificationDismiss,
  embeddedNotificationUpsert,
  embeddedToastText,
  isEmbeddedNotificationActionMessage,
  LATTICE_EMBEDDED_NOTIFICATION_ACTION,
  SYNARA_EMBEDDED_NOTIFICATION,
} from "./embeddedToastBridge";

describe("embedded toast bridge", () => {
  it("serializes a provider failure and its copy action for Lattice", () => {
    expect(
      embeddedNotificationUpsert({
        id: "pi-update",
        type: "error",
        title: "Could not update Pi",
        description: (
          <>
            NotFound: ChildProcess.spawn (pi update)
            <br />
            Copy the command below.
          </>
        ),
        data: { copyText: "pi update" },
      }),
    ).toEqual({
      type: SYNARA_EMBEDDED_NOTIFICATION,
      operation: "upsert",
      id: "pi-update",
      level: "error",
      title: "Could not update Pi",
      detail: "NotFound: ChildProcess.spawn (pi update)Copy the command below.",
      timeoutMs: 5000,
      copyText: "pi update",
    });
  });

  it("preserves actionable toast labels without sending callbacks through IPC", () => {
    expect(
      embeddedNotificationUpsert({
        id: "updates",
        type: "warning",
        title: "Updates available",
        timeout: 0,
        actionProps: { children: "Review updates" },
        data: { secondaryActionProps: { children: "Update all" } },
      }),
    ).toMatchObject({
      timeoutMs: 0,
      primaryActionLabel: "Review updates",
      secondaryActionLabel: "Update all",
    });
  });

  it("validates host actions and serializes dismissals", () => {
    expect(embeddedNotificationDismiss("pi-update")).toEqual({
      type: SYNARA_EMBEDDED_NOTIFICATION,
      operation: "dismiss",
      id: "pi-update",
    });
    expect(
      isEmbeddedNotificationActionMessage({
        type: LATTICE_EMBEDDED_NOTIFICATION_ACTION,
        id: "pi-update",
        action: "dismiss",
      }),
    ).toBe(true);
    expect(
      isEmbeddedNotificationActionMessage({
        type: LATTICE_EMBEDDED_NOTIFICATION_ACTION,
        id: "pi-update",
        action: "execute-arbitrary-code",
      }),
    ).toBe(false);
  });

  it("extracts only display text from supported React nodes", () => {
    expect(
      embeddedToastText(
        <>
          One <strong>two</strong>
        </>,
      ),
    ).toBe("One two");
    expect(embeddedToastText({ unsafe: true } as never)).toBe("");
  });
});
