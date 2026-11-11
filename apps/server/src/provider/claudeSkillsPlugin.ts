// FILE: claudeSkillsPlugin.ts
// Purpose: Serves Synara-owned skills (the host's bundled skills plus
//          `~/.synara/skills`) to Claude Code natively, as a local plugin
//          directory passed through the Agent SDK `plugins` option. Claude then
//          lists each enabled skill as `lattice:<name>` and can pick it on its
//          own, instead of only seeing a skill when the user names it and its
//          SKILL.md is pasted into that turn.
// Layer: Server provider runtime
// Exports: resolveClaudePluginSkills, ensureClaudeSkillsPluginDir,
//          prepareClaudeSkillsPlugin, CLAUDE_SKILLS_PLUGIN_NAME

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import {
  bundledSkillsDir,
  collectSkillsFromRoots,
  skillNameKey,
  synaraSkillsDir,
  type SkillRoot,
} from "./skillsCatalog.ts";

/** Claude Code shows plugin skills as `<plugin name>:<skill name>`. */
export const CLAUDE_SKILLS_PLUGIN_NAME = "lattice";

// Lives under the Synara home, never under ~/.claude or the user's project.
const PLUGIN_DIRS_FOLDER = "claude-skills-plugin";

export interface ClaudePluginSkill {
  /** The catalog name, which is also the link name under the plugin's skills/. */
  readonly name: string;
  /** What Claude sees in its Skill list and passes to the Skill tool. */
  readonly qualifiedName: string;
  /** The skill's SKILL.md, exactly as the Synara catalog reports it. */
  readonly skillPath: string;
}

export interface ClaudeSkillsPlugin {
  readonly plugin: {
    readonly type: "local";
    readonly path: string;
    readonly skipMcpDiscovery: true;
  };
  readonly skills: ReadonlyArray<ClaudePluginSkill>;
}

// A plugin skill is a directory entry, so its name must be one safe path
// segment. A namespaced (`a:b`) or dotted name would not survive as a link.
const SAFE_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The skills Claude should be served: every bundled and `~/.synara/skills`
 * skill except the ones Settings turned off (`skills.disabled`) and the ones
 * whose frontmatter opts out of model invocation. A bundled skill wins over an
 * installed one of the same name, matching the Synara catalog's order.
 */
export async function resolveClaudePluginSkills(input: {
  readonly synaraBaseDir: string;
  readonly disabledSkillNames: ReadonlyArray<string>;
}): Promise<ClaudePluginSkill[]> {
  const bundled = bundledSkillsDir();
  const roots: SkillRoot[] = [
    ...(bundled ? [{ path: bundled, scope: "bundled" }] : []),
    { path: synaraSkillsDir(input.synaraBaseDir), scope: "synara" },
  ];
  const disabled = new Set(input.disabledSkillNames.map(skillNameKey));
  const descriptors = await collectSkillsFromRoots(roots);
  return descriptors
    .filter(
      (skill) =>
        skill.enabled &&
        !disabled.has(skillNameKey(skill.name)) &&
        SAFE_SKILL_NAME.test(skill.name) &&
        nodePath.basename(skill.path).toLowerCase() === "skill.md",
    )
    .map((skill) => ({
      name: skill.name,
      qualifiedName: `${CLAUDE_SKILLS_PLUGIN_NAME}:${skill.name}`,
      skillPath: skill.path,
    }));
}

/**
 * Builds (or reuses) the plugin directory for exactly this set of skills and
 * returns its path. The directory is content-addressed by the served set, so a
 * running session never sees its skills change underneath it when Settings
 * toggles a skill, and concurrent launches with the same set share one
 * directory. Each skill is a symlink to its real folder, so a SKILL.md edit or
 * a host update shows through without a rebuild.
 */
export async function ensureClaudeSkillsPluginDir(input: {
  readonly synaraBaseDir: string;
  readonly skills: ReadonlyArray<ClaudePluginSkill>;
}): Promise<string> {
  const entries = input.skills
    .map((skill) => [skill.name, nodePath.dirname(skill.skillPath)] as const)
    .toSorted(([left], [right]) => left.localeCompare(right));
  const key = createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 16);
  const pluginsRoot = nodePath.join(input.synaraBaseDir, PLUGIN_DIRS_FOLDER);
  const pluginDir = nodePath.join(pluginsRoot, key);
  const manifestPath = nodePath.join(pluginDir, ".claude-plugin", "plugin.json");
  if (await isFile(manifestPath)) {
    return pluginDir;
  }

  // Assemble beside the final path, then rename into place, so a concurrent
  // launch never loads a half-built plugin.
  const stagingDir = nodePath.join(pluginsRoot, `.staging-${key}-${randomUUID()}`);
  try {
    await fs.mkdir(nodePath.join(stagingDir, ".claude-plugin"), { recursive: true });
    await fs.mkdir(nodePath.join(stagingDir, "skills"), { recursive: true });
    await fs.writeFile(
      nodePath.join(stagingDir, ".claude-plugin", "plugin.json"),
      `${JSON.stringify(
        {
          name: CLAUDE_SKILLS_PLUGIN_NAME,
          description: "Skills bundled with the host app and installed in Synara.",
          version: "1.0.0",
        },
        null,
        2,
      )}\n`,
    );
    for (const [name, target] of entries) {
      await fs.symlink(target, nodePath.join(stagingDir, "skills", name), "dir");
    }
    try {
      await fs.rename(stagingDir, pluginDir);
    } catch (error) {
      // Another launch built the same set first; theirs is identical.
      if (!(await isFile(manifestPath))) throw error;
    }
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
  return pluginDir;
}

/**
 * The `plugins` entry for a new Claude session, or null when there is nothing
 * to serve. `skipMcpDiscovery` keeps Claude Code from looking for MCP servers
 * in the plugin: Synara owns the session's MCP configuration.
 */
export async function prepareClaudeSkillsPlugin(input: {
  readonly synaraBaseDir: string;
  readonly disabledSkillNames: ReadonlyArray<string>;
}): Promise<ClaudeSkillsPlugin | null> {
  const skills = await resolveClaudePluginSkills(input);
  if (skills.length === 0) return null;
  const path = await ensureClaudeSkillsPluginDir({ synaraBaseDir: input.synaraBaseDir, skills });
  return { plugin: { type: "local", path, skipMcpDiscovery: true }, skills };
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}
