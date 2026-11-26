import { describe, expect, it } from "vitest";

import { parseClaudeAuthStatusFromOutput } from "./claudeAuthStatus";

describe("Claude auth status malformed JSON", () => {
  it("does not treat malformed JSON with exit code zero as authenticated", () => {
    const result = parseClaudeAuthStatusFromOutput({
      stdout: '{"loggedIn":',
      stderr: "",
      code: 0,
    });

    expect(result.status).toBe("warning");
    expect(result.authStatus).toBe("unknown");
    expect(result.message).toContain("missing auth marker");
  });

  it("keeps plain successful non-JSON output on the legacy authenticated fallback", () => {
    const result = parseClaudeAuthStatusFromOutput({
      stdout: "Authenticated",
      stderr: "",
      code: 0,
    });

    expect(result).toEqual({ status: "ready", authStatus: "authenticated" });
  });

  it("reports coloured stderr from a failed probe without escape codes", () => {
    const result = parseClaudeAuthStatusFromOutput({
      stdout: "",
      stderr: "\u001b[31mError: ENOENT: no such file or directory, uv_cwd\u001b[39m",
      code: 1,
    });

    expect(result.message).toBe(
      "Could not verify Claude authentication status. Error: ENOENT: no such file or directory, uv_cwd",
    );
  });
});
