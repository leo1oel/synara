// FILE: DesktopSettingsPanels.browser.tsx
// Purpose: Lock the browser/native lifecycle behavior owned by the desktop settings panels.
// Layer: Browser UI test

import "../../index.css";

import type { DesktopAppSnapPermissionGuideState, DesktopAppSnapState } from "@synara/contracts";
import type { AppSettingsBinding } from "~/appSettings";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const harness = vi.hoisted(() => ({
  settings: {
    appSnapPlaySound: true,
    appSnapShortcut: { kind: "both-option-keys" as const },
    enableAppSnap: false,
    enableSystemTaskCompletionNotifications: false,
    enableTaskCompletionToasts: true,
  },
  defaults: {
    appSnapPlaySound: true,
    appSnapShortcut: { kind: "both-option-keys" as const },
    enableAppSnap: false,
    enableSystemTaskCompletionNotifications: false,
    enableTaskCompletionToasts: true,
  },
  updateSettings: vi.fn(),
  readBrowserPermission: vi.fn(() => "default"),
  requestBrowserPermission: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("~/env", () => ({ isElectron: false }));

vi.mock("~/notifications/taskCompletion", () => ({
  buildNotificationSettingsSupportText: (permission: string) => `Permission: ${permission}`,
  readBrowserNotificationPermissionState: harness.readBrowserPermission,
  requestBrowserNotificationPermission: harness.requestBrowserPermission,
}));

vi.mock("~/components/ui/toast", () => ({
  toastManager: { add: harness.toastAdd },
}));

import { AppSnapSettingsPanel, NotificationsSettingsPanel } from "./DesktopSettingsPanels";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function settingsBinding(): AppSettingsBinding {
  return {
    settings: harness.settings,
    defaults: harness.defaults,
    updateSettings: harness.updateSettings,
  } as unknown as AppSettingsBinding;
}

function AppSnapActivityHarness() {
  const [active, setActive] = useState(true);
  return (
    <QueryClientProvider client={queryClient}>
      <button type="button" onClick={() => setActive(false)}>
        Leave AppSnap
      </button>
      <button type="button" onClick={() => setActive(true)}>
        Return to AppSnap
      </button>
      <AppSnapSettingsPanel active={active} {...settingsBinding()} />
    </QueryClientProvider>
  );
}

const READY_STATE: DesktopAppSnapState = {
  platform: "macos",
  supported: true,
  enabled: true,
  status: "ready",
  shortcut: { kind: "both-option-keys" },
  inputMonitoringPermission: "granted",
  screenRecordingPermission: "granted",
  message: null,
  appDisplayName: "Synara (Dev)",
};

const DENIED_STATE: DesktopAppSnapState = {
  ...READY_STATE,
  status: "permission-required",
  message: "Allow the required macOS permissions, then try again.",
  inputMonitoringPermission: "denied",
  screenRecordingPermission: "denied",
};

function setDesktopBridge(value: unknown): void {
  Object.defineProperty(window, "desktopBridge", {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  harness.updateSettings.mockReset();
  harness.readBrowserPermission.mockReset().mockReturnValue("default");
  harness.requestBrowserPermission.mockReset();
  harness.toastAdd.mockReset();
  queryClient.clear();
  setDesktopBridge(undefined);
});

afterEach(() => {
  document.body.innerHTML = "";
  setDesktopBridge(undefined);
});

describe("NotificationsSettingsPanel", () => {
  it("keeps the preference disabled and explains a denied browser permission", async () => {
    harness.requestBrowserPermission.mockResolvedValue("denied");
    const mounted = await render(<NotificationsSettingsPanel active {...settingsBinding()} />);

    await mounted.getByLabelText("Desktop activity notifications").click();

    await vi.waitFor(() => {
      expect(harness.updateSettings).toHaveBeenCalledWith({
        enableSystemTaskCompletionNotifications: false,
      });
      expect(harness.toastAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "warning",
          title: "Desktop notifications unavailable",
        }),
      );
    });

    await mounted.unmount();
  });
});

describe("AppSnapSettingsPanel", () => {
  it("owns the native state subscription and releases it on unmount", async () => {
    const unsubscribe = vi.fn();
    const guideUnsubscribe = vi.fn();
    const getState = vi.fn().mockResolvedValue(READY_STATE);
    const requestPermissions = vi.fn().mockResolvedValue(READY_STATE);
    const setEnabled = vi.fn().mockResolvedValue(READY_STATE);
    const checkShortcut = vi.fn().mockResolvedValue({ available: true, reason: null });
    const setShortcut = vi.fn().mockResolvedValue({
      state: READY_STATE,
      availability: { available: true, reason: null },
    });
    const onState = vi.fn(() => unsubscribe);
    const onPermissionGuideState = vi.fn(() => guideUnsubscribe);
    setDesktopBridge({
      appSnap: {
        getState,
        requestPermissions,
        setEnabled,
        checkShortcut,
        setShortcut,
        onState,
        onPermissionGuideState,
      },
    });

    const mounted = await render(<AppSnapActivityHarness />);
    await expect
      .element(mounted.getByText("Listening — press ⌥ left + ⌥ right to snap"))
      .toBeVisible();
    expect(onState).toHaveBeenCalledOnce();
    expect(onPermissionGuideState).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    expect(requestPermissions).not.toHaveBeenCalled();

    await mounted.getByRole("button", { name: "Leave AppSnap" }).click();
    await expect
      .element(mounted.getByText("Listening — press ⌥ left + ⌥ right to snap"))
      .not.toBeInTheDocument();
    // Passive-effect cleanup lags the commit by a task; the focus below must
    // land after the window-return listener has actually detached.
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(getState).toHaveBeenCalledTimes(2);
    await mounted.getByRole("button", { name: "Return to AppSnap" }).click();
    await expect
      .element(mounted.getByText("Listening — press ⌥ left + ⌥ right to snap"))
      .toBeVisible();
    expect(onState).toHaveBeenCalledOnce();
    expect(unsubscribe).not.toHaveBeenCalled();

    await mounted.getByLabelText("Enable AppSnap").click();
    await vi.waitFor(() => {
      expect(requestPermissions).toHaveBeenCalledOnce();
      expect(setEnabled).toHaveBeenCalledWith(true);
      expect(harness.updateSettings).toHaveBeenCalledWith({ enableAppSnap: true });
    });

    await mounted.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(guideUnsubscribe).toHaveBeenCalledOnce();
  });

  it("records two keys, checks availability, and saves the shortcut", async () => {
    const checkShortcut = vi.fn().mockResolvedValue({ available: true, reason: null });
    const nextState = {
      ...READY_STATE,
      shortcut: { kind: "key-chord", modifier: "option", key: "KeyS" } as const,
    };
    const setShortcut = vi.fn().mockResolvedValue({
      state: nextState,
      availability: { available: true, reason: null },
    });
    setDesktopBridge({
      appSnap: {
        getState: vi.fn().mockResolvedValue(READY_STATE),
        requestPermissions: vi.fn().mockResolvedValue(READY_STATE),
        setEnabled: vi.fn().mockResolvedValue(READY_STATE),
        checkShortcut,
        setShortcut,
        onState: vi.fn(() => vi.fn()),
        onPermissionGuideState: vi.fn(() => vi.fn()),
      },
    });

    const mounted = await render(<AppSnapActivityHarness />);
    await mounted.getByRole("button", { name: "Record AppSnap shortcut" }).click();
    const recorder = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Record AppSnap shortcut"]',
    );
    recorder?.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "AltLeft",
        key: "Alt",
        bubbles: true,
        cancelable: true,
      }),
    );
    recorder?.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyS",
        key: "s",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    await expect.element(mounted.getByText("Available — save to apply.")).toBeVisible();
    expect(checkShortcut).toHaveBeenCalledWith({
      kind: "key-chord",
      modifier: "option",
      key: "KeyS",
    });
    await mounted.getByRole("button", { name: "Save" }).click();
    await vi.waitFor(() => {
      expect(setShortcut).toHaveBeenCalledWith({
        kind: "key-chord",
        modifier: "option",
        key: "KeyS",
      });
      expect(harness.updateSettings).toHaveBeenCalledWith({
        appSnapShortcut: { kind: "key-chord", modifier: "option", key: "KeyS" },
      });
    });

    await mounted.unmount();
  });

  // Lattice shows each macOS permission as a badge with one Recheck control (4626f08ab)
  // instead of upstream's guided Grant flow.
  it("shows denied permissions as badges and rechecks them", async () => {
    const requestPermissions = vi.fn().mockResolvedValue(DENIED_STATE);
    const setEnabled = vi.fn().mockResolvedValue(DENIED_STATE);
    setDesktopBridge({
      appSnap: {
        getState: vi.fn().mockResolvedValue(DENIED_STATE),
        requestPermissions,
        setEnabled,
        checkShortcut: vi.fn().mockResolvedValue({ available: true, reason: null }),
        setShortcut: vi.fn().mockResolvedValue({
          state: DENIED_STATE,
          availability: { available: true, reason: null },
        }),
        onState: vi.fn(() => vi.fn()),
        onPermissionGuideState: vi.fn(() => vi.fn()),
      },
    });

    const mounted = await render(<AppSnapActivityHarness />);
    await vi.waitFor(() => expect(mounted.getByText("Denied").elements()).toHaveLength(2));
    expect(mounted.getByRole("button", { name: "Grant" }).elements()).toHaveLength(0);

    setEnabled.mockResolvedValue(READY_STATE);
    await mounted.getByRole("button", { name: "Recheck permissions" }).click();
    await vi.waitFor(() => {
      expect(requestPermissions).toHaveBeenCalledOnce();
      expect(setEnabled).toHaveBeenCalledWith(harness.settings.enableAppSnap);
      expect(mounted.getByText("Granted").elements()).toHaveLength(2);
    });
    expect(mounted.getByText("Denied").elements()).toHaveLength(0);

    await mounted.unmount();
  });

  it("refreshes the badges when the native coach reports a granted permission", async () => {
    const pushedGuideStateRef: {
      current: ((state: DesktopAppSnapPermissionGuideState) => void) | null;
    } = { current: null };
    const getState = vi.fn().mockResolvedValue(DENIED_STATE);
    setDesktopBridge({
      appSnap: {
        getState,
        requestPermissions: vi.fn().mockResolvedValue(DENIED_STATE),
        setEnabled: vi.fn().mockResolvedValue(DENIED_STATE),
        checkShortcut: vi.fn().mockResolvedValue({ available: true, reason: null }),
        setShortcut: vi.fn().mockResolvedValue({
          state: DENIED_STATE,
          availability: { available: true, reason: null },
        }),
        onState: vi.fn(() => vi.fn()),
        onPermissionGuideState: vi.fn(
          (listener: (state: DesktopAppSnapPermissionGuideState) => void) => {
            pushedGuideStateRef.current = listener;
            return vi.fn();
          },
        ),
      },
    });

    const mounted = await render(<AppSnapActivityHarness />);
    await vi.waitFor(() => expect(mounted.getByText("Denied").elements()).toHaveLength(2));

    getState.mockResolvedValue({ ...DENIED_STATE, inputMonitoringPermission: "granted" });
    pushedGuideStateRef.current?.("granted");
    await vi.waitFor(() => {
      expect(mounted.getByText("Granted").elements()).toHaveLength(1);
      expect(mounted.getByText("Denied").elements()).toHaveLength(1);
    });

    await mounted.unmount();
  });
});
