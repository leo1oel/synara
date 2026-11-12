import { describe, expect, it } from "vitest";

import { mapClaudeMcpServerStatuses, mapCodexMcpServerStatuses } from "./mcpServerStatus.ts";

describe("mapClaudeMcpServerStatuses", () => {
  it("maps Claude Code's status report and offers the actions each state allows", () => {
    const servers = mapClaudeMcpServerStatuses(
      [
        {
          name: "lab-stdio",
          status: "connected",
          scope: "user",
          config: { type: "stdio", command: "/opt/tools/bin/lab-server" },
          tools: [{}, {}],
        },
        {
          name: "linear",
          status: "needs-auth",
          scope: "user",
          config: { type: "http", url: "https://mcp.linear.app/mcp?token=secret" },
        },
        {
          name: "broken",
          status: "failed",
          scope: "project",
          error: "ENOENT: no such file or directory",
          config: { type: "stdio", command: "missing" },
        },
        { name: "off", status: "disabled", scope: "local", config: { type: "sse", url: "x" } },
        {
          name: "slow",
          status: "pending",
          config: { type: "http", url: "http://localhost:3/mcp" },
        },
      ],
      "lattice",
    );

    expect(servers).toEqual([
      {
        name: "linear",
        status: "needs-auth",
        transport: "http",
        toolCount: null,
        scope: "user",
        endpoint: "https://mcp.linear.app",
        actions: ["authenticate", "reconnect", "disable"],
      },
      {
        name: "broken",
        status: "failed",
        transport: "stdio",
        toolCount: null,
        error: "ENOENT: no such file or directory",
        scope: "project",
        endpoint: "missing",
        actions: ["reconnect", "disable"],
      },
      {
        name: "slow",
        status: "pending",
        transport: "http",
        toolCount: null,
        endpoint: "http://localhost:3",
        actions: ["reconnect", "disable"],
      },
      {
        name: "lab-stdio",
        status: "connected",
        transport: "stdio",
        toolCount: 2,
        scope: "user",
        endpoint: "lab-server",
        actions: ["reconnect", "disable"],
      },
      {
        name: "off",
        status: "disabled",
        transport: "sse",
        toolCount: null,
        scope: "local",
        actions: ["enable"],
      },
    ]);
  });

  it("leaves out the app's own gateway but keeps a user server of the same name", () => {
    const gateway = { name: "lattice", status: "connected", scope: "dynamic", tools: [{}] };
    expect(mapClaudeMcpServerStatuses([gateway], "lattice")).toEqual([]);
    expect(
      mapClaudeMcpServerStatuses([{ ...gateway, scope: "user" }], "lattice").map((s) => s.name),
    ).toEqual(["lattice"]);
  });

  it("never offers to toggle a plugin's server on its own", () => {
    const [server] = mapClaudeMcpServerStatuses(
      [{ name: "plugin:x", status: "connected", source: "plugin", tools: [] }],
      "lattice",
    );
    expect(server?.actions).toEqual(["reconnect"]);
  });
});

describe("mapCodexMcpServerStatuses", () => {
  it("derives state from the tool listing when no thread connection is reported", () => {
    const servers = mapCodexMcpServerStatuses(
      [
        {
          name: "lab-stdio",
          runtimeStatus: null,
          authStatus: "unsupported",
          tools: { a: {}, b: {} },
          toolsError: null,
          httpOrigin: null,
        },
        {
          name: "linear",
          runtimeStatus: null,
          authStatus: "notLoggedIn",
          tools: {},
          toolsError: "MCP startup failed: handshaking",
          httpOrigin: "https://mcp.linear.app",
        },
        {
          name: "broken",
          runtimeStatus: null,
          authStatus: "unsupported",
          tools: {},
          toolsError: "MCP startup failed: No such file or directory (os error 2)",
          httpOrigin: null,
        },
        { name: "off", runtimeStatus: null, authStatus: "unsupported", tools: {} },
        { name: "lattice", runtimeStatus: "connected", tools: { x: {} } },
      ],
      { gatewayServerName: "lattice", disabledServerNames: new Set(["off"]) },
    );

    expect(servers.map((server) => [server.name, server.status, server.toolCount])).toEqual([
      ["linear", "needs-auth", null],
      ["broken", "failed", null],
      ["lab-stdio", "connected", 2],
      ["off", "disabled", null],
    ]);
    // Enablement lives in config.toml only, so Codex rows never offer a toggle.
    expect(servers[0]?.actions).toEqual(["authenticate", "reconnect"]);
    expect(servers[1]?.error).toBe("MCP startup failed: No such file or directory (os error 2)");
    expect(servers[3]?.actions).toEqual([]);
  });

  it("prefers the thread's own runtime status", () => {
    const [server] = mapCodexMcpServerStatuses(
      [{ name: "remote", runtimeStatus: "authenticationRequired", httpOrigin: "https://a.b" }],
      { gatewayServerName: "lattice", disabledServerNames: new Set() },
    );
    expect(server).toMatchObject({
      status: "needs-auth",
      transport: "http",
      endpoint: "https://a.b",
    });
  });
});
