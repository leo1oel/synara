// FILE: skillPromptInjection.ts
// Purpose: Inlines portable skill instructions into the outgoing prompt for providers
//          that cannot natively load the referenced skill files. This is the fallback
//          that makes Synara catalog skills usable on every provider.
//          A skill the provider already serves natively under another name (Claude's
//          skills plugin) gets a short pointer to that name instead of its body.
// Layer: Server provider helper
// Exports: shouldInlineSkillForProvider, buildInlineSkillInstructions

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type { ProviderKind, ProviderSkillReference } from "@synara/contracts";

// Per-skill cap keeps a single oversized SKILL.md from eating the turn budget.
const MAX_INLINE_SKILL_CONTENT_CHARS = 24_000;

const INLINE_SKILLS_HEADER =
  "The user invoked the following agent skill(s) for this request. Follow each " +
  "skill's instructions. File paths referenced inside a skill are relative to its " +
  '"dir" attribute.';

const NATIVE_SKILLS_HEADER =
  "The user invoked the following agent skill(s) for this request. They are in " +
  'your skill list: load each with the Skill tool under its "invoke" name before ' +
  'you act. If one is missing from your list, read the SKILL.md at its "path" instead.';

const CROSS_PROVIDER_SKILL_DIR_NAMES = [
  ".synara",
  ".codex",
  ".cursor",
  ".claude",
  ".agents",
] as const;

function pathSegments(path: string): Set<string> {
  return new Set(
    nodePath
      .normalize(path)
      .split(/[\\/]+/)
      .map((segment) => segment.toLowerCase()),
  );
}

export function shouldInlineSkillForProvider(provider: ProviderKind, skillPath: string): boolean {
  const segments = pathSegments(skillPath);
  switch (provider) {
    case "antigravity":
      return true;
    case "codex":
      // Codex loads .codex and .agents skills natively, plus ~/.synara/skills
      // registered via skills/extraRoots/set. Only foreign provider roots
      // need inline instructions alongside their structured skill reference.
      return [".claude", ".cursor"].some((dir) => segments.has(dir));
    case "cursor":
      // cursor-agent natively scans .cursor/.agents/.claude/.codex skill roots;
      // only Synara-owned paths need inlining.
      return segments.has(".synara");
    case "claudeAgent":
      // Claude Code loads .claude/skills folders itself. Bundled and
      // ~/.synara/skills skills reach it through Synara's skills plugin, which
      // callers report per session via `nativelyServedSkills`; anything else
      // (including a skill Settings turned off) is inlined.
      return !segments.has(".claude");
    case "devin":
      return !(
        [".agents", ".claude", ".codeium", ".cognition", ".devin", ".windsurf"].some((dir) =>
          segments.has(dir),
        ) ||
        ((segments.has(".config") || (segments.has("appdata") && segments.has("roaming"))) &&
          (segments.has("devin") || segments.has("cognition")))
      );
    case "pi":
      // Pi loads its own skill set; anything resolved from a cross-provider
      // folder is portable and must be inlined.
      return CROSS_PROVIDER_SKILL_DIR_NAMES.some((dir) => segments.has(dir));
    default:
      // Antigravity/Grok/Droid/OpenCode have no native skill support.
      return true;
  }
}

export async function buildInlineSkillInstructions(input: {
  readonly provider: ProviderKind;
  readonly skills: ReadonlyArray<ProviderSkillReference>;
  readonly maxChars: number;
  /**
   * SKILL.md path -> the name the provider lists the skill under, for skills
   * this session loads natively (Claude's skills plugin). Their full text
   * would otherwise enter the context twice: pasted here, then again when the
   * model calls its Skill tool on a skill it already has.
   */
  readonly nativelyServedSkills?: ReadonlyMap<string, string> | undefined;
}): Promise<string> {
  const servedName = (skill: ProviderSkillReference) =>
    input.nativelyServedSkills?.get(nodePath.resolve(skill.path));
  const servedSkills = input.skills.filter((skill) => servedName(skill) !== undefined);
  const inlineSkills = input.skills.filter(
    (skill) =>
      servedName(skill) === undefined && shouldInlineSkillForProvider(input.provider, skill.path),
  );
  if ((servedSkills.length === 0 && inlineSkills.length === 0) || input.maxChars <= 0) {
    return "";
  }

  let text = "";
  if (servedSkills.length > 0) {
    const pointers = servedSkills
      .map(
        (skill) =>
          `<skill name=${JSON.stringify(skill.name)} invoke=${JSON.stringify(
            servedName(skill),
          )} path=${JSON.stringify(skill.path)} />`,
      )
      .join("\n");
    const candidate = `${NATIVE_SKILLS_HEADER}\n\n${pointers}`;
    if (candidate.length <= input.maxChars) {
      text = candidate;
    }
  }
  for (const skill of inlineSkills) {
    let content: string;
    try {
      content = await fs.readFile(skill.path, "utf8");
    } catch {
      continue;
    }
    let trimmed = content.trim();
    if (trimmed.length > MAX_INLINE_SKILL_CONTENT_CHARS) {
      trimmed = `${trimmed.slice(0, MAX_INLINE_SKILL_CONTENT_CHARS)}\n[skill content truncated]`;
    }
    const block = `<skill name=${JSON.stringify(skill.name)} dir=${JSON.stringify(
      nodePath.dirname(skill.path),
    )}>\n${trimmed}\n</skill>`;
    const candidate = text.includes(INLINE_SKILLS_HEADER)
      ? `${text}\n\n${block}`
      : `${text.length === 0 ? "" : `${text}\n\n`}${INLINE_SKILLS_HEADER}\n\n${block}`;
    if (candidate.length > input.maxChars) {
      // Keep whatever already fits instead of overflowing the provider turn budget.
      break;
    }
    text = candidate;
  }
  return text;
}
