// FILE: skillPromptInjection.test.ts
// Purpose: Verifies which providers receive inlined portable skill instructions
//          and that the inline text respects the turn character budget.
// Layer: Server provider tests

import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildInlineSkillInstructions,
  shouldInlineSkillForProvider,
} from "./skillPromptInjection.ts";

const synaraSkillPath = "/Users/me/.synara/skills/reviewer/SKILL.md";
const codexSkillPath = "/Users/me/.codex/skills/reviewer/SKILL.md";
const claudeSkillPath = "/Users/me/.claude/skills/reviewer/SKILL.md";
const cursorSkillPath = "/Users/me/.cursor/skills/reviewer/SKILL.md";
const piSkillPath = "/Users/me/.pi/agent/skills/reviewer/SKILL.md";
const devinSkillPath = "/Users/me/.config/devin/skills/reviewer/SKILL.md";
const cognitionSkillPath = "/Users/me/.config/cognition/skills/reviewer/SKILL.md";
const agentsSkillPath = "/Users/me/.agents/skills/reviewer/SKILL.md";
const windsurfSkillPath = "/repo/.windsurf/skills/reviewer/SKILL.md";
const codeiumSkillPath = "/Users/me/.codeium/windsurf/skills/reviewer/SKILL.md";

describe("shouldInlineSkillForProvider", () => {
  it("skips codex-native and synara roots for codex but inlines foreign provider roots", () => {
    expect(shouldInlineSkillForProvider("codex", synaraSkillPath)).toBe(false);
    expect(shouldInlineSkillForProvider("codex", codexSkillPath)).toBe(false);
    expect(shouldInlineSkillForProvider("codex", agentsSkillPath)).toBe(false);
    expect(shouldInlineSkillForProvider("codex", "/repo/.agents/skills/reviewer/SKILL.md")).toBe(
      false,
    );
    expect(shouldInlineSkillForProvider("codex", claudeSkillPath)).toBe(true);
    expect(shouldInlineSkillForProvider("codex", cursorSkillPath)).toBe(true);
  });

  it("inlines only Synara-owned paths for cursor", () => {
    expect(shouldInlineSkillForProvider("cursor", synaraSkillPath)).toBe(true);
    expect(shouldInlineSkillForProvider("cursor", cursorSkillPath)).toBe(false);
    expect(shouldInlineSkillForProvider("cursor", codexSkillPath)).toBe(false);
  });

  it("inlines everything except .claude paths for claudeAgent", () => {
    expect(shouldInlineSkillForProvider("claudeAgent", claudeSkillPath)).toBe(false);
    expect(shouldInlineSkillForProvider("claudeAgent", synaraSkillPath)).toBe(true);
    expect(shouldInlineSkillForProvider("claudeAgent", codexSkillPath)).toBe(true);
  });

  it("inlines cross-provider paths for pi but not pi-native skills", () => {
    expect(shouldInlineSkillForProvider("pi", synaraSkillPath)).toBe(true);
    expect(shouldInlineSkillForProvider("pi", claudeSkillPath)).toBe(true);
    expect(shouldInlineSkillForProvider("pi", piSkillPath)).toBe(false);
  });

  it("skips Devin-native skill roots and inlines foreign roots", () => {
    for (const nativePath of [
      devinSkillPath,
      cognitionSkillPath,
      agentsSkillPath,
      windsurfSkillPath,
      codeiumSkillPath,
      claudeSkillPath,
      "C:\\Users\\me\\AppData\\Roaming\\devin\\skills\\reviewer\\SKILL.md",
    ]) {
      expect(shouldInlineSkillForProvider("devin", nativePath)).toBe(false);
    }
    for (const foreignPath of [synaraSkillPath, codexSkillPath, cursorSkillPath, piSkillPath]) {
      expect(shouldInlineSkillForProvider("devin", foreignPath)).toBe(true);
    }
  });

  it("always inlines for providers without native skill support", () => {
    for (const provider of ["antigravity", "grok", "opencode"] as const) {
      expect(shouldInlineSkillForProvider(provider, synaraSkillPath)).toBe(true);
      expect(shouldInlineSkillForProvider(provider, claudeSkillPath)).toBe(true);
    }
  });
});

