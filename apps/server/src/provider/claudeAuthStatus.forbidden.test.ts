import { describe, expect, it } from "vitest";

import { parseClaudeAuthStatusFromOutput } from "./claudeAuthStatus";

// A probe that ever reaches the API and gets Anthropic's 403 must not tell the
// user to sign in again; `claude auth status` itself reads local credentials only.
describe("parseClaudeAuthStatusFromOutput on a 403 refusal", () => {
  it.each([
    "Failed to authenticate. API Error: 403 Request not allowed",
    'Failed to authenticate. API Error: 403 {"error":{"type":"forbidden","message":"Request not allowed"}}',
  ])("reports %j as refused, not signed out", (stderr) => {
    expect(parseClaudeAuthStatusFromOutput({ stdout: "", stderr, code: 1 })).toEqual({
      status: "error",
      authStatus: "unknown",
      message: "Anthropic refused this Claude account or network (403 Request not allowed).",
    });
  });

  it("still reports a missing sign-in as unauthenticated", () => {
    expect(
      parseClaudeAuthStatusFromOutput({ stdout: "Not logged in", stderr: "", code: 1 }).authStatus,
    ).toBe("unauthenticated");
  });
});
