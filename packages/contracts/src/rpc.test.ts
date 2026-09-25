import { describe, expect, it } from "vitest";

import { WsBootstrapRpcGroup, WsFeatureRpcGroup, WsComputerRpcGroup } from "./rpc";
import { COMPUTER_WS_METHODS } from "./computer";
import { ORCHESTRATION_WS_METHODS } from "./orchestration";
import { WS_METHODS } from "./ws";

describe("WS RPC contracts", () => {
  it("registers every declared WebSocket method before server handlers are installed", () => {
    expect(
      Object.values(WS_METHODS).filter(
        (method) =>
          !WsBootstrapRpcGroup.requests.has(method) && !WsFeatureRpcGroup.requests.has(method),
      ),
    ).toEqual([]);
  });

  it("keeps bootstrap and feature RPCs in separate groups", () => {
    expect(WsBootstrapRpcGroup.requests.has("bootstrap.negotiate")).toBe(true);
    expect(WsFeatureRpcGroup.requests.has("bootstrap.negotiate")).toBe(false);
    expect(
      WsFeatureRpcGroup.requests.has(ORCHESTRATION_WS_METHODS.listProviderDeliveryBlockers),
    ).toBe(true);
    expect(WsFeatureRpcGroup.requests.has(ORCHESTRATION_WS_METHODS.reconcileProviderDelivery)).toBe(
      true,
    );
  });

  it("registers every computer method, including setup", () => {
    for (const method of Object.values(COMPUTER_WS_METHODS)) {
      expect(WsComputerRpcGroup.requests.has(method)).toBe(true);
    }
  });
});