describe("buildInlineSkillInstructions", () => {
  it("inlines skill content for non-native providers and skips unreadable paths", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "skill-inline-"));
    const skillDir = path.join(root, ".synara", "skills", "reviewer");
    try {
      await mkdir(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, "SKILL.md");
      await writeFile(skillPath, "# Reviewer\n\nAlways review carefully.");

      const text = await buildInlineSkillInstructions({
        provider: "antigravity",
        skills: [
          { name: "reviewer", path: skillPath },
          { name: "missing", path: path.join(root, ".synara", "skills", "missing", "SKILL.md") },
        ],
        maxChars: 10_000,
      });

      expect(text).toContain('<skill name="reviewer"');
      expect(text).toContain("Always review carefully.");
      expect(text).not.toContain("missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns empty text when nothing fits in the budget", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "skill-inline-budget-"));
    const skillDir = path.join(root, ".synara", "skills", "reviewer");
    try {
      await mkdir(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, "SKILL.md");
      await writeFile(skillPath, "content".repeat(100));

      const text = await buildInlineSkillInstructions({
        provider: "antigravity",
        skills: [{ name: "reviewer", path: skillPath }],
        maxChars: 50,
      });

      expect(text).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([".synara", ".agents"])(
    "does not duplicate %s skill instructions loaded natively by Codex",
    async (skillRoot) => {
      const root = mkdtempSync(path.join(os.tmpdir(), "skill-native-"));
      const skillDir = path.join(root, skillRoot, "skills", "reviewer");
      try {
        await mkdir(skillDir, { recursive: true });
        const skillPath = path.join(skillDir, "SKILL.md");
        await writeFile(skillPath, "# Reviewer\n\nAlways review carefully.");

        const text = await buildInlineSkillInstructions({
          provider: "codex",
          skills: [{ name: "reviewer", path: skillPath }],
          maxChars: 10_000,
        });
        expect(text).toBe("");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

describe("buildInlineSkillInstructions for Claude's skills plugin", () => {
  it("points a mentioned plugin-served skill at the Skill tool instead of pasting it again", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "skill-claude-plugin-"));
    const bundledPath = path.join(root, "embedded_skills", "authoring-presentations", "SKILL.md");
    const otherPath = path.join(root, "elsewhere", "reviewer", "SKILL.md");
    try {
      await mkdir(path.dirname(bundledPath), { recursive: true });
      await mkdir(path.dirname(otherPath), { recursive: true });
      await writeFile(bundledPath, "# Slides\n\nBUNDLED BODY");
      await writeFile(otherPath, "# Reviewer\n\nOTHER BODY");

      const text = await buildInlineSkillInstructions({
        provider: "claudeAgent",
        skills: [
          { name: "authoring-presentations", path: bundledPath },
          { name: "reviewer", path: otherPath },
        ],
        maxChars: 10_000,
        nativelyServedSkills: new Map([[bundledPath, "lattice:authoring-presentations"]]),
      });

      // Served: one pointer naming what Claude lists, never the body.
      expect(text).toContain('invoke="lattice:authoring-presentations"');
      expect(text).toContain(`path=${JSON.stringify(bundledPath)}`);
      expect(text).toContain("Skill tool");
      expect(text).not.toContain("BUNDLED BODY");
      // Not served (for example a skill Settings turned off): still inlined.
      expect(text).toContain("OTHER BODY");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("inlines a bundled skill for Claude when this session's plugin does not serve it", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "skill-claude-unserved-"));
    const bundledPath = path.join(root, "embedded_skills", "research-writing", "SKILL.md");
    try {
      await mkdir(path.dirname(bundledPath), { recursive: true });
      await writeFile(bundledPath, "# Research\n\nRESEARCH BODY");

      const text = await buildInlineSkillInstructions({
        provider: "claudeAgent",
        skills: [{ name: "research-writing", path: bundledPath }],
        maxChars: 10_000,
        nativelyServedSkills: new Map(),
      });

      expect(text).toContain("RESEARCH BODY");
      expect(text).not.toContain("invoke=");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
