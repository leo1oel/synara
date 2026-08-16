// FILE: skillsSettingsModel.test.ts
// Purpose: Locks down Settings -> Skills grouping for duplicate provider skill copies.
// Layer: Web settings logic tests

import type { ProviderSkillDescriptor } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { buildSettingsSkillGroups, buildSettingsSkillSections } from "./skillsSettingsModel";

function skill(partial: Partial<ProviderSkillDescriptor>): ProviderSkillDescriptor {
  return {
    name: "example",
    enabled: true,
    path: "/tmp/example/SKILL.md",
    ...partial,
  };
}

describe("buildSettingsSkillGroups", () => {
  it("renders duplicate provider copies as one shared skill group", () => {
    const groups = buildSettingsSkillGroups([
      skill({
        name: "check-code",
        description: "Codex copy",
        path: "/Users/test/.codex/skills/check-code/SKILL.md",
        scope: "codex",
      }),
      skill({
        name: "check-code",
        description: "Claude copy",
        path: "/Users/test/.claude/skills/check-code/SKILL.md",
        scope: "claude",
      }),
      skill({
        name: "cursor-only",
        path: "/Users/test/.cursor/skills/cursor-only/SKILL.md",
        scope: "cursor",
      }),
    ]);

    const shared = groups.find((group) => group.key === "check-code");
    expect(shared?.section).toBe("shared");
    expect(shared?.providers).toEqual(["codex", "claudeAgent"]);
    expect(shared?.sources.map((source) => source.origin)).toEqual(["codex", "claude"]);
    expect(shared?.sources.map((source) => source.skill.path)).toEqual([
      "/Users/test/.codex/skills/check-code/SKILL.md",
      "/Users/test/.claude/skills/check-code/SKILL.md",
    ]);

    const cursorOnly = groups.find((group) => group.key === "cursor-only");
    expect(cursorOnly?.section).toBe("cursor");
    expect(cursorOnly?.providers).toEqual(["cursor"]);
  });

  it("keeps duplicate copies from the same agent in that agent's section", () => {
    const groups = buildSettingsSkillGroups([
      skill({
        name: "cursor-review",
        path: "/Users/test/.cursor/skills/cursor-review/SKILL.md",
        scope: "cursor",
      }),
      skill({
        name: "cursor-review",
        path: "/Users/test/.cursor/skills-cursor/cursor-review/SKILL.md",
        scope: "cursor",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.section).toBe("cursor");
    expect(groups[0]?.sources).toHaveLength(2);
  });

  it("does not show provider icons for shared alias-only skills", () => {
    const groups = buildSettingsSkillGroups([
      skill({
        name: "portable-review",
        description: "Shared standard copy",
        path: "/Users/test/.agents/skills/portable-review/SKILL.md",
        scope: "agents",
      }),
    ]);

    expect(groups[0]?.providers).toEqual([]);
    expect(groups[0]?.section).toBe("agents");
  });

  it("labels Factory skill roots with the Droid provider", () => {
    const groups = buildSettingsSkillGroups([
      skill({
        name: "factory-review",
        path: "/Users/test/.factory/skills/factory-review/SKILL.md",
        scope: "factory",
      }),
    ]);

    expect(groups[0]?.providers).toEqual(["droid"]);
    expect(groups[0]?.sources[0]?.originInfo.label).toBe("Droid");
  });
});

describe("buildSettingsSkillSections", () => {
  it("labels Lattice-managed user skills as installed by the user", () => {
    const sections = buildSettingsSkillSections([
      skill({
        name: "paper-review",
        path: "/Users/test/.synara/skills/paper-review/SKILL.md",
        scope: "synara",
        management: {
          kind: "installed",
          id: "paper-review",
          canDelete: true,
        },
      }),
    ]);

    expect(sections.map((section) => section.title)).toEqual(["Installed by you"]);
    expect(sections[0]?.groups[0]?.sources[0]?.originInfo.label).toBe("Installed by you");
  });

  it("groups detected skills by agent and places cross-agent skills first", () => {
    const sections = buildSettingsSkillSections([
      skill({
        name: "logic-consolidator",
        path: "/Users/test/.codex/skills/logic-consolidator/SKILL.md",
        scope: "codex",
      }),
      skill({
        name: "logic-consolidator",
        path: "/Users/test/.claude/skills/logic-consolidator/SKILL.md",
        scope: "claude",
      }),
      skill({
        name: "cursor-only",
        path: "/Users/test/.cursor/skills/cursor-only/SKILL.md",
        scope: "cursor",
      }),
    ]);

    expect(sections.map((section) => section.title)).toEqual([
      "Shared across agents",
      "Cursor",
    ]);
    expect(sections[0]?.groups.map((group) => group.key)).toEqual(["logic-consolidator"]);
    expect(sections[1]?.groups.map((group) => group.key)).toEqual(["cursor-only"]);
  });
});
