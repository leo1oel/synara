// FILE: claudeSkillsPlugin.test.ts
// Purpose: Verifies which skills Claude's skills plugin serves and how its
//          directory is built and reused under the Synara home.
// Layer: Server provider tests

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { claudeLaunchSettingsEqual } from "./claudeLaunchSettings.ts";
import { prepareClaudeSkillsPlugin } from "./claudeSkillsPlugin.ts";

let root: string;
let previousBundledDir: string | undefined;

function writeSkill(dir: string, name: string, extraFrontmatter = ""): void {
  mkdirSync(path.join(dir, name), { recursive: true });
  writeFileSync(
    path.join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill\n${extraFrontmatter}---\n# ${name}\n`,
  );
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "claude-skills-plugin-unit-"));
  previousBundledDir = process.env.SYNARA_BUNDLED_SKILLS_DIR;
  process.env.SYNARA_BUNDLED_SKILLS_DIR = path.join(root, "bundled");
});

afterEach(() => {
  if (previousBundledDir === undefined) delete process.env.SYNARA_BUNDLED_SKILLS_DIR;
  else process.env.SYNARA_BUNDLED_SKILLS_DIR = previousBundledDir;
  rmSync(root, { recursive: true, force: true });
});

describe("prepareClaudeSkillsPlugin", () => {
  it("serves enabled bundled and installed skills, bundled first, under the lattice name", async () => {
    const synaraBaseDir = path.join(root, "home");
    writeSkill(path.join(root, "bundled"), "authoring-presentations");
    writeSkill(path.join(root, "bundled"), "research-writing");
    writeSkill(path.join(root, "bundled"), "manual-only", "disable-model-invocation: true\n");
    writeSkill(path.join(synaraBaseDir, "skills"), "my-skill");
    // Same name as a bundled skill: the bundled copy wins, as in the catalog.
    writeSkill(path.join(synaraBaseDir, "skills"), "authoring-presentations");

    const prepared = await prepareClaudeSkillsPlugin({
      synaraBaseDir,
      disabledSkillNames: ["Research-Writing"],
    });

    expect(prepared?.skills.map((skill) => skill.qualifiedName)).toEqual([
      "lattice:authoring-presentations",
      "lattice:my-skill",
    ]);
    expect(prepared?.skills[0]?.skillPath).toBe(
      path.join(root, "bundled", "authoring-presentations", "SKILL.md"),
    );
    expect(readdirSync(path.join(prepared!.plugin.path, "skills")).toSorted()).toEqual([
      "authoring-presentations",
      "my-skill",
    ]);
  });

  it("reuses one directory per served set and builds another when the set changes", async () => {
    const synaraBaseDir = path.join(root, "home");
    writeSkill(path.join(root, "bundled"), "authoring-presentations");
    writeSkill(path.join(root, "bundled"), "create-theme");

    const first = await prepareClaudeSkillsPlugin({ synaraBaseDir, disabledSkillNames: [] });
    const again = await prepareClaudeSkillsPlugin({ synaraBaseDir, disabledSkillNames: [] });
    const toggled = await prepareClaudeSkillsPlugin({
      synaraBaseDir,
      disabledSkillNames: ["create-theme"],
    });

    expect(again?.plugin.path).toBe(first?.plugin.path);
    expect(toggled?.plugin.path).not.toBe(first?.plugin.path);
    // The earlier set's directory stays intact for a session still using it.
    expect(readdirSync(path.join(first!.plugin.path, "skills")).toSorted()).toEqual([
      "authoring-presentations",
      "create-theme",
    ]);
    expect(readdirSync(path.join(synaraBaseDir, "claude-skills-plugin"))).toHaveLength(2);
  });

  it("serves nothing when every skill is off", async () => {
    writeSkill(path.join(root, "bundled"), "research-writing");
    const prepared = await prepareClaudeSkillsPlugin({
      synaraBaseDir: path.join(root, "home"),
      disabledSkillNames: ["research-writing"],
    });
    expect(prepared).toBeNull();
  });
});

describe("claudeLaunchSettingsEqual", () => {
  it("treats a skills toggle as a different launch, so a warm draft is not adopted", () => {
    const base = { loadUserMcpServers: false, lowerProcessPriority: true };
    expect(
      claudeLaunchSettingsEqual(
        { ...base, disabledSkillNames: ["research-writing"] },
        { ...base, disabledSkillNames: ["research-writing"] },
      ),
    ).toBe(true);
    expect(
      claudeLaunchSettingsEqual(
        { ...base, disabledSkillNames: ["research-writing"] },
        { ...base, disabledSkillNames: [] },
      ),
    ).toBe(false);
  });
});
