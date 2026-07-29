import { afterEach, describe, expect, it, vi } from "vitest";

import { parseDesktopParentPid, processIsAlive, startDesktopParentMonitor } from "./desktopParentMonitor";

describe("desktop parent monitor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts only positive integer parent process identifiers", () => {
    expect(parseDesktopParentPid("42")).toBe(42);
    expect(parseDesktopParentPid(undefined)).toBeUndefined();
    expect(parseDesktopParentPid("0")).toBeUndefined();
    expect(parseDesktopParentPid("4.2")).toBeUndefined();
    expect(parseDesktopParentPid("not-a-pid")).toBeUndefined();
  });

  it("treats permission failures as evidence that a process still exists", () => {
    const permissionError = Object.assign(new Error("denied"), { code: "EPERM" });
    const missingError = Object.assign(new Error("missing"), { code: "ESRCH" });

    expect(
      processIsAlive(42, () => {
        throw permissionError;
      }),
    ).toBe(true);
    expect(
      processIsAlive(42, () => {
        throw missingError;
      }),
    ).toBe(false);
  });

  it("requests shutdown after the launching desktop process disappears", () => {
    vi.useFakeTimers();
    const environment = { SYNARA_DESKTOP_PARENT_PID: "42" };
    const requestStop = vi.fn();
    const stopMonitoring = startDesktopParentMonitor({
      environment,
      intervalMs: 25,
      isAlive: () => false,
      requestStop,
    });

    expect(environment.SYNARA_DESKTOP_PARENT_PID).toBeUndefined();
    vi.advanceTimersByTime(25);
    expect(requestStop).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(requestStop).toHaveBeenCalledOnce();

    stopMonitoring();
  });
});
